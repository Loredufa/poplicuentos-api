// lib/entorno.ts

/**
 * Detecta si el codigo corre en un servidor desplegado o en una maquina local.
 *
 * Existe porque `NODE_ENV` NO es una señal confiable acá: se puede cargar a mano
 * en el panel de variables de Vercel, y un `NODE_ENV=development` puesto por
 * error apaga en silencio cosas que dependen de el —el flag Secure de la cookie
 * de sesion, la salvaguarda del transporte de correo— sin que nada falle a la
 * vista.
 *
 * `VERCEL_ENV` la setea Vercel sola en cada deploy ('production' | 'preview' |
 * 'development') y no se puede pisar desde el panel. Se miran las dos señales y
 * alcanza con una: asi la configuracion mas insegura nunca gana.
 */
export function esDeploy(): boolean {
  return Boolean(process.env.VERCEL_ENV) || process.env.NODE_ENV === "production";
}
