import { validateRequest } from "@/lib/auth";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { db } from "@/lib/db";
import { getPasswordChangedEmail } from "@/lib/email-templates";
import { users } from "@/db/schema";
import { compare, hash } from "bcryptjs";
import { eq } from "drizzle-orm";
import { Resend } from "resend";
import { z } from "zod";

const Body = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(6),
});

export function OPTIONS(req: Request) {
    return optionsResponse(req);
}

export async function POST(req: Request) {
    try {
        // 1. Validar sesión
        const { user } = await validateRequest(req);
        if (!user) {
            return jsonWithCors(req, { error: "No autorizado" }, { status: 401 });
        }

        // 2. Validar body
        const body = Body.parse(await req.json());

        // 3. Obtener usuario actual para verificar contraseña anterior
        const [currentUser] = await db
            .select()
            .from(users)
            .where(eq(users.id, user.id))
            .limit(1);

        if (!currentUser) {
            return jsonWithCors(req, { error: "Usuario no encontrado" }, { status: 404 });
        }

        const validPassword = await compare(body.currentPassword, currentUser.hashed_password);
        if (!validPassword) {
            return jsonWithCors(req, { error: "La contraseña actual es incorrecta" }, { status: 400 });
        }

        // 4. Hashear nueva contraseña y actualizar
        const newHashed = await hash(body.newPassword, 12);
        await db
            .update(users)
            .set({ hashed_password: newHashed })
            .where(eq(users.id, user.id));

        // 5. Enviar email de notificación
        const apiKey = process.env.RESEND_API_KEY;
        if (apiKey) {
            const resend = new Resend(apiKey);
            await resend.emails.send({
                from: "no-reply@resend.dev",
                to: currentUser.email,
                subject: "Tu contraseña ha sido cambiada",
                html: getPasswordChangedEmail(),
            });
        }

        return jsonWithCors(req, { ok: true, message: "Contraseña actualizada" });
    } catch (e: any) {
        return jsonWithCors(req, { error: e.message || "Error interno" }, { status: 500 });
    }
}
