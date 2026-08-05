// app/api/auth/2fa/enable/route.ts
export const runtime = "nodejs";

import { randomUUID } from "node:crypto";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { userBackupCodes, userTotp } from "@/db/schema";
import { db } from "@/lib/db";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/requireAuth";
import { decryptSecret } from "@/lib/crypto/secretBox";
import { verificarCodigo } from "@/lib/totp";
import { generarCodigos, hashearCodigo } from "@/lib/backupCodes";
import { evaluarThrottle, registrarIntentoFallido } from "@/lib/authThrottle";
import { LIMITE_MFA, SCOPE_MFA, VENTANA_MFA_MS } from "@/lib/rateLimit";

const Body = z.object({ code: z.string().min(1) });

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/**
 * Paso 2 del enrolamiento: confirma que el usuario cargo bien el secreto y
 * activa el 2FA.
 *
 * Devuelve los codigos de respaldo en claro UNA sola vez. Son la unica via de
 * recuperacion si pierde el telefono.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { user } = auth;

    const { code } = Body.parse(await req.json());

    const throttle = await evaluarThrottle(SCOPE_MFA, user.id, LIMITE_MFA, VENTANA_MFA_MS);
    if (throttle.limitado) {
      return jsonWithCors(
        req,
        { error: "Demasiados intentos. Probá más tarde.", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSegundos) } }
      );
    }

    const [fila] = await db
      .select()
      .from(userTotp)
      .where(eq(userTotp.userId, user.id))
      .limit(1);

    if (!fila) {
      return jsonWithCors(
        req,
        { error: "No hay un enrolamiento pendiente", code: "NO_SETUP" },
        { status: 409 }
      );
    }

    if (fila.status === "active") {
      return jsonWithCors(
        req,
        { error: "El 2FA ya está activo", code: "ALREADY_ENABLED" },
        { status: 409 }
      );
    }

    const secreto = decryptSecret(fila.secretEncrypted, user.id);
    const resultado = verificarCodigo(secreto, code, fila.lastUsedStep);

    if (!resultado.valido) {
      await registrarIntentoFallido(SCOPE_MFA, user.id);
      return jsonWithCors(
        req,
        { error: "Código incorrecto", code: "INVALID_CODE" },
        { status: 400 }
      );
    }

    const codigos = generarCodigos();
    const batchId = randomUUID();
    const ahora = new Date();

    // db.batch y NO db.transaction: el driver neon-http no soporta
    // transacciones y lanza en runtime. Sin atomicidad, el 2FA podria quedar
    // activo sin codigos de respaldo y el usuario a un telefono perdido de
    // perder la cuenta.
    await db.batch([
      db
        .update(userTotp)
        .set({
          status: "active",
          confirmedAt: ahora,
          updatedAt: ahora,
          lastUsedStep: resultado.paso,
        })
        .where(eq(userTotp.userId, user.id)),
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
      return jsonWithCors(req, { error: "Código inválido" }, { status: 400 });
    }
    console.error("Error en /api/auth/2fa/enable:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}
