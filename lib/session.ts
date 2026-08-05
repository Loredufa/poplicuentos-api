// lib/session.ts
import { cookies } from "next/headers";
import { eq } from "drizzle-orm";
import { auth } from "@/lib/auth";
import { db } from "@/lib/db";
import { profiles, users } from "@/db/schema";

/**
 * Crea la sesion de Lucia, setea la cookie y arma el payload de usuario.
 *
 * Estaba duplicado literalmente en /api/login y /api/register, y con el 2FA
 * pasa a hacer falta en un tercer lugar (/api/auth/2fa/verify-login). La forma
 * de la respuesta tiene que ser identica en los tres: el cliente exige
 * `{ token, user }` y tira "Respuesta de login incompleta" ante cualquier otra.
 */

export type UsuarioSesion = {
  id: string;
  email: string;
  first_name: string | null;
  last_name: string | null;
  language: string | null;
  country: string | null;
  phone: string | null;
};

export type SesionEmitida = {
  token: string;
  user: UsuarioSesion;
};

export async function issueSession(userId: string): Promise<SesionEmitida> {
  const session = await auth.createSession(userId, {});
  const sessionCookie = auth.createSessionCookie(session.id);
  const cookieStore = await cookies();
  cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

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
    .where(eq(users.id, userId))
    .limit(1);

  const profile = record?.profile;

  return {
    // El "token" de esta API es el session id de Lucia crudo, no un JWT.
    token: session.id,
    user: {
      id: userId,
      email: record?.email ?? "",
      first_name: profile?.first_name ?? null,
      last_name: profile?.last_name ?? null,
      language: profile?.language ?? null,
      country: profile?.country ?? null,
      phone: profile?.phone ?? null,
    },
  };
}
