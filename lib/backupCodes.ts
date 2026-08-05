// lib/backupCodes.ts
import { createHmac, randomInt } from "node:crypto";
import { hashesIguales, pepperCodigosRespaldo } from "@/lib/crypto/secretBox";

/**
 * Codigos de respaldo de un solo uso.
 *
 * Son la UNICA via de recuperacion si el usuario pierde el telefono: no hay
 * reseteo por email ni desactivacion por soporte. Si se pierden los codigos y
 * el telefono, la cuenta queda inaccesible por diseño.
 */

/** Crockford base32 sin I, L, O ni U: descarta las confusiones visuales
 *  (I/1, O/0, L/1) y de paso evita que salga una palabrota al azar. */
const ALFABETO = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

const LARGO_GRUPO = 5;
const GRUPOS = 2; // XXXXX-XXXXX -> 10 caracteres utiles
export const CANTIDAD_CODIGOS = 10;

/**
 * Genera un lote de codigos en claro. Se le muestran al usuario UNA sola vez:
 * en la base solo queda el hash.
 */
export function generarCodigos(cantidad: number = CANTIDAD_CODIGOS): string[] {
  const codigos = new Set<string>();

  // Set en vez de array: la colision es astronomicamente improbable
  // (~50 bits por codigo) pero un duplicado haria que un solo uso queme dos.
  while (codigos.size < cantidad) {
    const grupos: string[] = [];
    for (let g = 0; g < GRUPOS; g++) {
      let grupo = "";
      for (let i = 0; i < LARGO_GRUPO; i++) {
        grupo += ALFABETO[randomInt(ALFABETO.length)];
      }
      grupos.push(grupo);
    }
    codigos.add(grupos.join("-"));
  }

  return [...codigos];
}

/**
 * Normaliza lo que tipeo el usuario: mayusculas, sin guiones ni espacios.
 * Asi da igual si lo copio con formato, sin formato o en minusculas.
 */
export function normalizar(codigo: string): string {
  return codigo.toUpperCase().replace(/[^0-9A-Z]/g, "");
}

/**
 * Hash del codigo para guardar en la base.
 *
 * HMAC-SHA256 y no bcrypt, por dos razones concretas:
 *  - Son aleatorios de alta entropia, no contraseñas elegidas por humanos: no
 *    hace falta un KDF lento.
 *  - Verificar contra 10 hashes bcrypt cuesta 0,6-1,0s en una funcion
 *    serverless. Inaceptable como UX y caro en compute.
 *
 * El pepper vive en la env y no en la base, asi que un dump de la base por si
 * solo no habilita fuerza bruta offline — que es el riesgo que normalmente
 * justificaria bcrypt.
 *
 * El user_id entra en el mensaje para que el mismo codigo en dos usuarios
 * distintos de hashes distintos.
 */
export function hashearCodigo(codigo: string, userId: string): string {
  return createHmac("sha256", pepperCodigosRespaldo())
    .update(`${userId}:${normalizar(codigo)}`)
    .digest("hex");
}

export type CodigoGuardado = { id: string; codeHash: string };

/**
 * Busca el codigo tipeado entre los no usados del usuario.
 * Devuelve el id de la fila a marcar como usada, o null si no matchea ninguno.
 */
export function buscarCodigo(
  codigo: string,
  userId: string,
  guardados: CodigoGuardado[]
): string | null {
  const normalizado = normalizar(codigo);
  // Largo esperado: GRUPOS * LARGO_GRUPO, ya sin separadores.
  if (normalizado.length !== GRUPOS * LARGO_GRUPO) return null;

  const hash = hashearCodigo(normalizado, userId);

  for (const fila of guardados) {
    if (hashesIguales(hash, fila.codeHash)) {
      return fila.id;
    }
  }
  return null;
}
