// app/api/story/route.ts — Edge, sin "any" y con fallback si se corta por tokens
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

// ---- Tipos
type AgeRange = '2-5' | '6-10';
type Tone = 'tierno' | 'aventurero' | 'humor';
type Locale = 'es-AR' | 'es-LATAM';

interface StoryRequest {
  age_range: AgeRange;
  theme: string;
  skill: string;
  characters?: string;
  tone?: Tone;
  locale?: Locale;
  reading_time_minutes?: number;
}

interface OpenAIChoice {
  message?: { content?: string };
  finish_reason?: string;
}
interface OpenAIChatResponse {
  choices?: OpenAIChoice[];
}

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
function isStoryRequest(u: unknown): u is StoryRequest {
  if (typeof u !== 'object' || u === null) return false;
  const o = u as Record<string, unknown>;
  const age = o.age_range;
  if (age !== '2-5' && age !== '6-10') return false;
  if (typeof o.theme !== 'string' || typeof o.skill !== 'string') return false;
  if (o.characters && typeof o.characters !== 'string') return false;
  if (o.tone && !['tierno', 'aventurero', 'humor'].includes(String(o.tone))) return false;
  if (o.locale && !['es-AR', 'es-LATAM'].includes(String(o.locale))) return false;
  if (o.reading_time_minutes && typeof o.reading_time_minutes !== 'number') return false;
  return true;
}

function systemPrompt(): string {
  return (
    'Eres Poplicuentos, narrador infantil en español (es-AR / es-LATAM). ' +
    'Objetivo: crear un cuento original para niños con enfoque en habilidades socioemocionales. ' +
    'Requisitos: tono amable para dormir; vocabulario claro; 4–8 párrafos; final positivo; ' +
    'evitar miedo excesivo/violencia/marcas reales; diversidad e inclusión. ' +
    'Al final, añade SOLO un bloque JSON entre ```json ... ``` con: ' +
    '{"age_range","skill","tone","locale","title"}.'
  );
}

function userPrompt(b: StoryRequest): string {
  const minutes = b.reading_time_minutes ?? 4;
  const chars = b.characters || 'protagonista sin nombre y un amigo imaginario';
  const tone = b.tone ?? 'tierno';
  const loc = b.locale ?? 'es-LATAM';
  return [
    `Edad: ${b.age_range}`,
    `Tema: ${b.theme}`,
    `Habilidad socioemocional: ${b.skill}`,
    `Personajes: ${chars}`,
    `Locale: ${loc}`,
    `Tono: ${tone}`,
    `Duración estimada (min): ${minutes}`,
    '',
    'Escribe el cuento siguiendo los requisitos. Luego agrega el bloque JSON como se indicó.',
  ].join('\n');
}

// ---- Handler
export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    return NextResponse.json({ error: 'Missing OPENAI_API_KEY' }, { status: 500, headers });
  }

  // Body
  let jsonBody: unknown;
  try {
    jsonBody = await req.json();
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }
  if (!isStoryRequest(jsonBody)) {
    return NextResponse.json({ error: 'Invalid body: fields missing or wrong type' }, { status: 400, headers });
  }
  const body = jsonBody;

  // Llamada a OpenAI
  const payload = {
    model: 'gpt-4o-mini',
    messages: [
      { role: 'system', content: systemPrompt() },
      { role: 'user', content: userPrompt(body) },
    ],
    temperature: 0.9,
    max_tokens: 2000,
  };

  const openaiRes = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify(payload),
  });

  if (!openaiRes.ok) {
    const t = await openaiRes.text();
    return NextResponse.json({ error: `OpenAI ${openaiRes.status}`, details: t }, { status: 502, headers });
  }

  const first = (await openaiRes.json()) as OpenAIChatResponse;
  let content = first?.choices?.[0]?.message?.content ?? '';
  const finish = first?.choices?.[0]?.finish_reason;

  // Si se cortó por tokens, 2ª pasada para completar
  if (finish === 'length') {
    const contPayload = {
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content:
            'Eres Cuentero/A. Continúa EXACTAMENTE donde quedó el texto anterior, sin repetir. ' +
            'Si el bloque JSON ya fue entregado, NO lo repitas; si no, inclúyelo al final.',
        },
        { role: 'assistant', content },
        { role: 'user', content: 'Continúa desde la última palabra sin repetir.' },
      ],
      temperature: 0.9,
      max_tokens: 1200,
    };
    const contRes = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(contPayload),
    });
    if (contRes.ok) {
      const contJson = (await contRes.json()) as OpenAIChatResponse;
      const extra = contJson?.choices?.[0]?.message?.content ?? '';
      content = `${content}\n${extra}`.trim();
    }
  }

  return NextResponse.json({ content }, { status: 200, headers });
}

