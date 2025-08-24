// app/api/illustrate/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';

// Util: prompt “infantil” (clarito para 2-5 vs 6-10)
function kidStylePrompt(story: string, age: '2-5'|'6-10', tone: string) {
  return [
    `Children's picture-book illustration for ages ${age}.`,
    age === '2-5'
      ? 'Simple shapes, soft pastel colors, big clear characters, rounded forms.'
      : 'Richer scenes, expressive faces, dynamic composition but clean for kids.',
    `Tone: ${tone || 'tierno'}.`,
    `Depict a single scene from this story (NO text in the image):`,
    story.slice(0, 700),
    `Cute, warm light, cozy, safe for kids.`
  ].join(' ');
}

// Hace un intento "sincrónico" (hasta 45s) y, si no termina, hace un poll cortito.
async function replicateFluxSchnell({
  prompt,
  aspect_ratio = '1:1',
  num_outputs = 3,
  num_inference_steps = 4,
}: {
  prompt: string;
  aspect_ratio?: '1:1'|'3:4'|'4:3'|'16:9'|'9:16';
  num_outputs?: number;
  num_inference_steps?: 1|2|3|4;
}): Promise<string[]> {
  const token = process.env.REPLICATE_API_TOKEN;
  if (!token) throw new Error('Missing REPLICATE_API_TOKEN');

  // 1) Crear predicción pidiendo “esperar” hasta 45s (sync light)
  const create = await fetch('https://api.replicate.com/v1/predictions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      'Prefer': 'wait=45', // espera hasta 45s; si no alcanza, luego hacemos poll
    },
    body: JSON.stringify({
      // Para modelos "oficiales" se puede usar owner/name directo.
      // Inputs del schema: prompt, aspect_ratio, num_outputs (1-4), num_inference_steps (1-4)
      // https://replicate.com/black-forest-labs/flux-schnell/api
      version: 'black-forest-labs/flux-schnell',
      input: {
        prompt,
        aspect_ratio,
        num_outputs: Math.min(Math.max(num_outputs, 1), 4),
        num_inference_steps,
        // opcionales se puede tunear:
        // output_format: 'jpg',
        // output_quality: 85,
      },
    }),
  });

  if (!create.ok) {
    const t = await create.text();
    throw new Error(`Replicate create error ${create.status}: ${t}`);
  }

  const first = await create.json();
  if (first.status === 'succeeded' && Array.isArray(first.output) && first.output.length) {
    return first.output as string[]; // array de URLs
  }

  // 2) Si no terminó, hacemos un poll corto (hasta ~20s)
  const id = first.id as string;
  const started = Date.now();
  while (Date.now() - started < 20000) {
    await new Promise(r => setTimeout(r, 1500));
    const res = await fetch(`https://api.replicate.com/v1/predictions/${id}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) {
      const t = await res.text();
      throw new Error(`Replicate get error ${res.status}: ${t}`);
    }
    const p = await res.json();
    if (p.status === 'succeeded' && Array.isArray(p.output) && p.output.length) {
      return p.output as string[];
    }
    if (p.status === 'failed' || p.status === 'canceled') {
      throw new Error(`Replicate status: ${p.status}`);
    }
  }

  throw new Error('Timeout waiting for images');
}

export async function POST(req: NextRequest) {
  try {
    const {
      story,
      age_range,
      tone = 'tierno',
      aspect_ratio = '1:1',
      num_images = 3,
    } = await req.json();

    if (!story || !age_range) {
      return NextResponse.json({ error: 'Missing story or age_range' }, { status: 400 });
    }

    const prompt = kidStylePrompt(story, age_range, tone);
    const urls = await replicateFluxSchnell({
      prompt,
      aspect_ratio,
      num_outputs: num_images,
      num_inference_steps: 4,
    });

    // aseguramos exactamente 3 
    const images = urls.slice(0, Math.min(num_images, 4));
    return NextResponse.json({ provider: 'replicate', images }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Illustration failed' }, { status: 502 });
  }
}
