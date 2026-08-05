import { describe, expect, it, vi } from "vitest";
import { elegirTransporte } from "../email";

/**
 * La unica regla que importa acá: el transporte de consola no puede activarse
 * en produccion. Si se colara, ningun usuario recibiria su codigo de reseteo Y
 * el codigo quedaria escrito en los logs del servidor.
 *
 * Si este test se rompe, revisar el cambio: no ajustar el test.
 */

describe("elegirTransporte", () => {
  it("usa resend por defecto", () => {
    expect(elegirTransporte(undefined, "development")).toBe("resend");
  });

  it.each(["", "resend", "smtp", "gmail", "Console", "CONSOLE"])(
    "usa resend ante el valor %s",
    (valor) => {
      // Solo el literal "console" en minusculas activa el transporte de consola:
      // nada de coincidencias parciales ni normalizacion silenciosa.
      expect(elegirTransporte(valor, "development")).toBe("resend");
    }
  );

  it("activa consola en la maquina local", () => {
    expect(elegirTransporte("console", "development", undefined)).toBe("console");
  });

  it("activa consola en test", () => {
    expect(elegirTransporte("console", "test", undefined)).toBe("console");
  });

  it("activa consola si NODE_ENV no esta definida y no hay deploy", () => {
    expect(elegirTransporte("console", undefined, undefined)).toBe("console");
  });
});

describe("elegirTransporte - salvaguarda de deploy", () => {
  function conErrorSilenciado(fn: () => void) {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    fn();
    // Siempre deja constancia: una variable mal seteada tiene que verse en los logs.
    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  }

  it("IGNORA consola con NODE_ENV=production", () => {
    conErrorSilenciado(() => {
      expect(elegirTransporte("console", "production", undefined)).toBe("resend");
    });
  });

  /**
   * El caso real que motivó esta salvaguarda: NODE_ENV se puede pisar a mano en
   * el panel de Vercel, y un "development" cargado por error dejaría todo el
   * correo de producción imprimiéndose en los logs en vez de enviarse.
   * VERCEL_ENV no se puede pisar, así que alcanza con esa señal.
   */
  it.each(["production", "preview", "development"])(
    "IGNORA consola en un deploy con VERCEL_ENV=%s aunque NODE_ENV diga development",
    (vercelEnv) => {
      conErrorSilenciado(() => {
        expect(elegirTransporte("console", "development", vercelEnv)).toBe("resend");
      });
    }
  );

  it("IGNORA consola en un deploy aunque NODE_ENV no este definida", () => {
    conErrorSilenciado(() => {
      expect(elegirTransporte("console", undefined, "production")).toBe("resend");
    });
  });
});
