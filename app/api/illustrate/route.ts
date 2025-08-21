// app/api/illustrate/route.ts — Edge aggregator (sin "any")
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

type Scene = 'intro' | 'conflict' | 'ending';

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

// ----- Helpers tipados
type OneImageResponse = { image?: string; scene?: Scene };

function makeOneUrl(base: string, scene: Scene) {
  return `${base}/api/illustrate-one?scene=${scene}`;
}

async function fetchScene(url: string, bodyText: string, scene: Scene): Promise<{ scene: Scene; url: string }> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: bodyText,
  });

  const ct = res.headers.get('content-type') || '';
  if (!res.ok) {
    const detail = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
    throw new Error(`SCENE ${scene} ${res.status}: ${detail.slice(0, 800)}`);
  }

  const json = (await res.json()) as OneImageResponse;
  const urlImg = json?.image;
  if (typeof urlImg !== 'string') throw new Error(`SCENE ${scene}: invalid payload`);
  return { scene, url: urlImg };
}

type RaceOutcome<T> =
  | { type: 'value'; index: number; value: T }
  | { type: 'error'; index: number; error: unknown }
  | { type: 'timeout' };

async function raceWithTimeout<T>(promises: Promise<T>[], ms: number): Promise<RaceOutcome<T>> {
  const indexed = promises.map((p, i) =>
    p.then((value) => ({ type: 'value' as const, index: i, value }))
      .catch((error) => ({ type: 'error' as const, index: i, error }))
  );
  const timeout = new Promise<RaceOutcome<T>>((resolve) =>
    setTimeout(() => resolve({ type: 'timeout' }), ms)
  );
  return Promise.race([...indexed, timeout]);
}

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  // Leemos el body como texto una sola vez y lo reutilizamos
  let bodyText = '';
  try {
    bodyText = await req.text();
    // validación mínima: debe ser JSON
    JSON.parse(bodyText);
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400, headers });
  }

  const base = new URL(req.url).origin;
  const scenes: Scene[] = ['intro', 'conflict', 'ending'];
  let pending: Array<Promise<{ scene: Scene; url: string }>> = scenes.map((scene) =>
    fetchScene(makeOneUrl(base, scene), bodyText, scene)
  );

  const images: string[] = [];
  const errors: string[] = [];

  const deadline = Date.now() + 23_000; // Edge necesita respuesta inicial <~25s

  // Vamos recolectando resultados hasta tener 2 imágenes o hasta el deadline
  while (pending.length && Date.now() < deadline && images.length < 2) {
    const msLeft = Math.max(0, deadline - Date.now());
    const outcome = await raceWithTimeout(pending, msLeft);

    if (outcome.type === 'timeout') break;

    // quitamos del array la promesa ganadora (o la que falló)
    const removed = pending.splice(outcome.index, 1)[0];
    // evitamos "unhandled" (ya resuelta/rechazada)
    try { await removed; } catch {}

    if (outcome.type === 'value') {
      images.push(outcome.value.url);
    } else if (outcome.type === 'error') {
      const msg = outcome.error instanceof Error ? outcome.error.message : String(outcome.error);
      errors.push(msg);
    }
  }

  // Recolectamos lo que haya terminado después del último race
  const rest = await Promise.allSettled(pending);
  for (const r of rest) {
    if (r.status === 'fulfilled') images.push(r.value.url);
    else errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
  }

  if (!images.length) {
    return NextResponse.json(
      { error: 'Upstream error', details: errors[0] || 'No image generated' },
      { status: 502, headers }
    );
  }

  return NextResponse.json({ images: images.slice(0, 3) }, { status: 200, headers });
}
