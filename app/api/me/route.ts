import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { validateRequest } from "@/lib/auth";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { profiles, users } from "@/db/schema";

export async function GET(req: Request) {
  try {
    const { user } = await validateRequest(req);
    if (!user) {
      return jsonWithCors(req, { error: "Sesión inválida" }, { status: 401 });
    }

    const [record] = await db
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

    if (!record) {
      return jsonWithCors(req, { error: "Usuario no encontrado" }, { status: 404 });
    }

    const profile = record.profile;
    return jsonWithCors(req, {
      id: record.id,
      email: record.email,
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      language: profile?.language ?? null,
      country: profile?.country ?? null,
      phone: profile?.phone ?? null,
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Error al obtener el perfil";
    return jsonWithCors(req, { error: message }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
