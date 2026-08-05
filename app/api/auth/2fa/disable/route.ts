// app/api/auth/2fa/disable/route.ts
export const runtime = "nodejs";

import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { userBackupCodes, userTotp, users } from "@/db/schema";
import { db } from "@/lib/db";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/requireAuth";

const Body = z.object({ password: z.string().min(1) });

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/**
 * Desactiva el 2FA. Pide la contraseña, no un código del autenticador.
 *
 * Es una decisión explícita: pedir además el código protegería mejor contra una
 * sesión robada, pero dejaría sin salida a quien perdió el teléfono y ya gastó
 * los códigos de respaldo. Como no hay recuperación por email ni desactivación
 * por soporte, esa salida tiene que existir en algún lado.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { user } = auth;

    const { password } = Body.parse(await req.json());

    const [cuenta] = await db
      .select({ hashed_password: users.hashed_password })
      .from(users)
      .where(eq(users.id, user.id))
      .limit(1);

    if (!cuenta || !(await compare(password, cuenta.hashed_password))) {
      return jsonWithCors(
        req,
        { error: "La contraseña es incorrecta" },
        { status: 400 }
      );
    }

    const [fila] = await db
      .select()
      .from(userTotp)
      .where(eq(userTotp.userId, user.id))
      .limit(1);

    if (!fila || fila.status !== "active") {
      return jsonWithCors(
        req,
        { error: "El 2FA no está activo", code: "NOT_ENABLED" },
        { status: 409 }
      );
    }

    // Los códigos de respaldo se van con el secreto: dejarlos sería dejar
    // credenciales válidas para un mecanismo que ya no existe.
    await db.batch([
      db.delete(userTotp).where(eq(userTotp.userId, user.id)),
      db.delete(userBackupCodes).where(eq(userBackupCodes.userId, user.id)),
    ]);

    return jsonWithCors(req, { ok: true });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonWithCors(req, { error: "Datos inválidos" }, { status: 400 });
    }
    console.error("Error en /api/auth/2fa/disable:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}
