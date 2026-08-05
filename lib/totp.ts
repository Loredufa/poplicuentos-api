// lib/totp.ts
import * as OTPAuth from "otpauth";

/**
 * TOTP (RFC 6238) para el segundo factor.
 *
 * Los parametros NO son negociables: SHA-1 / 6 digitos / 30s es lo que soportan
 * Google Authenticator, Authy, 1Password y Microsoft Authenticator. Subirlo a
 * SHA-256 rompe el enrolamiento en la mayoria de esas apps.
 */

export const EMISOR = "Poplicuentos";
const ALGORITMO = "SHA1";
const DIGITOS = 6;
const PERIODO = 30; // segundos

/**
 * Ventana de tolerancia en pasos hacia atras y adelante. ±1 da 90s de margen,
 * que es lo que hace falta para absorber un reloj de telefono levemente
 * desfasado sin ampliar de mas la superficie de ataque.
 */
export const VENTANA = 1;

function construir(secretBase32: string): OTPAuth.TOTP {
  return new OTPAuth.TOTP({
    issuer: EMISOR,
    algorithm: ALGORITMO,
    digits: DIGITOS,
    period: PERIODO,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  });
}

/** Genera un secreto nuevo en base32, listo para guardar cifrado. */
export function generarSecreto(): string {
  return new OTPAuth.Secret({ size: 20 }).base32; // 160 bits, lo que pide el RFC
}

/**
 * URI `otpauth://` para el QR y para el deep link que abre la app autenticadora.
 * El label es lo que el usuario ve en su autenticador.
 */
export function construirUri(secretBase32: string, email: string): string {
  return new OTPAuth.TOTP({
    issuer: EMISOR,
    label: email,
    algorithm: ALGORITMO,
    digits: DIGITOS,
    period: PERIODO,
    secret: OTPAuth.Secret.fromBase32(secretBase32),
  }).toString();
}

/** El paso de tiempo TOTP correspondiente a un instante dado. */
export function pasoActual(ahora: Date = new Date()): number {
  return Math.floor(ahora.getTime() / 1000 / PERIODO);
}

export type ResultadoTotp =
  | { valido: true; paso: number }
  | { valido: false; motivo: "formato" | "incorrecto" | "reusado" };

/**
 * Valida un codigo TOTP.
 *
 * `ultimoPasoUsado` es el anti-replay: sin el, un codigo interceptado sigue
 * sirviendo durante toda la ventana de tolerancia (90s). Se rechaza cualquier
 * paso menor o igual al ultimo que ya se acepto para ese usuario.
 */
export function verificarCodigo(
  secretBase32: string,
  codigo: string,
  ultimoPasoUsado: number | null,
  ahora: Date = new Date()
): ResultadoTotp {
  const limpio = codigo.replace(/\s/g, "");
  if (!/^\d{6}$/.test(limpio)) {
    return { valido: false, motivo: "formato" };
  }

  const delta = construir(secretBase32).validate({
    token: limpio,
    timestamp: ahora.getTime(),
    window: VENTANA,
  });

  if (delta === null) {
    return { valido: false, motivo: "incorrecto" };
  }

  const paso = pasoActual(ahora) + delta;

  if (ultimoPasoUsado !== null && paso <= ultimoPasoUsado) {
    return { valido: false, motivo: "reusado" };
  }

  return { valido: true, paso };
}

/** Un input de 6 digitos es un TOTP; cualquier otra cosa se trata como codigo
 *  de respaldo. Permite no pedirle al usuario que elija el tipo. */
export function pareceCodigoTotp(input: string): boolean {
  return /^\d{6}$/.test(input.replace(/\s/g, ""));
}
