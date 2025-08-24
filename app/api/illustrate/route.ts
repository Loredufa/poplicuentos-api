// app/api/illustrate/route.ts
export const runtime = 'nodejs';

import { NextRequest, NextResponse } from 'next/server';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY! });

// Prompt infantil
function kidStylePrompt(story: string, age: '2-5'|'6-10', tone: string) {
  return [
    `Children's picture-book illustration for ages ${age}.`,
    age === '2-5'
      ? 'Simple shapes, soft pastel colors, big clear characters, rounded forms.'
      : 'Richer scenes, expressive faces, dynamic composition but clean for kids.',
    `Tone: ${tone || 'tierno'}.`,
    `Depict a single scene from this story (NO text in the image).`,
    story.slice(0, 700),
    `Cute, warm light, cozy, safe for kids.`
  ].join(' ');
}

// Solo tamaños válidos para gpt-image-1
function sizeFromAR(ar?: string): '1024x1024'|'1024x1792'|'1792x1024' {
  switch ((ar || '').toLowerCase()) {
    case '1:1': case 'square': return '1024x1024';
    case '9:16': case 'portrait': case '3:4': return '1024x1792';
    case '16:9': case 'landscape': case '4:3': return '1792x1024';
    default: return '1024x1024';
  }
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
    } = body || {};

    if (!story || !age_range) {
      return NextResponse.json({ error: 'Missing story or age_range' }, { status: 400 });
    }
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json({ error: 'OPENAI_API_KEY missing' }, { status: 500 });
    }

    const prompt = kidStylePrompt(story, age_range, tone);
    const finalSize: '1024x1024'|'1024x1792'|'1792x1024' =
      (size === '1024x1024' || size === '1024x1792' || size === '1792x1024')
        ? size
        : sizeFromAR(aspect_ratio);

    const n = Math.max(1, Math.min(Number(num_images) || 3, 3));

    // (debug) para confirmar que tu deploy usa este archivo
    console.log('[illustrate] calling gpt-image-1', { finalSize, n });

    const res = await openai.images.generate({
      model: 'gpt-image-1',
      prompt,
      size: finalSize,          // <-- Nunca 512x512
      n,
      response_format: 'b64_json',
    });

    const images = res.data.map((d) => `data:image/png;base64,${d.b64_json}`);
    return NextResponse.json({ provider: 'openai', size: finalSize, images }, { status: 200 });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || 'Illustration failed' }, { status: 502 });
  }
}
