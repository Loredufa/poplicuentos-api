// app/api/illustrate/route.ts — Edge, rápido y tolerante a timeouts
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

type AgeRange = '2-5' | '6-10';
type Tone = 'tierno' | 'aventurero' | 'humor';
type Locale = 'es-AR' | 'es-LATAM';

interface IllustrateRequest {
  age_range: AgeRange;
  theme?: string;
  skill?: string;
  characters?: string;
  tone?: Tone;
  locale?: Locale;
  story?: string;
}

interface OpenAIImageData { url?: string }
interface OpenAIImageResponse { data?: OpenAIImageData[] }

const ALLOWLIST = (process.env.ORIGIN_ALLOWLIST ?? '*')
  .split(',').map(s => s.trim()).filter(Boolean);

function cors(origin: string | null) {
  const allowed = ALLOWLIST.includes('*') || (origin && ALLOWLIST.includes(origin));
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

function isBody(u: unknown): u is IllustrateRequest {
  if (typeof u !== 'object' || u === null) return false;
  const o = u as Record<string, unknown>;
  const age = o.age_range;
  if (age !== '2-5' && age !== '6-10') return false;
  if (o.tone && !['tierno','aventurero','humor'].includes(String(o.tone))) return false;
  if (o.locale && !['es-AR','es-LATAM'].includes(String(o.locale))) return false;
  if (o.theme && typeof o.theme !== 'string') return false;
  if (o.skill && typeof o.skill !== 'string') return false;
  if (o.characters && typeof o.characters !== 'string') return false;
  if (o.story && typeof o.story !== 'string') return false;
  return true;
}

function buildPrompts(b: IllustrateRequest): string[] {
  const baseStyle =
    `ilustración infantil, libro de cuentos, colores suaves y cálidos, estilo acuarela/pastel, ` +
    `trazos simples y expresivos, diversidad e inclusión, apto ${b.age_range === '2-5' ? 'preescolar' : 'primaria'}, ` +
    `luz nocturna suave, sin violencia, sin marcas reales.`;
  const who = b.characters ? `con ${b.characters}` : 'con los personajes del cuento';
  const brief = b.story
    ? `Basado en este cuento: ${b.story.slice(0, 900)}`
    : `Tema: ${b.theme ?? 'cuento infantil'}. Habilidad: ${b.skill ?? 'empatía'}. Tono: ${b.tone ?? 'tierno'}.`;
  return [
    `ESCENA 1 (inicio): ${who}. Presentación del mundo cotidiano. ${brief}. ${baseStyle}`,
    `ESCENA 2 (desarrollo): conflicto leve y práctica de la habilidad socioemocional. ${who}. ${baseStyle}`,
    `ESCENA 3 (cierre): resolución amable y atmósfera calma para dormir. ${who}. ${baseStyle}`,
  ];
}

function firstUrl(resp: OpenAIImageResponse): string | null {
  const arr = resp.data;
  if (!Array.isArray(arr) || !arr.length) return null;
  const url = arr[0]?.url;
  return typeof url === 'string' ? url : null;
}

async function genImage(apiKey: string, prompt: string, signal: AbortSignal) {
  // 1) intento con gpt-image-1
  let r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model: 'gpt-image-1', prompt, size: '512x512', n: 1 }),
    signal,
  });

  // 2) fallback a dall-e-3 en errores típicos
  if (!r.ok && [400,401,403,429].includes(r.status)) {
    r = await fetch('https://api.openai.com/v1/images/generations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model: 'dall-e-3', prompt, size: '512x512', n: 1 }),
      signal,
    });
  }

  const ct = r.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await r.json()) as OpenAIImageResponse;
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${JSON.stringify(j).slice(0, 1000)}`);
    const url = firstUrl(j);
    if (!url) throw new Error('No image URL');
    return url;
  } else {
    const t = await r.text();
    if (!r.ok) throw new Error(`OpenAI ${r.status}: ${t.slice(0, 1000)}`);
    throw new Error('Unexpected non-JSON response');
  }
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500, headers });

  let parsed: unknown;
  try { parsed = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers }); }
  if (!isBody(parsed)) return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers });

  const prompts = buildPrompts(parsed);

  try {
    // Timeout defensivo (22s) por llamado para no chocar el límite Edge (25s)
    const withTimeout = <T,>(p: (signal: AbortSignal) => Promise<T>) =>
      new Promise<T>((resolve, reject) => {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort('timeout'), 22_000);
        p(ctrl.signal).then((v) => { clearTimeout(timer); resolve(v); })
                      .catch((e) => { clearTimeout(timer); reject(e); });
      });

    const results = await Promise.allSettled(
      prompts.map((p) => withTimeout<string>((signal) => genImage(apiKey, p, signal)))
    );

    const images = results
      .map((r) => (r.status === 'fulfilled' ? r.value : null))
      .filter((u): u is string => typeof u === 'string');

    if (!images.length) {
      // si nada llegó, informo el primer motivo que encontremos
      const firstErr = results.find((r) => r.status === 'rejected') as PromiseRejectedResult | undefined;
      const detail = firstErr?.reason ? String(firstErr.reason) : 'No images generated';
      return NextResponse.json({ error: 'Upstream error', details: detail }, { status: 502, headers });
    }

    return NextResponse.json({ images }, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Upstream error', details: msg }, { status: 500, headers });
  }
}
