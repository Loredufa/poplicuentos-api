// app/api/auth/request-reset/route.ts
export const runtime = "nodejs";

import { passwordResetCodes, users } from "@/db/schema";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomInt } from "crypto";
import { eq, sql } from "drizzle-orm";
import { NextRequest } from "next/server";
import { sendEmail } from "@/lib/email";
import { getResetPasswordEmail } from "@/lib/email-templates";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

/**
 * Mismo mensaje se responda lo que se responda: no revelamos si el email esta
 * registrado ni si el envio fallo. Un error explicito le avisaria al usuario,
 * pero filtraria que la cuenta existe (el caso "no existe" responde al instante).
 */
const RESPUESTA_GENERICA =
  "Si el email está registrado, te enviaremos un código para resetear la contraseña.";

export async function POST(req: NextRequest) {
  try {
    const { email: rawEmail } = await req.json();

    if (!rawEmail || typeof rawEmail !== "string") {
      return jsonWithCors(req, { error: "Email inválido" }, { status: 400 });
    }

    const email = rawEmail.trim().toLowerCase();

    // Lookup case-insensitive: la columna es `text` y compara sensible a
    // mayusculas, asi que un email guardado con mayusculas no matchearia.
    const [user] = await db
      .select()
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (!user) {
      console.warn("[request-reset] email no encontrado:", email);
      return jsonWithCors(req, { message: RESPUESTA_GENERICA });
    }

    // Generar código
    const code = randomInt(100000, 999999).toString();
    const codeHash = await bcrypt.hash(code, 10);
    const expiresAt = new Date(Date.now() + 15 * 60 * 1000); // 15 minutos

    // Se inserta antes de enviar para garantizar que el código ya es válido
    // cuando el correo sale. Si el envío falla, se borra abajo.
    const [inserted] = await db
      .insert(passwordResetCodes)
      .values({ userId: user.id, codeHash, expiresAt })
      .returning({ id: passwordResetCodes.id });

    const result = await sendEmail({
      to: user.email,
      subject: "Código para resetear tu contraseña",
      html: getResetPasswordEmail(code),
    });

    if (!result.ok) {
      // Sin este borrado queda un código huérfano en la base: válido, pero que
      // el usuario nunca recibió. Es lo que se veía en los datos de producción.
      await db
        .delete(passwordResetCodes)
        .where(eq(passwordResetCodes.id, inserted.id));
      console.error("[request-reset] no se pudo enviar el código:", result.error);
    }

    return jsonWithCors(req, { message: RESPUESTA_GENERICA });
  } catch (error) {
    console.error("Error en /api/auth/request-reset:", error);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}
