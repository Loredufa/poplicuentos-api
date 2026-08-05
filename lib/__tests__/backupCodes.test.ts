import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  buscarCodigo,
  CANTIDAD_CODIGOS,
  generarCodigos,
  hashearCodigo,
  normalizar,
} from "../backupCodes";

// A nivel de modulo y no en un beforeEach: los cuerpos de describe se ejecutan
// al recolectar, antes de cualquier hook, y ahi ya se necesita el pepper.
process.env.AUTH_ENC_KEY = randomBytes(32).toString("base64");

const USUARIO_A = "11111111-1111-1111-1111-111111111111";
const USUARIO_B = "22222222-2222-2222-2222-222222222222";

describe("generarCodigos", () => {
  it("genera el lote completo", () => {
    expect(generarCodigos()).toHaveLength(CANTIDAD_CODIGOS);
  });

  it("respeta el formato XXXXX-XXXXX", () => {
    for (const c of generarCodigos()) {
      expect(c).toMatch(/^[0-9A-HJKMNP-TV-Z]{5}-[0-9A-HJKMNP-TV-Z]{5}$/);
    }
  });

  it.each(["I", "L", "O", "U"])(
    "no usa la letra %s, que se confunde al leer o tipear",
    (letra) => {
      const todos = generarCodigos(200).join("");
      expect(todos).not.toContain(letra);
    }
  );

  it("no repite codigos dentro del lote", () => {
    // Un duplicado haria que un solo uso queme dos codigos del usuario.
    const codigos = generarCodigos();
    expect(new Set(codigos).size).toBe(codigos.length);
  });

  it("no repite el lote entre llamadas", () => {
    const a = generarCodigos();
    const b = generarCodigos();
    expect(a.filter((c) => b.includes(c))).toHaveLength(0);
  });
});

describe("normalizar", () => {
  // El usuario puede copiarlo con formato, sin formato o a mano: todo tiene
  // que llegar a la misma forma canonica.
  it.each([
    ["ABCDE-12345", "ABCDE12345"],
    ["abcde-12345", "ABCDE12345"],
    ["abcde12345", "ABCDE12345"],
    ["ABCDE 12345", "ABCDE12345"],
    ["  abcde - 12345  ", "ABCDE12345"],
  ])("lleva %s a la forma canonica", (entrada, esperado) => {
    expect(normalizar(entrada)).toBe(esperado);
  });
});

describe("hashearCodigo", () => {
  it("es determinista", () => {
    expect(hashearCodigo("ABCDE-12345", USUARIO_A)).toBe(
      hashearCodigo("ABCDE-12345", USUARIO_A)
    );
  });

  it("no depende del formato con el que se tipeo", () => {
    expect(hashearCodigo("abcde 12345", USUARIO_A)).toBe(
      hashearCodigo("ABCDE-12345", USUARIO_A)
    );
  });

  it("da hashes distintos para el mismo codigo en usuarios distintos", () => {
    // El user_id entra en el mensaje: si no, un codigo filtrado de una cuenta
    // serviria para tantear otras.
    expect(hashearCodigo("ABCDE-12345", USUARIO_A)).not.toBe(
      hashearCodigo("ABCDE-12345", USUARIO_B)
    );
  });

  it("no deja el codigo legible en el hash", () => {
    expect(hashearCodigo("ABCDE-12345", USUARIO_A)).not.toContain("ABCDE");
  });

  it("devuelve hex de 64 caracteres (SHA-256)", () => {
    expect(hashearCodigo("ABCDE-12345", USUARIO_A)).toMatch(/^[0-9a-f]{64}$/);
  });
});

describe("buscarCodigo", () => {
  const codigos = generarCodigos();
  const guardados = codigos.map((c, i) => ({
    id: `fila-${i}`,
    codeHash: hashearCodigo(c, USUARIO_A),
  }));

  it("encuentra la fila del codigo correcto", () => {
    expect(buscarCodigo(codigos[3], USUARIO_A, guardados)).toBe("fila-3");
  });

  it("lo encuentra aunque venga sin guion y en minusculas", () => {
    const tipeado = codigos[7].toLowerCase().replace("-", "");
    expect(buscarCodigo(tipeado, USUARIO_A, guardados)).toBe("fila-7");
  });

  it("devuelve null si el codigo no esta en la lista", () => {
    expect(buscarCodigo("ZZZZZ-ZZZZZ", USUARIO_A, guardados)).toBeNull();
  });

  it("devuelve null si el codigo es de otro usuario", () => {
    expect(buscarCodigo(codigos[0], USUARIO_B, guardados)).toBeNull();
  });

  it("devuelve null contra una lista vacia (codigos ya usados)", () => {
    expect(buscarCodigo(codigos[0], USUARIO_A, [])).toBeNull();
  });

  it.each(["", "ABC", "ABCDE-12345-67890", "123456"])(
    "descarta %s por largo antes de hashear",
    (entrada) => {
      expect(buscarCodigo(entrada, USUARIO_A, guardados)).toBeNull();
    }
  );
});
