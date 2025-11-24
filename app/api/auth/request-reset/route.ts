// app/api/auth/request-reset/route.ts
export const runtime = "nodejs";

import { passwordResetCodes, users } from "@/db/schema";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { eq } from "drizzle-orm";
import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import { getResetPasswordEmail } from "@/lib/email-templates";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}



export async function POST(req: NextRequest) {
  try {
    const { email } = await req.json();

    if (!email || typeof email !== "string") {
      return jsonWithCors(req, { error: "Email inválido" }, { status: 400 });
    }

    // Buscar usuario
    const [user] = await db.select().from(users).where(eq(users.email, email));

    // No revelamos si existe o no
    if (!user) {
      console.warn("request-reset: email no encontrado:", email);
      console.warn("request-reset: email no encontrado:", email);
      return jsonWithCors(req, {
        message:
          "Si el email está registrado, te enviaremos un código para resetear la contraseña.",
      });
    }

    // Generar código
    const code = randomInt(100000, 999999).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Guardar en DB
    await db.insert(passwordResetCodes).values({
      userId: user.id,
      codeHash,
      expiresAt,
    });

    // --- Envío de mail con Resend ---

    const apiKey = process.env.RESEND_API_KEY;

    if (!apiKey) {
      console.error("RESEND_API_KEY no definida, no se envía el correo");
    } else {
      const resend = new Resend(apiKey); // ahora sí, dentro del try
      await resend.emails.send({
        from: "no-reply@resend.dev",
        to: email,
        subject: "Código para resetear tu contraseña",
        html: getResetPasswordEmail(code),
      });
    }

    return jsonWithCors(req, {
      message:
        "Si el email está registrado, te enviaremos un código para resetear la contraseña.",
    });
  } catch (error) {
    console.error("Error en /api/auth/request-reset:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}
