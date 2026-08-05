// app/api/auth/2fa/setup/route.ts
export const runtime = "nodejs";

import { eq } from "drizzle-orm";
import { userTotp } from "@/db/schema";
import { db } from "@/lib/db";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/requireAuth";
import { encryptSecret, KEY_VERSION_ACTUAL } from "@/lib/crypto/secretBox";
import { construirUri, generarSecreto } from "@/lib/totp";

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/**
 * Paso 1 del enrolamiento: genera el secreto y devuelve lo necesario para que
 * el usuario lo cargue en su app autenticadora.
 *
 * Todavia NO activa el 2FA: queda en 'pending' hasta que /enable verifique un
 * codigo. Sin esa confirmacion, un enrolamiento abandonado dejaria la cuenta
 * pidiendo un segundo factor que el usuario nunca termino de configurar.
 */
export async function POST(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { user } = auth;

    const [existente] = await db
      .select()
      .from(userTotp)
      .where(eq(userTotp.userId, user.id))
      .limit(1);

    if (existente?.status === "active") {
      // Hay que desactivar primero. Evita que una sesion robada re-enrole un
      // autenticador nuevo sin pasar por la contraseña.
      return jsonWithCors(
        req,
        { error: "El 2FA ya está activo", code: "ALREADY_ENABLED" },
        { status: 409 }
      );
    }

    const secreto = generarSecreto();
    const secretEncrypted = encryptSecret(secreto, user.id);
    const ahora = new Date();

    if (existente) {
      // Pisa cualquier enrolamiento pendiente anterior: no hace falta un
      // endpoint de cancelar.
      await db
        .update(userTotp)
        .set({
          secretEncrypted,
          keyVersion: KEY_VERSION_ACTUAL,
          status: "pending",
          lastUsedStep: null,
          confirmedAt: null,
          updatedAt: ahora,
        })
        .where(eq(userTotp.userId, user.id));
    } else {
      await db.insert(userTotp).values({
        userId: user.id,
        secretEncrypted,
        keyVersion: KEY_VERSION_ACTUAL,
        status: "pending",
      });
    }

    return jsonWithCors(req, {
      secret: secreto,
      otpauthUri: construirUri(secreto, user.email),
    });
  } catch (error) {
    console.error("Error en /api/auth/2fa/setup:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}
