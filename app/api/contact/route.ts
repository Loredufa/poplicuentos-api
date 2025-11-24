import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { Resend } from "resend";
import { z } from "zod";

const Body = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    message: z.string().min(1),
});

export function OPTIONS(req: Request) {
    return optionsResponse(req);
}

export async function POST(req: Request) {
    try {
        const body = Body.parse(await req.json());
        const apiKey = process.env.RESEND_API_KEY;

        if (!apiKey) {
            console.error("RESEND_API_KEY is missing");
            return jsonWithCors(req, { error: "Error de configuración del servidor" }, { status: 500 });
        }

        const resend = new Resend(apiKey);

        await resend.emails.send({
            from: "no-reply@resend.dev",
            to: "lorenadifaur@gmail.com",
            subject: "desde poplicuentos",
            html: `
                <h1>Nuevo mensaje de contacto</h1>
                <p><strong>Nombre:</strong> ${body.name}</p>
                <p><strong>Email:</strong> ${body.email}</p>
                <p><strong>Mensaje:</strong></p>
                <p>${body.message.replace(/\n/g, '<br>')}</p>
            `,
        });

        return jsonWithCors(req, { ok: true, message: "Mensaje enviado correctamente" });
    } catch (e: any) {
        console.error("Error sending contact email:", e);
        return jsonWithCors(req, { error: e.message || "Error al enviar el mensaje" }, { status: 500 });
    }
}
