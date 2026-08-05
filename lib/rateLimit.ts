// lib/rateLimit.ts
import { createHash } from "node:crypto";

/**
 * Rate limiting sobre la tabla auth_throttle, sin Redis ni infra nueva.
 *
 * Por que hace falta: un codigo TOTP tiene 10^6 combinaciones y con ventana ±1
 * hay 3 validos a la vez, o sea ~3x10^-6 por intento. Sin limite, quien tenga
 * la contraseña rompe el segundo factor en minutos. Con 10 intentos cada 15
 * minutos, la esperanza para acertar pasa a ser del orden de años.
 */

export const SCOPE_MFA = "mfa_verify";
export const SCOPE_LOGIN = "login";

export const LIMITE_MFA = 10;
export const VENTANA_MFA_MS = 15 * 60 * 1000;

export type DecisionThrottle =
  | { limitado: false }
  | { limitado: true; retryAfterSegundos: number };

/**
 * Decision pura: el conteo se inyecta, asi que esto se testea sin base.
 */
export function shouldThrottle({
  count,
  limit,
  windowMs,
}: {
  count: number;
  limit: number;
  windowMs: number;
}): DecisionThrottle {
  if (count < limit) return { limitado: false };
  return { limitado: true, retryAfterSegundos: Math.ceil(windowMs / 1000) };
}

/** Clave de sujeto hasheada: la tabla no guarda user ids ni IPs en claro. */
export function claveSujeto(valor: string): string {
  return createHash("sha256").update(valor).digest("hex");
}

export function inicioVentana(
  windowMs: number,
  ahora: Date = new Date()
): Date {
  return new Date(ahora.getTime() - windowMs);
}

/**
 * Limpieza oportunista: en vez de un cron, 1 de cada 20 requests arrastra el
 * borrado de lo viejo. Barato y suficiente para una tabla de este volumen.
 */
export function tocaLimpiar(): boolean {
  return Math.random() < 0.05;
}
