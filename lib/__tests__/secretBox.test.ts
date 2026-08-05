import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import {
  decryptSecret,
  encryptSecret,
  hashesIguales,
  pepperCodigosRespaldo,
} from "../crypto/secretBox";

const CLAVE_A = randomBytes(32).toString("base64");
const CLAVE_B = randomBytes(32).toString("base64");

const USUARIO_A = "11111111-1111-1111-1111-111111111111";
const USUARIO_B = "22222222-2222-2222-2222-222222222222";

const SECRETO = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

let claveOriginal: string | undefined;

beforeEach(() => {
  claveOriginal = process.env.AUTH_ENC_KEY;
  process.env.AUTH_ENC_KEY = CLAVE_A;
});

afterEach(() => {
  if (claveOriginal === undefined) delete process.env.AUTH_ENC_KEY;
  else process.env.AUTH_ENC_KEY = claveOriginal;
});

describe("encryptSecret / decryptSecret", () => {
  it("hace round-trip del secreto", () => {
    const blob = encryptSecret(SECRETO, USUARIO_A);
    expect(decryptSecret(blob, USUARIO_A)).toBe(SECRETO);
  });

  it("no deja el secreto legible en el blob", () => {
    const blob = encryptSecret(SECRETO, USUARIO_A);
    expect(blob).not.toContain(SECRETO);
  });

  it("da blobs distintos para el mismo texto: el IV es aleatorio por operacion", () => {
    const a = encryptSecret(SECRETO, USUARIO_A);
    const b = encryptSecret(SECRETO, USUARIO_A);
    expect(a).not.toBe(b);
    // Pero ambos descifran al mismo valor.
    expect(decryptSecret(a, USUARIO_A)).toBe(decryptSecret(b, USUARIO_A));
  });
});

describe("encryptSecret - el AAD ata el blob a su fila", () => {
  // Este es el punto del AAD: ni con acceso de escritura a la base se puede
  // copiar el secreto de un usuario a otro.
  it("falla al descifrar con el user_id de otro usuario", () => {
    const blob = encryptSecret(SECRETO, USUARIO_A);
    expect(() => decryptSecret(blob, USUARIO_B)).toThrow();
  });

  it("falla con un user_id vacio", () => {
    const blob = encryptSecret(SECRETO, USUARIO_A);
    expect(() => decryptSecret(blob, "")).toThrow();
  });
});

describe("encryptSecret - integridad y clave", () => {
  it("falla si la clave maestra cambio", () => {
    const blob = encryptSecret(SECRETO, USUARIO_A);
    process.env.AUTH_ENC_KEY = CLAVE_B;
    expect(() => decryptSecret(blob, USUARIO_A)).toThrow();
  });

  it("falla si el ciphertext fue alterado (GCM autentica)", () => {
    const blob = encryptSecret(SECRETO, USUARIO_A);
    const buf = Buffer.from(blob, "base64");
    buf[buf.length - 1] ^= 0xff;
    expect(() => decryptSecret(buf.toString("base64"), USUARIO_A)).toThrow();
  });

  it("falla si el authTag fue alterado", () => {
    const blob = encryptSecret(SECRETO, USUARIO_A);
    const buf = Buffer.from(blob, "base64");
    buf[13] ^= 0xff; // dentro del tag (bytes 12..27)
    expect(() => decryptSecret(buf.toString("base64"), USUARIO_A)).toThrow();
  });

  it.each(["", "AAAA", "eyJ4IjoxfQ=="])(
    "rechaza el blob invalido %s en vez de devolver basura",
    (blob) => {
      expect(() => decryptSecret(blob, USUARIO_A)).toThrow();
    }
  );
});

describe("AUTH_ENC_KEY mal configurada", () => {
  // Falla al usarse y no en silencio: mejor romper el deploy que dejar 2FA
  // a medio funcionar en produccion.
  it.each([
    ["muy corta", randomBytes(16).toString("base64")],
    ["muy larga", randomBytes(64).toString("base64")],
  ])("lanza si la clave es %s", (_caso, valor) => {
    process.env.AUTH_ENC_KEY = valor;
    expect(() => encryptSecret(SECRETO, USUARIO_A)).toThrow(/32 bytes/);
  });

  it("lanza si no esta definida", () => {
    delete process.env.AUTH_ENC_KEY;
    expect(() => encryptSecret(SECRETO, USUARIO_A)).toThrow(/AUTH_ENC_KEY/);
  });
});

describe("pepperCodigosRespaldo", () => {
  it("es estable para la misma clave maestra", () => {
    expect(pepperCodigosRespaldo()).toEqual(pepperCodigosRespaldo());
  });

  it("cambia si cambia la clave maestra", () => {
    const conA = pepperCodigosRespaldo();
    process.env.AUTH_ENC_KEY = CLAVE_B;
    expect(pepperCodigosRespaldo()).not.toEqual(conA);
  });

  it("no es la clave maestra cruda: HKDF separa los propositos", () => {
    // Si el pepper fuese la clave cruda, comprometer uno de los dos mecanismos
    // comprometeria el otro.
    expect(pepperCodigosRespaldo().toString("base64")).not.toBe(CLAVE_A);
  });
});

describe("hashesIguales", () => {
  const hash = "a".repeat(64);

  it("reconoce dos hashes identicos", () => {
    expect(hashesIguales(hash, hash)).toBe(true);
  });

  it("distingue hashes distintos del mismo largo", () => {
    expect(hashesIguales(hash, "b".repeat(64))).toBe(false);
  });

  it("devuelve false ante largos distintos en vez de lanzar", () => {
    expect(hashesIguales(hash, "ab")).toBe(false);
  });
});
