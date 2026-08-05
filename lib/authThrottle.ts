// lib/authThrottle.ts
import { and, count, eq, gt, lt } from "drizzle-orm";
import { authThrottle } from "@/db/schema";
import { db } from "@/lib/db";
import {
  claveSujeto,
  inicioVentana,
  shouldThrottle,
  tocaLimpiar,
  type DecisionThrottle,
} from "@/lib/rateLimit";

/**
 * Parte de acceso a base del rate limiting. La decisión en sí vive en
 * lib/rateLimit.ts, que es puro y testeable; acá solo está el contar y el
 * registrar.
 */

/** ¿Cuántos intentos fallidos lleva este sujeto dentro de la ventana? */
export async function contarIntentos(
  scope: string,
  sujeto: string,
  windowMs: number,
  ahora: Date = new Date()
): Promise<number> {
  const [fila] = await db
    .select({ n: count() })
    .from(authThrottle)
    .where(
      and(
        eq(authThrottle.scope, scope),
        eq(authThrottle.subjectKey, claveSujeto(sujeto)),
        gt(authThrottle.createdAt, inicioVentana(windowMs, ahora))
      )
    );

  return fila?.n ?? 0;
}

export async function evaluarThrottle(
  scope: string,
  sujeto: string,
  limit: number,
  windowMs: number,
  ahora: Date = new Date()
): Promise<DecisionThrottle> {
  const count = await contarIntentos(scope, sujeto, windowMs, ahora);
  return shouldThrottle({ count, limit, windowMs });
}

/**
 * Registra un intento fallido. Aprovecha para arrastrar la limpieza de lo
 * viejo 1 de cada 20 veces: alcanza para esta tabla y evita depender de un cron.
 */
export async function registrarIntentoFallido(
  scope: string,
  sujeto: string
): Promise<void> {
  await db.insert(authThrottle).values({
    scope,
    subjectKey: claveSujeto(sujeto),
  });

  if (tocaLimpiar()) {
    const limite = new Date(Date.now() - 24 * 60 * 60 * 1000);
    await db.delete(authThrottle).where(lt(authThrottle.createdAt, limite));
  }
}
