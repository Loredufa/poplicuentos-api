// app/api/illustrate/route.ts — Edge, tipado y sin "any"
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

// ---- Tipos
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

// ---- CORS
const ALLOWLIST = (process.env.ORIGIN_ALLOWLIST ?? '*')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

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

// ---- Helpers
function isIllustrateRequest(u: unknown): u is IllustrateRequest {
  if (typeof u !== 'object' || u === null) return false;
  const o = u as Record<string, unknown>;
  const age = o.age_range;
  if (age !== '2-5' && age !== '6-10') return false;
  if (o.tone && !['tierno', 'aventurero', 'humor'].includes(String(o.tone))) return false;
  if (o.locale && !['es-AR', 'es-LATAM'].includes(String(o.locale))) return false;
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

type GenResult =
  | { ok: true; status: number; json: OpenAIImageResponse }
  | { ok: false; status: number; text: string };

async function genWithModel(apiKey: string, model: 'gpt-image-1' | 'dall-e-3', prompt: string): Promise<GenResult> {
  const r = await fetch('https://api.openai.com/v1/images/generations', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({ model, prompt, size: '1024x1024', n: 1 }),
  });
  const ct = r.headers.get('content-type') ?? '';
  if (ct.includes('application/json')) {
    const j = (await r.json()) as unknown as OpenAIImageResponse;
    return r.ok ? { ok: true, status: r.status, json: j } : { ok: false, status: r.status, text: JSON.stringify(j) };
  }
  const t = await r.text();
  return { ok: false, status: r.status, text: t };
}

function firstUrl(resp: OpenAIImageResponse): string | null {
  const arr = resp.data;
  if (!Array.isArray(arr) || !arr.length) return null;
  const url = arr[0]?.url;
  return typeof url === 'string' ? url : null;
}

// ---- Handler
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500, headers });

  let jsonBody: unknown;
  try { jsonBody = await req.json(); }
  catch { return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers }); }

  if (!isIllustrateRequest(jsonBody)) {
    return NextResponse.json({ error: 'Invalid body: fields missing or wrong type' }, { status: 400, headers });
  }
  const body = jsonBody;

  const prompts = buildPrompts(body);

  try {
    const urls: string[] = [];
    for (const p of prompts) {
      // 1) Intento con gpt-image-1
      let result = await genWithModel(apiKey, 'gpt-image-1', p);

      // 2) Fallback a dall-e-3 si hay error típico de acceso/cuota/formato
      if (!result.ok && [400, 401, 403, 429].includes(result.status)) {
        result = await genWithModel(apiKey, 'dall-e-3', p);
      }

      if (!result.ok) {
        return NextResponse.json(
          { error: 'OpenAI error', status: result.status, details: result.text.slice(0, 2000) },
          { status: result.status, headers },
        );
      }

      const url = firstUrl(result.json);
      if (url) urls.push(url);
    }

    return NextResponse.json({ images: urls }, { status: 200, headers });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: 'Upstream error', details: msg }, { status: 500, headers });
  }
}
