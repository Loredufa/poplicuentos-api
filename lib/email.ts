// lib/email.ts
import { Resend } from "resend";

/**
 * Remitente por defecto. `resend.dev` es el dominio compartido de pruebas de
 * Resend: solo permite enviar a la direccion duena de la cuenta, y cualquier
 * otro destinatario se rechaza con 403 sin dejar registro en el dashboard.
 * Cuando haya un dominio verificado, esto se resuelve seteando RESEND_FROM en
 * Vercel: no hay que tocar codigo.
 */
const DEFAULT_FROM = "no-reply@resend.dev";

export type SendEmailResult =
  | { ok: true }
  | { ok: false; error: string };

type SendEmailInput = {
  to: string;
  subject: string;
  html: string;
};

/**
 * Unico punto de envio de correo del proyecto.
 *
 * El motivo de que exista: `resend.emails.send()` devuelve `{ data, error }` y
 * NO lanza cuando la API rechaza el envio. Hacer `await` sin mirar `error` deja
 * el fallo completamente invisible: no hay excepcion, no hay log, y la ruta
 * responde 200 como si todo hubiera salido bien. Fue exactamente lo que paso
 * con los correos de reseteo.
 */
export async function sendEmail({
  to,
  subject,
  html,
}: SendEmailInput): Promise<SendEmailResult> {
  const apiKey = process.env.RESEND_API_KEY;
  if (!apiKey) {
    const error = "RESEND_API_KEY no esta definida";
    console.error("[email] no se envia:", error, { to, subject });
    return { ok: false, error };
  }

  const from = process.env.RESEND_FROM || DEFAULT_FROM;
  const resend = new Resend(apiKey);

  try {
    const { data, error } = await resend.emails.send({ from, to, subject, html });

    if (error) {
      // El caso que nos interesa capturar: la API rechazo el envio.
      console.error("[email] Resend rechazo el envio:", {
        from,
        to,
        subject,
        name: error.name,
        message: error.message,
      });
      return { ok: false, error: error.message ?? "Resend rechazo el envio" };
    }

    console.log("[email] enviado:", { to, subject, id: data?.id });
    return { ok: true };
  } catch (e: unknown) {
    // Fallo de red o excepcion inesperada del SDK.
    const message = e instanceof Error ? e.message : "Error desconocido";
    console.error("[email] excepcion al enviar:", { from, to, subject, message });
    return { ok: false, error: message };
  }
}
