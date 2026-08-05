import { describe, expect, it } from "vitest";
import * as OTPAuth from "otpauth";
import {
  construirUri,
  generarSecreto,
  pareceCodigoTotp,
  pasoActual,
  verificarCodigo,
  VENTANA,
} from "../totp";

/**
 * Secreto de referencia del RFC 6238: los ASCII "12345678901234567890" en
 * base32. Si estos vectores fallan, la implementacion no es TOTP estandar y
 * ninguna app autenticadora va a poder generar codigos validos.
 */
const SECRETO_RFC = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";

/** Codigos SHA-1 / 6 digitos / 30s tomados de la tabla del RFC 6238. */
const VECTORES_RFC: Array<[segundos: number, codigo: string]> = [
  [59, "287082"],
  [1111111109, "081804"],
  [1111111111, "050471"],
  [1234567890, "005924"],
  [2000000000, "279037"],
];

describe("verificarCodigo - vectores del RFC 6238", () => {
  it.each(VECTORES_RFC)("acepta el codigo del RFC en t=%i", (segundos, codigo) => {
    const ahora = new Date(segundos * 1000);
    const r = verificarCodigo(SECRETO_RFC, codigo, null, ahora);
    expect(r.valido).toBe(true);
  });

  it("calcula el paso esperado para el vector t=59", () => {
    const ahora = new Date(59 * 1000);
    const r = verificarCodigo(SECRETO_RFC, "287082", null, ahora);
    // 59 / 30 = 1 (floor), y el delta contra el codigo correcto es 0.
    expect(r).toEqual({ valido: true, paso: 1 });
  });
});

describe("verificarCodigo - ventana de tolerancia", () => {
  // Un reloj de telefono levemente desfasado no debe romper el login.
  const base = new Date(1234567890 * 1000);
  const codigo = "005924";

  it.each([-VENTANA, 0, VENTANA])("acepta un desfasaje de %i pasos", (pasos) => {
    const desfasado = new Date(base.getTime() + pasos * 30 * 1000);
    expect(verificarCodigo(SECRETO_RFC, codigo, null, desfasado).valido).toBe(true);
  });

  it.each([-(VENTANA + 1), VENTANA + 1, 10])(
    "rechaza un desfasaje de %i pasos",
    (pasos) => {
      const desfasado = new Date(base.getTime() + pasos * 30 * 1000);
      const r = verificarCodigo(SECRETO_RFC, codigo, null, desfasado);
      expect(r).toEqual({ valido: false, motivo: "incorrecto" });
    }
  );
});

describe("verificarCodigo - anti-replay", () => {
  // Sin este chequeo un codigo interceptado sigue sirviendo los 90s de la
  // ventana de tolerancia. No ajustar el test: revisar el cambio.
  const ahora = new Date(1234567890 * 1000);

  it("rechaza un codigo cuyo paso ya se uso", () => {
    const primera = verificarCodigo(SECRETO_RFC, "005924", null, ahora);
    expect(primera.valido).toBe(true);
    if (!primera.valido) return;

    const segunda = verificarCodigo(SECRETO_RFC, "005924", primera.paso, ahora);
    expect(segunda).toEqual({ valido: false, motivo: "reusado" });
  });

  it("rechaza tambien un paso anterior al ultimo usado", () => {
    const anterior = new Date(ahora.getTime() - 30 * 1000);
    const r = verificarCodigo(SECRETO_RFC, "005924", pasoActual(ahora) + 5, anterior);
    expect(r.valido).toBe(false);
  });

  it("acepta el codigo del paso siguiente aunque haya uno usado", () => {
    const previo = verificarCodigo(SECRETO_RFC, "005924", null, ahora);
    expect(previo.valido).toBe(true);
    if (!previo.valido) return;

    const siguiente = new Date(ahora.getTime() + 30 * 1000);
    const totp = new OTPAuth.TOTP({
      algorithm: "SHA1",
      digits: 6,
      period: 30,
      secret: OTPAuth.Secret.fromBase32(SECRETO_RFC),
    });
    const codigoSiguiente = totp.generate({ timestamp: siguiente.getTime() });

    const r = verificarCodigo(SECRETO_RFC, codigoSiguiente, previo.paso, siguiente);
    expect(r.valido).toBe(true);
  });
});

describe("verificarCodigo - formato", () => {
  it.each(["", "12345", "1234567", "abcdef", "12a456", "  "])(
    "rechaza %s por formato antes de tocar el secreto",
    (entrada) => {
      expect(verificarCodigo(SECRETO_RFC, entrada, null)).toEqual({
        valido: false,
        motivo: "formato",
      });
    }
  );

  it("tolera espacios alrededor del codigo", () => {
    const ahora = new Date(59 * 1000);
    expect(verificarCodigo(SECRETO_RFC, " 287082 ", null, ahora).valido).toBe(true);
  });
});

describe("generarSecreto", () => {
  it("devuelve base32 de 160 bits, que es lo que pide el RFC", () => {
    const s = generarSecreto();
    expect(s).toMatch(/^[A-Z2-7]+$/); // alfabeto base32 sin padding
    expect(s).toHaveLength(32); // 20 bytes -> 32 caracteres
  });

  it("no repite el secreto entre llamadas", () => {
    const secretos = new Set(Array.from({ length: 50 }, () => generarSecreto()));
    expect(secretos.size).toBe(50);
  });
});

describe("construirUri", () => {
  const uri = construirUri(SECRETO_RFC, "ana@ejemplo.com");

  it("arranca con el esquema que abre la app autenticadora", () => {
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
  });

  it.each([
    ["secret", `secret=${SECRETO_RFC}`],
    ["issuer", "issuer=Poplicuentos"],
    ["algorithm", "algorithm=SHA1"],
    ["digits", "digits=6"],
    ["period", "period=30"],
  ])("declara %s explicitamente", (_nombre, fragmento) => {
    // Explicito y no por default: hay autenticadores que asumen otros valores.
    expect(uri).toContain(fragmento);
  });

  it("incluye el email en el label para que el usuario sepa cual cuenta es", () => {
    expect(decodeURIComponent(uri)).toContain("ana@ejemplo.com");
  });
});

describe("pareceCodigoTotp", () => {
  it.each(["123456", " 123456 ", "000000"])("reconoce %s como TOTP", (v) => {
    expect(pareceCodigoTotp(v)).toBe(true);
  });

  it.each(["ABCDE-12345", "12345", "1234567", ""])(
    "no confunde %s con un TOTP",
    (v) => {
      expect(pareceCodigoTotp(v)).toBe(false);
    }
  );
});
