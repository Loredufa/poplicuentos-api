import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { sendEmail } from "@/lib/email";
import { z } from "zod";

const Body = z.object({
    name: z.string().min(1),
    email: z.string().email(),
    message: z.string().min(1),
});

export function OPTIONS(req: Request) {
    return optionsResponse(req);
}

/** El cuerpo del mail se arma con datos que escribe cualquiera desde el
 * formulario. Sin escapar, un `<script>` o un `<a href>` en el nombre o el
 * mensaje llega intacto al cliente de correo. */
function escapeHtml(value: string): string {
    return value
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

export async function POST(req: Request) {
    try {
        const body = Body.parse(await req.json());

        const result = await sendEmail({
            to: "lorenadufaur@gmail.com",
            subject: "desde poplicuentos",
            html: `
                <h1>Nuevo mensaje de contacto</h1>
                <p><strong>Nombre:</strong> ${escapeHtml(body.name)}</p>
                <p><strong>Email:</strong> ${escapeHtml(body.email)}</p>
                <p><strong>Mensaje:</strong></p>
                <p>${escapeHtml(body.message).replace(/\n/g, "<br>")}</p>
            `,
        });

        // A diferencia de request-reset, acá sí conviene avisarle al usuario:
        // no hay nada que filtrar y necesita saber que su mensaje no salió.
        if (!result.ok) {
            return jsonWithCors(
                req,
                { error: "No se pudo enviar el mensaje" },
                { status: 502 }
            );
        }

        return jsonWithCors(req, { ok: true, message: "Mensaje enviado correctamente" });
    } catch (e: unknown) {
        const message = e instanceof Error ? e.message : "Error al enviar el mensaje";
        console.error("Error sending contact email:", e);
        return jsonWithCors(req, { error: message }, { status: 500 });
    }
}
