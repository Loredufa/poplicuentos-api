// app/api/auth/2fa/backup-codes/regenerate/route.ts
export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { userBackupCodes, userTotp, users } from "@/db/schema";
import { db } from "@/lib/db";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/requireAuth";
import { generarCodigos, hashearCodigo } from "@/lib/backupCodes";

const Body = z.object({ password: z.string().min(1) });

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/**
 * Genera un lote nuevo de códigos de respaldo e invalida el anterior.
 *
 * Pide la contraseña porque devuelve secretos en claro: con una sesión robada
 * bastaría para llevarse diez credenciales permanentes.
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

    const codigos = generarCodigos();
    const batchId = randomUUID();

    await db.batch([
      db.delete(userBackupCodes).where(eq(userBackupCodes.userId, user.id)),
      db.insert(userBackupCodes).values(
        codigos.map((c) => ({
          userId: user.id,
          batchId,
          codeHash: hashearCodigo(c, user.id),
        }))
      ),
    ]);

    return jsonWithCors(req, { ok: true, backupCodes: codigos });
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonWithCors(req, { error: "Datos inválidos" }, { status: 400 });
    }
    console.error("Error en /api/auth/2fa/backup-codes/regenerate:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}
