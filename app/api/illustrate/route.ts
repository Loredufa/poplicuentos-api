// app/api/illustrate/route.ts — Edge aggregator sin "any", con timeouts
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

type Scene = 'intro' | 'conflict' | 'ending';

interface OneImageResponse {
  image?: string;
  scene?: Scene;
}

const ALLOW = (process.env.ORIGIN_ALLOWLIST ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

function cors(origin: string | null) {
  const allowed = ALLOW.includes('*') || (origin && ALLOW.includes(origin));
  return {
    'Access-Control-Allow-Origin': allowed ? (origin ?? '*') : 'null',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    Vary: 'Origin',
  };
}

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { headers: cors(req.headers.get('origin')) });
}

function makeOneUrl(base: string, scene: Scene) {
  return `${base}/api/illustrate-one?scene=${scene}`;
}

// Llama a /api/illustrate-one con timeout defensivo (22s). Devuelve la URL o lanza error.
async function fetchOneWithTimeout(url: string, bodyText: string): Promise<string> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort('timeout'), 22_000);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,
      signal: controller.signal,
    });

    const ct = res.headers.get('content-type') || '';
    if (!res.ok) {
      const detail = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
      throw new Error(`${res.status}: ${detail.slice(0, 800)}`);
    }

    const json = (await res.json()) as OneImageResponse;
    if (typeof json?.image !== 'string') {
      throw new Error('invalid payload (missing image url)');
    }
    return json.image;
  } finally {
    clearTimeout(timer);
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  // Leemos el body UNA vez y validamos que es JSON
  let bodyText = '';
  try {
    bodyText = await req.text();
    JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const base = new URL(req.url).origin;
  const scenes: Scene[] = ['intro', 'conflict', 'ending'];

  // Disparamos las 3 en paralelo (cada una con timeout interno de 22s)
  const promises = scenes.map((scene) =>
    fetchOneWithTimeout(makeOneUrl(base, scene), bodyText)
  );

  const settled = await Promise.allSettled(promises);

  const images: string[] = [];
  const errors: string[] = [];

  for (const r of settled) {
    if (r.status === 'fulfilled') {
      images.push(r.value);
    } else {
      const msg = r.reason instanceof Error ? r.reason.message : String(r.reason);
      errors.push(msg);
    }
  }

  if (!images.length) {
    return NextResponse.json(
      { error: 'Upstream error', details: errors[0] || 'No image generated' },
      { status: 502, headers }
    );
  }

  return NextResponse.json({ images: images.slice(0, 3) }, { status: 200, headers });
}
