import { describe, expect, it } from "vitest";
import { buildNarrationInstruction } from "../ttsInstruction";

// El texto exacto que gano el A/B a oido (scripts/ab_instruction.mjs, variante 3). Si este test
// se rompe, se perdio el resultado del experimento: no ajustar el test, revisar el cambio.
const GANADOR_AB =
  "You are a helpful assistant. Narra este cuento infantil en español rioplatense de Argentina, " +
  "con voz suave, calida y pausada, como quien acompaña a un niño a dormir.";

const TODOS_LOS_LOCALES = [
  "es-AR",
  "es-MX",
  "es-LATAM",
  "es",
  "es-ZZ",
  "en-US",
  "en-GB",
  "en-AR",
  "pt-BR",
  "ja-JP",
  "zz-ZZ",
  "",
];

describe("buildNarrationInstruction", () => {
  it("reproduce palabra por palabra la instruccion que gano el A/B para es-AR", () => {
    expect(buildNarrationInstruction("es-AR")).toBe(GANADOR_AB);
  });

  it("nombra rioplatense tambien para Uruguay", () => {
    expect(buildNarrationInstruction("es-UY")).toContain("rioplatense de Uruguay");
  });

  it.each([
    ["es-MX", "español de México"],
    ["es-ES", "español de España"],
    ["es-CO", "español de Colombia"],
    ["es-PE", "español de Perú"],
  ])("arma %s con el nombre del pais en español", (locale, esperado) => {
    expect(buildNarrationInstruction(locale)).toContain(esperado);
  });

  it.each([
    ["en-US", "American English"],
    ["en-GB", "British English"],
    ["en-AU", "Australian English"],
  ])("en ingles pone la variedad como adjetivo: %s", (locale, esperado) => {
    expect(buildNarrationInstruction(locale)).toContain(esperado);
  });

  it.each([
    ["pt-BR", "português do Brasil"],
    ["pt-PT", "português de Portugal"],
  ])("respeta la contraccion del portugues: %s", (locale, esperado) => {
    expect(buildNarrationInstruction(locale)).toContain(esperado);
  });

  // El caso que motivo todo el diseño: la region del dispositivo dice donde vive el usuario, no
  // que variedad del idioma quiere. Alguien en Argentina pidiendo un cuento en ingles no puede
  // terminar con "Argentina English".
  describe("region que no es una variedad del idioma", () => {
    it("no nombra el pais en en-AR", () => {
      const out = buildNarrationInstruction("en-AR");
      expect(out).not.toContain("Argentina");
      expect(out).not.toContain("AR");
    });

    it("igual devuelve una instruccion de ingles usable", () => {
      expect(buildNarrationInstruction("en-AR")).toBe(
        buildNarrationInstruction("en")
      );
    });

    it.each(["es-US", "es-JP", "pt-AR", "en-MX"])(
      "cae a la instruccion sin variedad para %s",
      (locale) => {
        const idioma = locale.split("-")[0];
        expect(buildNarrationInstruction(locale)).toBe(
          buildNarrationInstruction(idioma)
        );
      }
    );
  });

  describe("degradacion", () => {
    // "es-LATAM" circula por el proyecto y no es una region ISO.
    it.each(["es-LATAM", "es", "es-ZZ", "es-1"])(
      "trata %s como español sin variedad",
      (locale) => {
        const out = buildNarrationInstruction(locale);
        expect(out).toContain("en español,");
        expect(out).not.toContain("rioplatense");
      }
    );

    it("no nombra region para ja-JP: no hay variedad que valga nombrar", () => {
      expect(buildNarrationInstruction("ja-JP")).toBe(
        buildNarrationInstruction("ja")
      );
    });

    it.each(["zz-ZZ", "", "   ", "-", "xx"])(
      "cae a español para el locale desconocido %s",
      (locale) => {
        expect(buildNarrationInstruction(locale)).toContain("Narra este cuento infantil");
      }
    );

    it.each(TODOS_LOS_LOCALES)("nunca tira con %s", (locale) => {
      expect(() => buildNarrationInstruction(locale)).not.toThrow();
    });
  });

  // CosyVoice3 aborta la generacion si el prompt_text no tiene la forma que espera; el prefijo es
  // parte de esa forma. Ver src/handler.py en el repo del worker.
  it.each(TODOS_LOS_LOCALES)(
    "empieza con el prefijo que CosyVoice3 exige (%s)",
    (locale) => {
      expect(buildNarrationInstruction(locale)).toMatch(
        /^You are a helpful assistant\. \S/
      );
    }
  );
});
