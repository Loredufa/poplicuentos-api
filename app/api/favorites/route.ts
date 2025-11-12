// app/api/favorites/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { desc, eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateRequest } from "@/lib/auth";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { favorites } from "@/db/schema";

const FavoriteSchema = z.object({
  title: z.string().min(1),
  story: z.string().min(1),
  age_range: z.string().min(1).optional().nullable(),
  skill: z.string().min(1).optional().nullable(),
  tone: z.string().min(1).optional().nullable(),
  minutes: z.coerce.number().int().min(0).optional(),
});

const selection = {
  id: favorites.id,
  user_id: favorites.user_id,
  title: favorites.title,
  story: favorites.story,
  age_range: favorites.age_range,
  skill: favorites.skill,
  tone: favorites.tone,
  minutes: favorites.minutes,
  created_at: favorites.created_at,
};

export async function POST(req: Request) {
  const respond = (body: unknown, init?: ResponseInit) =>
    jsonWithCors(req, body, init);
  try {
    const { user } = await validateRequest(req);
    if (!user) {
      return respond({ error: "Sesión inválida" }, { status: 401 });
    }

    const payload = FavoriteSchema.parse(await req.json());
    const [inserted] = await db
      .insert(favorites)
      .values({
        user_id: user.id,
        title: payload.title,
        story: payload.story,
        age_range: payload.age_range ?? null,
        skill: payload.skill ?? null,
        tone: payload.tone ?? null,
        minutes: payload.minutes ?? 0,
      })
      .returning(selection);

    return respond(inserted, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "No se pudo guardar";
    return respond({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  const respond = (body: unknown, init?: ResponseInit) =>
    jsonWithCors(req, body, init);
  try {
    const { user } = await validateRequest(req);
    if (!user) {
      return respond({ error: "Sesión inválida" }, { status: 401 });
    }

    const rows = await db
      .select(selection)
      .from(favorites)
      .where(eq(favorites.user_id, user.id))
      .orderBy(desc(favorites.created_at));

    return respond(rows, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "No se pudieron obtener";
    return respond({ error: message }, { status: 500 });
  }
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
