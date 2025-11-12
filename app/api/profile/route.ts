export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { validateRequest } from "@/lib/auth";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { profiles, users } from "@/db/schema";

const PatchSchema = z.object({
  first_name: z.string().min(1).optional(),
  last_name: z.string().min(1).optional(),
  language: z.string().min(1).optional(),
  country: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  email: z.string().email().optional(),
});

export async function PUT(req: Request) {
  const respond = (body: unknown, init?: ResponseInit) =>
    jsonWithCors(req, body, init);
  try {
    const { user } = await validateRequest(req);
    if (!user) {
      return respond({ error: "Sesión inválida" }, { status: 401 });
    }

    const patch = PatchSchema.parse(await req.json());
    const [current] = await db
      .select({
        first_name: profiles.first_name,
        last_name: profiles.last_name,
      })
      .from(profiles)
      .where(eq(profiles.user_id, user.id))
      .limit(1);

    const updates: Partial<typeof profiles.$inferInsert> = {};

    if (patch.first_name !== undefined) {
      updates.first_name = patch.first_name;
    }
    if (patch.last_name !== undefined) {
      updates.last_name = patch.last_name;
    }
    if (patch.first_name !== undefined || patch.last_name !== undefined) {
      const finalFirst = patch.first_name ?? current?.first_name ?? "";
      const finalLast = patch.last_name ?? current?.last_name ?? "";
      updates.display_name = `${finalFirst} ${finalLast}`.trim();
    }
    if (patch.language !== undefined) {
      updates.language = patch.language;
    }
    if (patch.country !== undefined) {
      updates.country = patch.country;
    }
    if (patch.phone !== undefined) {
      updates.phone = patch.phone;
    }

    const wantsEmailUpdate =
      patch.email !== undefined && patch.email !== user.email;

    if (!Object.keys(updates).length && !wantsEmailUpdate) {
      return respond({ error: "Sin cambios" }, { status: 400 });
    }

    if (Object.keys(updates).length) {
      await db
        .update(profiles)
        .set(updates)
        .where(eq(profiles.user_id, user.id));
    }

    if (wantsEmailUpdate && patch.email) {
      const existing = await db
        .select({ id: users.id })
        .from(users)
        .where(eq(users.email, patch.email))
        .limit(1);

      if (existing.length && existing[0].id !== user.id) {
        return respond({ error: "Email en uso" }, { status: 409 });
      }

      await db
        .update(users)
        .set({ email: patch.email })
        .where(eq(users.id, user.id));

      await db
        .update(profiles)
        .set({ email: patch.email })
        .where(eq(profiles.user_id, user.id));
    }

    const [updated] = await db
      .select({
        id: users.id,
        email: users.email,
        profile: {
          first_name: profiles.first_name,
          last_name: profiles.last_name,
          language: profiles.language,
          country: profiles.country,
          phone: profiles.phone,
        },
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.user_id, users.id))
      .where(eq(users.id, user.id))
      .limit(1);

    if (!updated) {
      return respond({ error: "Perfil no encontrado" }, { status: 404 });
    }

    return respond({
      id: updated.id,
      email: updated.email,
      first_name: updated.profile?.first_name ?? null,
      last_name: updated.profile?.last_name ?? null,
      language: updated.profile?.language ?? null,
      country: updated.profile?.country ?? null,
      phone: updated.profile?.phone ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "No se pudo actualizar";
    return respond({ error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
