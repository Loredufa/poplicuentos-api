import { describe, expect, it } from "vitest";
import {
  claveSujeto,
  inicioVentana,
  LIMITE_MFA,
  shouldThrottle,
  VENTANA_MFA_MS,
} from "../rateLimit";

const AHORA = new Date("2026-08-05T12:00:00.000Z");

describe("shouldThrottle", () => {
  it.each([0, 1, LIMITE_MFA - 1])("deja pasar con %i intentos previos", (count) => {
    expect(shouldThrottle({ count, limit: LIMITE_MFA, windowMs: VENTANA_MFA_MS })).toEqual(
      { limitado: false }
    );
  });

  it("corta justo al llegar al limite", () => {
    expect(
      shouldThrottle({ count: LIMITE_MFA, limit: LIMITE_MFA, windowMs: VENTANA_MFA_MS })
    ).toEqual({ limitado: true, retryAfterSegundos: 900 });
  });

  it("sigue cortando por encima del limite", () => {
    const r = shouldThrottle({
      count: LIMITE_MFA * 10,
      limit: LIMITE_MFA,
      windowMs: VENTANA_MFA_MS,
    });
    expect(r.limitado).toBe(true);
  });

  it("redondea el retryAfter hacia arriba", () => {
    const r = shouldThrottle({ count: 1, limit: 1, windowMs: 1500 });
    expect(r).toEqual({ limitado: true, retryAfterSegundos: 2 });
  });

  it("un limite de 0 corta siempre", () => {
    expect(shouldThrottle({ count: 0, limit: 0, windowMs: 1000 }).limitado).toBe(true);
  });
});

describe("parametros del limite de MFA", () => {
  // 10^6 combinaciones y 3 codigos validos a la vez -> ~3e-6 por intento.
  // Con estos numeros la esperanza para acertar es del orden de años; aflojarlos
  // vuelve el segundo factor rompible en minutos por quien tenga la contraseña.
  it("mantiene 10 intentos cada 15 minutos", () => {
    expect(LIMITE_MFA).toBe(10);
    expect(VENTANA_MFA_MS).toBe(15 * 60 * 1000);
  });

  it("deja la probabilidad de acierto por debajo de 1 en 30.000", () => {
    const porIntento = 3 / 1_000_000;
    expect(porIntento * LIMITE_MFA).toBeLessThan(1 / 30_000);
  });
});

describe("claveSujeto", () => {
  it("es determinista", () => {
    expect(claveSujeto("user-1")).toBe(claveSujeto("user-1"));
  });

  it("distingue sujetos distintos", () => {
    expect(claveSujeto("user-1")).not.toBe(claveSujeto("user-2"));
  });

  it("no guarda el valor en claro", () => {
    // La tabla no debe tener user ids ni IPs legibles.
    expect(claveSujeto("192.168.1.1")).not.toContain("192.168");
  });

  it("devuelve hex de 64 caracteres (SHA-256)", () => {
    expect(claveSujeto("x")).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("inicioVentana", () => {
  it("retrocede exactamente el largo de la ventana", () => {
    expect(inicioVentana(VENTANA_MFA_MS, AHORA)).toEqual(
      new Date(AHORA.getTime() - VENTANA_MFA_MS)
    );
  });
});
