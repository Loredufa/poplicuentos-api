// app/api/auth/reset-password/route.ts
export const runtime = "nodejs";

import { passwordResetCodes, users } from "@/db/schema";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { and, desc, eq, gt, isNull } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

export async function POST(req: NextRequest) {
  try {
    const { email, code, newPassword } = await req.json();

    if (
      !email ||
      typeof email !== "string" ||
      !code ||
      typeof code !== "string" ||
      !newPassword ||
      typeof newPassword !== "string"
    ) {
      return jsonWithCors(
        req,
        { error: "Datos inválidos" },
        { status: 400 }
      );
    }

    // Buscar usuario
    const [user] = await db.select().from(users).where(eq(users.email, email));

    if (!user) {
      return jsonWithCors(
        req,
        { error: "Código o email inválido" },
        { status: 400 }
      );
    }

    const now = new Date();

    // Buscar el último código válido para ese usuario
    const [reset] = await db
      .select()
      .from(passwordResetCodes)
      .where(
        and(
          eq(passwordResetCodes.userId, user.id),
          isNull(passwordResetCodes.usedAt),
          gt(passwordResetCodes.expiresAt, now)
        )
      )
      .orderBy(desc(passwordResetCodes.createdAt))
      .limit(1);

    if (!reset) {
      return jsonWithCors(
        req,
        { error: "Código inválido o expirado" },
        { status: 400 }
      );
    }

    // Comparar código con el hash
    const isValid = await bcrypt.compare(code, reset.codeHash);

    if (!isValid) {
      return jsonWithCors(
        req,
        { error: "Código inválido" },
        { status: 400 }
      );
    }

    // Hashear nueva contraseña
    const newHashedPassword = await bcrypt.hash(newPassword, 10);

    // Actualizar contraseña del usuario
    await db
      .update(users)
      .set({ hashed_password: newHashedPassword })
      .where(eq(users.id, user.id));

    // Marcar código como usado
    await db
      .update(passwordResetCodes)
      .set({ usedAt: now })
      .where(eq(passwordResetCodes.id, reset.id));

    return jsonWithCors(req, {
      message: "Contraseña actualizada correctamente",
    });
  } catch (error) {
    console.error("Error en reset-password:", error);
    return jsonWithCors(
      req,
      { error: "Error interno" },
      { status: 500 }
    );
  }
}
