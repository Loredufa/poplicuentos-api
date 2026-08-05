// app/api/auth/2fa/status/route.ts
export const runtime = "nodejs";

import { and, count, eq, isNull } from "drizzle-orm";
import { userBackupCodes, userTotp } from "@/db/schema";
import { db } from "@/lib/db";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { requireAuth } from "@/lib/requireAuth";

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/** Estado del 2FA para la pantalla de Configuración. */
export async function GET(req: Request) {
  try {
    const auth = await requireAuth(req);
    if (!auth.ok) return auth.response;
    const { user } = auth;

    const [fila] = await db
      .select()
      .from(userTotp)
      .where(eq(userTotp.userId, user.id))
      .limit(1);

    const activo = fila?.status === "active";

    const [restantes] = activo
      ? await db
          .select({ n: count() })
          .from(userBackupCodes)
          .where(
            and(
              eq(userBackupCodes.userId, user.id),
              isNull(userBackupCodes.usedAt)
            )
          )
      : [{ n: 0 }];

    return jsonWithCors(req, {
      enabled: activo,
      confirmedAt: fila?.confirmedAt ?? null,
      backupCodesRemaining: restantes?.n ?? 0,
    });
  } catch (error) {
    console.error("Error en /api/auth/2fa/status:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}
