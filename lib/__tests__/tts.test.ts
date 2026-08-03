import { describe, expect, it } from "vitest";
import { cleanStoryText, normalizePauseMarkers, stripPauseMarkers } from "../tts";

const VARIANTES = [
  "(pausa)",
  "(Pausa)",
  "[PAUSA]",
  "( pausa )",
  "{pausa}",
  "(pausa breve)",
  "(pausa larga)",
  "[Pausa...]",
  "—pausa—",
  "(pausas)",
];

describe("normalizePauseMarkers", () => {
  it.each(VARIANTES)("lleva %s a la forma canonica", (cue) => {
    expect(normalizePauseMarkers(`Antes ${cue} despues.`)).toBe(
      "Antes (pausa) despues."
    );
  });

  it("colapsa marcas consecutivas en una sola", () => {
    expect(normalizePauseMarkers("Una. (pausa) (pausa) Dos.")).toBe(
      "Una. (pausa) Dos."
    );
  });

  it("no toca la palabra suelta ni parentesis legitimos", () => {
    const texto =
      "Tomi hizo una pausa y siguio. El raton (que era chiquito) corrio.";
    expect(normalizePauseMarkers(texto)).toBe(texto);
  });

  it("no se come una oracion larga entre parentesis que empieza con la palabra", () => {
    const texto =
      "(pausa muy muy larga, casi una oracion entera dentro del parentesis)";
    expect(normalizePauseMarkers(texto)).toBe(texto);
  });
});

describe("stripPauseMarkers", () => {
  it("cambia la marca por puntos suspensivos y corte de parrafo", () => {
    // El camino de OpenAI no tiene SSML: esto es lo mas parecido a un silencio.
    expect(stripPauseMarkers("Primera parte. (pausa) Segunda parte.")).toBe(
      "Primera parte. …\n\nSegunda parte."
    );
  });

  it("no deja la palabra suelta en el texto que se manda al TTS", () => {
    expect(stripPauseMarkers("Uno. (pausa) Dos.")).not.toMatch(/pausa/i);
  });
});

describe("cleanStoryText", () => {
  it("normaliza las variantes antes de limpiar el markdown", () => {
    const crudo = "# Titulo\n\nHabia una vez (pausa breve) un raton.\n\n```json\n{}\n```";
    expect(cleanStoryText(crudo)).toBe("Titulo\n\nHabia una vez (pausa) un raton.");
  });

  it("deja la marca canonica intacta: el worker la convierte en silencio real", () => {
    expect(cleanStoryText("Uno. (pausa) Dos.")).toContain("(pausa)");
  });
});
