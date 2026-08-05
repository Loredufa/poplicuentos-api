// lib/requireAuth.ts
import type { NextResponse } from "next/server";
import { validateRequest } from "@/lib/auth";
import { jsonWithCors } from "@/lib/cors";

type AuthOk = {
  ok: true;
  user: NonNullable<Awaited<ReturnType<typeof validateRequest>>["user"]>;
  session: NonNullable<Awaited<ReturnType<typeof validateRequest>>["session"]>;
};

type AuthFail = { ok: false; response: NextResponse };

/**
 * Envuelve validateRequest y estandariza el 401. Hasta ahora cada ruta repetia
 * el chequeo a mano y el mensaje divergia entre "Sesion invalida" y
 * "No autorizado" segun el archivo.
 *
 * Uso:
 *   const auth = await requireAuth(req);
 *   if (!auth.ok) return auth.response;
 *   // auth.user y auth.session ya vienen tipados como no-null
 */
export async function requireAuth(req: Request): Promise<AuthOk | AuthFail> {
  const { user, session } = await validateRequest(req);

  if (!user || !session) {
    return {
      ok: false,
      response: jsonWithCors(req, { error: "No autorizado" }, { status: 401 }),
    };
  }

  return { ok: true, user, session };
}
