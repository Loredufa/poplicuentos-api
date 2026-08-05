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

export type Transporte = "resend" | "console";

/**
 * Elige el transporte. Funcion pura para poder testear la unica regla que
 * importa: que "console" NUNCA pueda activarse en un servidor desplegado.
 *
 * El transporte de consola imprime el contenido del mail en la terminal en vez
 * de enviarlo. En desarrollo es lo que se quiere: lo que hace falta es el
 * codigo de 6 digitos, no el correo, y esperar a la bandeja de entrada hace el
 * loop tres veces mas lento. Pero si se colara en un deploy, ningun usuario
 * recibiria su codigo Y quedaria escrito en los logs del servidor.
 *
 * Se miran DOS señales y alcanza con una:
 *
 *  - `VERCEL_ENV`: la setea Vercel sola en cada deploy y no se puede pisar
 *    desde el panel. Es la señal confiable.
 *  - `NODE_ENV`: sirve fuera de Vercel, pero SI se puede pisar a mano en el
 *    panel de variables. Confiar solo en ella deja la puerta abierta a que un
 *    `NODE_ENV=development` cargado por error silencie todo el correo de
 *    produccion.
 */
export function elegirTransporte(
  pedido: string | undefined,
  nodeEnv: string | undefined,
  vercelEnv?: string | undefined
): Transporte {
  if (pedido !== "console") return "resend";

  // Misma regla que lib/entorno.ts, pero con los valores inyectados para poder
  // testearla sin tocar process.env.
  const enDeploy = Boolean(vercelEnv) || nodeEnv === "production";

  if (enDeploy) {
    console.error(
      "[email] EMAIL_TRANSPORT=console IGNORADO: esto es un deploy y el correo se envia de verdad.",
      { nodeEnv, vercelEnv },
      "Sacá EMAIL_TRANSPORT de las variables de entorno: es solo para desarrollo local."
    );
    return "resend";
  }

  return "console";
}

/** Imprime el mail en la terminal en lugar de enviarlo. Solo fuera de produccion. */
function enviarPorConsola({ to, subject, html }: SendEmailInput): SendEmailResult {
  // El codigo de reseteo es lo unico que se necesita del mail en desarrollo,
  // asi que se extrae y se muestra aparte para no tener que leer el HTML.
  const codigo = html.match(/>\s*(\d{6})\s*</)?.[1];

  console.log(
    [
      "",
      "┌─ [email] TRANSPORTE DE CONSOLA — no se envio nada ─",
      `│ para:    ${to}`,
      `│ asunto:  ${subject}`,
      ...(codigo ? [`│ CODIGO:  ${codigo}`] : []),
      "└───────────────────────────────────────────────────",
      "",
    ].join("\n")
  );

  return { ok: true };
}

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
  const transporte = elegirTransporte(
    process.env.EMAIL_TRANSPORT,
    process.env.NODE_ENV,
    process.env.VERCEL_ENV
  );
  if (transporte === "console") {
    return enviarPorConsola({ to, subject, html });
  }

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
