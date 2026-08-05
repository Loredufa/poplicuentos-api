// lib/mfaChallenge.ts
import { createHash, randomBytes } from "node:crypto";

/**
 * El estado intermedio del login: contraseña validada, falta el segundo factor.
 *
 * Hace falta porque el unico token del sistema es el session id de Lucia, y
 * crearlo ya significa estar adentro. El challenge es un token aparte, opaco y
 * de vida corta, que solo sirve para canjear un codigo TOTP por una sesion.
 */

/** 5 minutos: alcanza para abrir el autenticador y tipear, y es corto para un
 *  atacante que tenga la contraseña. */
export const TTL_MS = 5 * 60 * 1000;

/** Al sexto fallo se quema el challenge y hay que volver a poner la contraseña. */
export const MAX_INTENTOS = 5;

/** Token opaco de 32 bytes. Sin user id embebido y sin firma: no hace falta,
 *  porque se valida contra la base. */
export function generarToken(): string {
  return randomBytes(32).toString("base64url");
}

/**
 * Lo que se guarda en la base. Nunca el token en claro: un dump de
 * login_challenges no permite completar ningun login pendiente.
 */
export function hashearToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function calcularVencimiento(ahora: Date = new Date()): Date {
  return new Date(ahora.getTime() + TTL_MS);
}

export type FilaChallenge = {
  expiresAt: Date;
  consumedAt: Date | null;
  attempts: number;
};

export type EstadoChallenge =
  | "valido"
  | "expirado"
  | "consumido"
  | "demasiados_intentos";

/**
 * Funcion pura con toda la logica de decision del challenge. Es donde se
 * esconden los bugs de este tipo de flujo, asi que vive separada de la ruta
 * para poder testearla sin base de datos.
 *
 * El orden importa: "consumido" se evalua antes que "expirado" porque un
 * challenge ya usado no debe reportarse como vencido (seria una señal distinta
 * para quien este probando).
 */
export function evaluarChallenge(
  fila: FilaChallenge,
  ahora: Date = new Date()
): EstadoChallenge {
  if (fila.consumedAt !== null) return "consumido";
  if (fila.attempts >= MAX_INTENTOS) return "demasiados_intentos";
  if (fila.expiresAt.getTime() <= ahora.getTime()) return "expirado";
  return "valido";
}

/** Intentos que le quedan al usuario, para mostrarselo en la pantalla. */
export function intentosRestantes(fila: FilaChallenge): number {
  return Math.max(0, MAX_INTENTOS - fila.attempts);
}
