// lib/crypto/secretBox.ts
import {
  createCipheriv,
  createDecipheriv,
  hkdfSync,
  randomBytes,
  timingSafeEqual,
} from "node:crypto";

/**
 * Cifrado del secreto TOTP y derivacion del pepper de los codigos de respaldo.
 *
 * El secreto TOTP tiene que ser RECUPERABLE para poder validar codigos, asi que
 * se cifra en vez de hashearse. Los codigos de respaldo si se hashean, pero con
 * un pepper que vive fuera de la base.
 *
 * Ambas subclaves salen de una unica env var (AUTH_ENC_KEY) derivada con HKDF y
 * un `info` distinto por proposito: una sola variable que operar, y ninguna
 * reutilizacion de clave entre mecanismos.
 *
 * ⚠ Si AUTH_ENC_KEY se pierde, todos los usuarios con 2FA quedan bloqueados de
 * forma definitiva: se cae el secreto TOTP Y los codigos de respaldo a la vez.
 * Tiene que estar guardada fuera de Vercel.
 */

const ALGORITMO = "aes-256-gcm";
const LARGO_CLAVE = 32; // AES-256
const LARGO_IV = 12; // recomendado para GCM
const LARGO_TAG = 16;

/** Version actual de la clave. Se guarda en user_totp.key_version para poder
 *  rotar mas adelante sin migracion de esquema. */
export const KEY_VERSION_ACTUAL = 1;

const INFO_TOTP = "totp-secret-v1";
const INFO_PEPPER = "backup-code-pepper-v1";

function claveMaestra(): Buffer {
  const raw = process.env.AUTH_ENC_KEY;
  if (!raw) {
    throw new Error(
      "AUTH_ENC_KEY no esta definida. Generala con: openssl rand -base64 32"
    );
  }

  const key = Buffer.from(raw, "base64");
  if (key.length !== LARGO_CLAVE) {
    throw new Error(
      `AUTH_ENC_KEY debe ser de ${LARGO_CLAVE} bytes en base64, ` +
        `pero decodifica a ${key.length}. Generala con: openssl rand -base64 32`
    );
  }
  return key;
}

/** HKDF-SHA256 sobre la clave maestra. El salt va vacio a proposito: la clave
 *  maestra ya es aleatoria de largo completo, no es material de baja entropia. */
function derivar(info: string): Buffer {
  return Buffer.from(hkdfSync("sha256", claveMaestra(), Buffer.alloc(0), info, LARGO_CLAVE));
}

/**
 * Cifra el secreto TOTP.
 *
 * `aad` (el user_id) queda autenticado pero no cifrado: ata el blob a su fila,
 * asi que copiar el ciphertext de un usuario a otro hace fallar el descifrado
 * incluso teniendo acceso de escritura a la base.
 *
 * Formato de salida: base64( iv(12) || authTag(16) || ciphertext ).
 */
export function encryptSecret(plano: string, aad: string): string {
  const iv = randomBytes(LARGO_IV);
  const cipher = createCipheriv(ALGORITMO, derivar(INFO_TOTP), iv);
  cipher.setAAD(Buffer.from(aad, "utf8"));

  const ciphertext = Buffer.concat([
    cipher.update(plano, "utf8"),
    cipher.final(),
  ]);

  return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]).toString("base64");
}

/**
 * Descifra el secreto TOTP. Lanza si el blob fue alterado, si la clave no es la
 * misma, o si el `aad` no coincide con el que se uso al cifrar.
 */
export function decryptSecret(blob: string, aad: string): string {
  const buf = Buffer.from(blob, "base64");
  if (buf.length <= LARGO_IV + LARGO_TAG) {
    throw new Error("Blob cifrado invalido: demasiado corto");
  }

  const iv = buf.subarray(0, LARGO_IV);
  const tag = buf.subarray(LARGO_IV, LARGO_IV + LARGO_TAG);
  const ciphertext = buf.subarray(LARGO_IV + LARGO_TAG);

  const decipher = createDecipheriv(ALGORITMO, derivar(INFO_TOTP), iv);
  decipher.setAAD(Buffer.from(aad, "utf8"));
  decipher.setAuthTag(tag);

  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

/** Pepper para el HMAC de los codigos de respaldo. Nunca toca la base. */
export function pepperCodigosRespaldo(): Buffer {
  return derivar(INFO_PEPPER);
}

/** Comparacion en tiempo constante de dos hashes en hex. */
export function hashesIguales(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "hex");
  const bufB = Buffer.from(b, "hex");
  // timingSafeEqual exige el mismo largo; el chequeo previo no filtra nada util
  // porque el largo del hash es fijo y publico.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
