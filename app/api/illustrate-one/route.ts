// app/api/illustrate-one/route.ts — Edge, 1 imagen por request
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

type AgeRange = '2-5' | '6-10';
type Tone = 'tierno' | 'aventurero' | 'humor';
type Locale = 'es-AR' | 'es-LATAM';
type Scene = 'intro' | 'conflict' | 'ending';

interface IllustrateReq {
  age_range: AgeRange;
  theme?: string;
  skill?: string;
  characters?: string;
  tone?: Tone;
  locale?: Locale;
  story?: string;
  scene?: Scene; // opcional en body; también soportamos ?scene=...
}

interface OpenAIImageData { url?: string }
interface OpenAIImageResp { data?: OpenAIImageData[] }

const ALLOW = (process.env.ORIGIN_ALLOWLIST ?? '*').split(',').map(s=>s.trim()).filter(Boolean);
const cors = (o: string | null) => ({
  'Access-Control-Allow-Origin': ALLOW.includes('*') || (o && ALLOW.includes(o)) ? (o ?? '*') : 'null',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
  Vary: 'Origin',
});

export async function OPTIONS(req: NextRequest) {
  return new NextResponse(null, { headers: cors(req.headers.get('origin')) });
}

function isBody(u: unknown): u is IllustrateReq {
  if (typeof u !== 'object' || !u) return false;
  const o = u as Record<string, unknown>;
  const age = o.age_range;
  if (age !== '2-5' && age !== '6-10') return false;
  if (o.tone && !['tierno','aventurero','humor'].includes(String(o.tone))) return false;
  if (o.locale && !['es-AR','es-LATAM'].includes(String(o.locale))) return false;
  if (o.theme && typeof o.theme !== 'string') return false;
  if (o.skill && typeof o.skill !== 'string') return false;
  if (o.characters && typeof o.characters !== 'string') return false;
  if (o.story && typeof o.story !== 'string') return false;
  if (o.scene && !['intro','conflict','ending'].includes(String(o.scene))) return false;
  return true;
}

function promptForScene(b: IllustrateReq, scene: Scene): string {
  const base =
    `ilustración infantil, libro de cuentos, colores suaves y cálidos, estilo acuarela/pastel, ` +
    `trazos simples y expresivos, diversidad e inclusión, apto ${b.age_range==='2-5'?'preescolar':'primaria'}, ` +
    `luz nocturna suave, sin violencia, sin marcas reales.`;
  const who = b.characters ? `con ${b.characters}` : 'con los personajes del cuento';
  const brief = b.story
    ? `Basado en este cuento: ${b.story.slice(0, 900)}`
    : `Tema: ${b.theme ?? 'cuento infantil'}. Habilidad: ${b.skill ?? 'empatía'}. Tono: ${b.tone ?? 'tierno'}.`;

  const sceneText =
    scene === 'intro'    ? 'ESCENA 1 (inicio): presentación del mundo cotidiano.'
  : scene === 'conflict' ? 'ESCENA 2 (desarrollo): conflicto leve y práctica de la habilidad socioemocional.'
                          : 'ESCENA 3 (cierre): resolución amable y atmósfera calma para dormir.';

  return `${sceneText} ${who}. ${brief}. ${base}`;
}

function firstUrl(r: OpenAIImageResp) {
  const url = r?.data?.[0]?.url;
  return typeof url === 'string' ? url : null;
}

const SIZE = '512x512'; // si aún demora, bajá a "384x384"

async function genImage(apiKey: string, prompt: string, signal: AbortSignal) {
  // 1) gpt-image-1
  let resp = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: SIZE, n: 1 }),
    signal,
  });

  // 2) fallback a dall-e-3
  if (!resp.ok && [400,401,403,429].includes(resp.status)) {
    resp = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt, size: SIZE, n: 1 }),
      signal,
    });
  }

  const ct = resp.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await resp.json()) as OpenAIImageResp;
    if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${JSON.stringify(j).slice(0, 800)}`);
    const url = firstUrl(j);
    if (!url) throw new Error('No image URL');
    return url;
  }
  const t = await resp.text();
  if (!resp.ok) throw new Error(`OpenAI ${resp.status}: ${t.slice(0,800)}`);
  throw new Error('Unexpected non-JSON response');
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500, headers });

  let bodyUnknown: unknown;
  try { bodyUnknown = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers }); }

  if (!isBody(bodyUnknown)) return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers });

  const urlScene = (new URL(req.url)).searchParams.get('scene') as Scene | null;
  const scene = (bodyUnknown.scene ?? urlScene ?? 'intro') as Scene;
  const prompt = promptForScene(bodyUnknown, scene);

  // Timeout defensivo 22 s (Edge limita ~25 s)
  const withTimeout = <T,>(fn: (signal: AbortSignal) => Promise<T>) =>
    new Promise<T>((resolve, reject) => {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort('timeout'), 22_000);
      fn(ctrl.signal).then(v => { clearTimeout(t); resolve(v); })
                     .catch(e => { clearTimeout(t); reject(e); });
    });

  try {
    const image = await withTimeout<string>((signal) => genImage(apiKey, prompt, signal));
    return NextResponse.json({ image, scene }, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Upstream error', details: msg }, { status: 502, headers });
  }
}
