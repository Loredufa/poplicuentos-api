import { describe, expect, it } from "vitest";
import {
  calcularVencimiento,
  evaluarChallenge,
  generarToken,
  hashearToken,
  intentosRestantes,
  MAX_INTENTOS,
  TTL_MS,
  type FilaChallenge,
} from "../mfaChallenge";

const AHORA = new Date("2026-08-05T12:00:00.000Z");

function fila(over: Partial<FilaChallenge> = {}): FilaChallenge {
  return {
    expiresAt: new Date(AHORA.getTime() + 60_000),
    consumedAt: null,
    attempts: 0,
    ...over,
  };
}

describe("generarToken", () => {
  it("es base64url, sin caracteres que rompan una URL", () => {
    expect(generarToken()).toMatch(/^[A-Za-z0-9_-]+$/);
  });

  it("tiene 43 caracteres: 32 bytes en base64url sin padding", () => {
    expect(generarToken()).toHaveLength(43);
  });

  it("no se repite entre llamadas", () => {
    const tokens = new Set(Array.from({ length: 200 }, () => generarToken()));
    expect(tokens.size).toBe(200);
  });
});

describe("hashearToken", () => {
  it("es determinista", () => {
    expect(hashearToken("abc")).toBe(hashearToken("abc"));
  });

  it("no deja el token legible", () => {
    // Un dump de login_challenges no debe permitir completar ningun login.
    const token = generarToken();
    expect(hashearToken(token)).not.toContain(token);
  });

  it("devuelve hex de 64 caracteres (SHA-256)", () => {
    expect(hashearToken(generarToken())).toMatch(/^[0-9a-f]{64}$/);
  });

  it("distingue tokens distintos", () => {
    expect(hashearToken("a")).not.toBe(hashearToken("b"));
  });
});

describe("calcularVencimiento", () => {
  it("vence a los 5 minutos", () => {
    expect(calcularVencimiento(AHORA).getTime()).toBe(AHORA.getTime() + TTL_MS);
    expect(TTL_MS).toBe(5 * 60 * 1000);
  });
});

describe("evaluarChallenge", () => {
  it("acepta un challenge fresco y sin intentos", () => {
    expect(evaluarChallenge(fila(), AHORA)).toBe("valido");
  });

  it("acepta con intentos fallidos por debajo del tope", () => {
    expect(evaluarChallenge(fila({ attempts: MAX_INTENTOS - 1 }), AHORA)).toBe(
      "valido"
    );
  });

  it("rechaza el ya consumido", () => {
    expect(evaluarChallenge(fila({ consumedAt: AHORA }), AHORA)).toBe("consumido");
  });

  it("rechaza el vencido", () => {
    const vencido = fila({ expiresAt: new Date(AHORA.getTime() - 1) });
    expect(evaluarChallenge(vencido, AHORA)).toBe("expirado");
  });

  it("trata el vencimiento exacto como vencido", () => {
    expect(evaluarChallenge(fila({ expiresAt: AHORA }), AHORA)).toBe("expirado");
  });

  it("rechaza al llegar al tope de intentos", () => {
    expect(evaluarChallenge(fila({ attempts: MAX_INTENTOS }), AHORA)).toBe(
      "demasiados_intentos"
    );
  });

  it("prioriza 'consumido' sobre 'expirado'", () => {
    // Un challenge ya usado no debe reportarse como vencido: son señales
    // distintas para quien este probando.
    const ambos = fila({
      consumedAt: AHORA,
      expiresAt: new Date(AHORA.getTime() - 60_000),
    });
    expect(evaluarChallenge(ambos, AHORA)).toBe("consumido");
  });

  it("prioriza 'demasiados_intentos' sobre 'expirado'", () => {
    const ambos = fila({
      attempts: MAX_INTENTOS,
      expiresAt: new Date(AHORA.getTime() - 60_000),
    });
    expect(evaluarChallenge(ambos, AHORA)).toBe("demasiados_intentos");
  });
});

describe("intentosRestantes", () => {
  it.each([
    [0, MAX_INTENTOS],
    [1, MAX_INTENTOS - 1],
    [MAX_INTENTOS, 0],
    [MAX_INTENTOS + 3, 0], // nunca negativo
  ])("con %i intentos quedan %i", (attempts, esperado) => {
    expect(intentosRestantes(fila({ attempts }))).toBe(esperado);
  });
});
