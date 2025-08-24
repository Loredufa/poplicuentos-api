export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

type AgeRange = '2-5' | '6-10';
type OpenAIImageSize = '1024x1024' | '1024x1792' | '1792x1024';
type OpenAIImageData = { b64_json?: string; url?: string };
type OpenAIImagesResponse = { data: OpenAIImageData[] };

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

function kidStylePrompt(story: string, age: AgeRange, tone: string) {
  return [
    `Children's picture-book illustration for ages ${age}.`,
    age === '2-5'
      ? 'Simple shapes, soft pastel colors, big clear characters, rounded forms.'
      : 'Richer scenes, expressive faces, dynamic composition but clean for kids.',
    `Tone: ${tone || 'tierno'}.`,
    `Depict a single scene from this story (NO text in the image).`,
    story.slice(0, 700),
    `Cute, warm light, cozy, safe for kids.`,
  ].join(' ');
}

function sizeFromAR(ar?: string): OpenAIImageSize {
  switch ((ar || '').toLowerCase()) {
    case '1:1':
    case 'square':
      return '1024x1024';
    case '9:16':
    case 'portrait':
    case '3:4':
      return '1024x1792';
    case '16:9':
    case 'landscape':
    case '4:3':
      return '1792x1024';
    default:
      return '1024x1024';
  }
}
function sanitizeSize(size?: string): OpenAIImageSize {
  return size === '1024x1024' || size === '1024x1792' || size === '1792x1024'
    ? size
    : '1024x1024';
}

// Type guard sin "any"
function isImagesResponse(x: unknown): x is OpenAIImagesResponse {
  if (typeof x !== 'object' || x === null) return false;
  const rec = x as Record<string, unknown>;
  if (!Array.isArray(rec.data)) return false;
  return (rec.data as unknown[]).every((i) => {
    if (typeof i !== 'object' || i === null) return false;
    const r = i as Record<string, unknown>;
    return 'b64_json' in r || 'url' in r;
  });
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const {
      story,
      age_range,
      tone = 'tierno',
      num_images = 3,
      aspect_ratio,
      size,
    }: {
      story?: string;
      age_range?: AgeRange;
      tone?: string;
      num_images?: number;
      aspect_ratio?: string;
      size?: string;
    } = body ?? {};

    if (!story || !age_range) {
      return NextResponse.json({ error: 'Missing story or age_range' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 });
    }

    const prompt = kidStylePrompt(story, age_range, tone);
    const finalSize: OpenAIImageSize = size ? sanitizeSize(size) : sizeFromAR(aspect_ratio);
    const n = Math.max(1, Math.min(Number(num_images) || 3, 3));

    console.log('[illustrate] calling gpt-image-1', { finalSize, n });

    // Nota: gpt-image-1 ya no usa response_format; devuelve b64_json por defecto.
    const res = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: finalSize,
      n,
    });

    // Sin "any": validamos y mapeamos seguro
    if (!isImagesResponse(res)) {
      return NextResponse.json({ error: 'Unexpected response from OpenAI' }, { status: 502 });
    }

    const images = res.data
      .map((d) => (d.b64_json ? `data:image/png;base64,${d.b64_json}` : d.url ?? ''))
      .filter((u): u is string => Boolean(u));

    if (!images.length) {
      return NextResponse.json({ error: 'No images returned' }, { status: 502 });
    }

    return NextResponse.json({ provider: 'openai', size: finalSize, images }, { status: 200 });
  } catch (e) {
    const msg = e instanceof Error ? e.message : 'Illustration failed';
    return NextResponse.json({ error: msg }, { status: 502 });
  }
}
