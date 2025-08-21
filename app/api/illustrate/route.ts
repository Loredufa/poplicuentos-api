// app/api/illustrate/route.ts — Edge aggregator, sin cambiar la app
import { NextRequest, NextResponse } from 'next/server';
export const runtime = 'edge';

type Scene = 'intro' | 'conflict' | 'ending';

const ALLOW = (process.env.ORIGIN_ALLOWLIST ?? '*')
  .split(',').map(s => s.trim()).filter(Boolean);

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

export async function POST(req: NextRequest) {
  const origin = req.headers.get('origin');
  const headers = { 'Content-Type': 'application/json', ...cors(origin) };

  // Leemos el body una sola vez y lo reusamos
  let bodyText = '';
  try { bodyText = await req.text(); }
  catch { return NextResponse.json({ error: 'Invalid body' }, { status: 400, headers }); }

  // URL pública del mismo deployment (evita CORS)
  const base = new URL(req.url).origin;

  // Construye la URL del micro-endpoint de 1 imagen
  const makeUrl = (scene: Scene) => `${base}/api/illustrate-one?scene=${scene}`;

  // Disparamos 3 requests en paralelo
  const scenes: Scene[] = ['intro', 'conflict', 'ending'];

  // Helper: una promesa etiquetada para poder "racear" y recolectar
  const tagged = (p: Promise<Response>, tag: Scene) =>
    p.then(async (res) => {
       if (!res.ok) {
         const ct = res.headers.get('content-type') || '';
         const err = ct.includes('application/json') ? JSON.stringify(await res.json()) : await res.text();
         throw new Error(`SCENE ${tag} ${res.status}: ${err.slice(0, 800)}`);
       }
       const j = await res.json();
       const url: unknown = j?.image;
       if (typeof url !== 'string') throw new Error(`SCENE ${tag}: invalid payload`);
       return { scene: tag, url };
    });

  // Lanzamos los fetch en paralelo
  const pending: Array<Promise<{ scene: Scene; url: string }>> = scenes.map((scene) =>
    tagged(fetch(makeUrl(scene), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: bodyText,          // reusamos el body original
    }), scene)
  );

  const images: string[] = [];
  const errors: string[] = [];
  const deadline = Date.now() + 23_000; // Edge exige respuesta inicial <~25s

  // Vamos resolviendo a medida que llegan: devolvemos cuando haya 2 o cuando se agote el tiempo
  while (pending.length && Date.now() < deadline && images.length < 2) {
    // Carrera entre las promesas que quedan
    const race = Promise.race(
      pending.map((p, i) =>
        p.then((v) => ({ ok: true as const, i, v }))
         .catch((e: unknown) => ({ ok: false as const, i, e }))
      )
    );

    // Además, cortamos si se pasó el tiempo
    const left = Math.max(0, deadline - Date.now());
    const timed = Promise.race([
      race,
      new Promise<{ timeout: true }>((r) => setTimeout(() => r({ timeout: true }), left)),
    ]);

    const outcome = await timed;

    if ((outcome as any)?.timeout) break;

    const { ok, i } = outcome as { ok: boolean; i: number; v?: any; e?: unknown };
    const winner = pending.splice(i, 1)[0]; // retiramos la promesa ya resuelta
    try { await winner; } catch {}

    if (ok) {
      const { v } = outcome as { ok: true; i: number; v: { scene: Scene; url: string } };
      images.push(v.url);
    } else {
      const { e } = outcome as { ok: false; i: number; e: unknown };
      errors.push(String((e as Error)?.message || e));
    }
  }

  // Si aún queda tiempo, vemos si alguna otra terminó mientras tanto
  const leftovers = await Promise.allSettled(pending);
  for (const r of leftovers) {
    if (r.status === 'fulfilled') images.push(r.value.url);
    else errors.push(String((r.reason as Error)?.message || r.reason));
  }

  if (!images.length) {
    return NextResponse.json(
      { error: 'Upstream error', details: errors[0] || 'No image generated' },
      { status: 502, headers },
    );
  }

  // Devolvemos 1–3 imágenes (la APK ya soporta longitud variable)
  return NextResponse.json({ images: images.slice(0, 3) }, { status: 200, headers });
}
