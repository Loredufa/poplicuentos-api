// app/api/auth/2fa/verify-login/route.ts
export const runtime = "nodejs";

import { and, eq, isNull, sql } from "drizzle-orm";
import { z } from "zod";
import { loginChallenges, userBackupCodes, userTotp } from "@/db/schema";
import { db } from "@/lib/db";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { decryptSecret } from "@/lib/crypto/secretBox";
import { pareceCodigoTotp, verificarCodigo } from "@/lib/totp";
import { buscarCodigo } from "@/lib/backupCodes";
import {
  evaluarChallenge,
  hashearToken,
  intentosRestantes,
} from "@/lib/mfaChallenge";
import { issueSession } from "@/lib/session";
import { evaluarThrottle, registrarIntentoFallido } from "@/lib/authThrottle";
import { LIMITE_MFA, SCOPE_MFA, VENTANA_MFA_MS } from "@/lib/rateLimit";

const Body = z.object({
  mfaToken: z.string().min(1),
  code: z.string().min(1),
  type: z.enum(["totp", "backup_code"]).optional(),
});

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/**
 * Canjea el challenge del login por una sesion real.
 *
 * Es la unica ruta de 2FA sin requireAuth: por definicion el usuario todavia no
 * tiene sesion. La autorizacion la da el mfaToken, que solo se emite despues de
 * validar la contraseña.
 */
export async function POST(req: Request) {
  try {
    const { mfaToken, code, type } = Body.parse(await req.json());

    const [challenge] = await db
      .select()
      .from(loginChallenges)
      .where(eq(loginChallenges.tokenHash, hashearToken(mfaToken)))
      .limit(1);

    // Mismo mensaje para "no existe" y "codigo incorrecto": no le confirmamos a
    // nadie que tenia un challenge valido en la mano.
    if (!challenge) {
      return jsonWithCors(
        req,
        { error: "Código incorrecto", code: "INVALID_CODE" },
        { status: 401 }
      );
    }

    const estado = evaluarChallenge(challenge);
    if (estado !== "valido") {
      // "Expiró" sí se distingue: es accionable para el usuario, que necesita
      // saber que tiene que volver a poner la contraseña.
      const expirado = estado === "expirado";
      return jsonWithCors(
        req,
        {
          error: expirado
            ? "El código de acceso expiró. Volvé a iniciar sesión."
            : "Código incorrecto",
          code: expirado ? "MFA_CHALLENGE_EXPIRED" : "INVALID_CODE",
        },
        { status: 401 }
      );
    }

    const throttle = await evaluarThrottle(
      SCOPE_MFA,
      challenge.userId,
      LIMITE_MFA,
      VENTANA_MFA_MS
    );
    if (throttle.limitado) {
      return jsonWithCors(
        req,
        { error: "Demasiados intentos. Probá más tarde.", code: "RATE_LIMITED" },
        { status: 429, headers: { "Retry-After": String(throttle.retryAfterSegundos) } }
      );
    }

    const usaTotp = type ? type === "totp" : pareceCodigoTotp(code);

    const fallar = async () => {
      await registrarIntentoFallido(SCOPE_MFA, challenge.userId);
      const [actualizado] = await db
        .update(loginChallenges)
        .set({ attempts: sql`${loginChallenges.attempts} + 1` })
        .where(eq(loginChallenges.id, challenge.id))
        .returning({ attempts: loginChallenges.attempts });

      const restantes = intentosRestantes({ ...challenge, attempts: actualizado.attempts });

      // Al agotar los intentos se quema el challenge: hay que volver a pasar
      // por la contraseña, que es lo que hace inviable la fuerza bruta.
      if (restantes === 0) {
        await db
          .update(loginChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(loginChallenges.id, challenge.id));
      }

      return jsonWithCors(
        req,
        { error: "Código incorrecto", code: "INVALID_CODE", attemptsLeft: restantes },
        { status: 401 }
      );
    };

    if (usaTotp) {
      const [totp] = await db
        .select()
        .from(userTotp)
        .where(and(eq(userTotp.userId, challenge.userId), eq(userTotp.status, "active")))
        .limit(1);

      if (!totp) return fallar();

      const secreto = decryptSecret(totp.secretEncrypted, challenge.userId);
      const resultado = verificarCodigo(secreto, code, totp.lastUsedStep);
      if (!resultado.valido) return fallar();

      const sesion = await issueSession(challenge.userId);

      await db.batch([
        db
          .update(loginChallenges)
          .set({ consumedAt: new Date() })
          .where(eq(loginChallenges.id, challenge.id)),
        // Anti-replay: el paso usado queda quemado para que el mismo codigo no
        // sirva otra vez dentro de su ventana de 90s.
        db
          .update(userTotp)
          .set({ lastUsedStep: resultado.paso, updatedAt: new Date() })
          .where(eq(userTotp.userId, challenge.userId)),
      ]);

      return jsonWithCors(req, sesion);
    }

    // --- Codigo de respaldo ---
    const disponibles = await db
      .select({ id: userBackupCodes.id, codeHash: userBackupCodes.codeHash })
      .from(userBackupCodes)
      .where(
        and(
          eq(userBackupCodes.userId, challenge.userId),
          isNull(userBackupCodes.usedAt)
        )
      );

    const filaId = buscarCodigo(code, challenge.userId, disponibles);
    if (!filaId) return fallar();

    const sesion = await issueSession(challenge.userId);

    await db.batch([
      db
        .update(loginChallenges)
        .set({ consumedAt: new Date() })
        .where(eq(loginChallenges.id, challenge.id)),
      db
        .update(userBackupCodes)
        .set({ usedAt: new Date() })
        .where(eq(userBackupCodes.id, filaId)),
    ]);

    return jsonWithCors(req, sesion);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return jsonWithCors(req, { error: "Datos inválidos" }, { status: 400 });
    }
    console.error("Error en /api/auth/2fa/verify-login:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}
