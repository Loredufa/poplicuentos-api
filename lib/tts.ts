import { corsHeaders } from "@/lib/cors";
import { NextResponse } from "next/server";

export type VoiceOption = {
  id: string;
  label: string;
  description: string;
  idealFor: string;
  timbre: string;
  sampleText?: string;
};

export const AVAILABLE_TTS_VOICES: VoiceOption[] = [
  {
    id: "alloy",
    label: "Voz cálida 1 (Alloy)",
    description: "Narrador neutro y cercano, mantiene el foco en la historia.",
    idealFor: "Narrador principal y tono clásico para dormir.",
    timbre: "Grave suave, estable y relajante.",
    sampleText:
      "Hola, soy Alloy. Voy a contarte este cuento en español latino, con calma y cercanía.",
  },
  {
    id: "nova",
    label: "Voz aventura (Nova)",
    description: "Sonido expresivo y dinámico, acentúa momentos épicos.",
    idealFor: "Aventuras, descubrimientos y escenas con emoción.",
    timbre: "Brillante y ligeramente entusiasta.",
    sampleText:
      "Hola, soy Nova. Prepárate para una aventura con mucha imaginación en español latino.",
  },
  {
    id: "shimmer",
    label: "Voz tierna (Shimmer)",
    description: "Muy amable y dulce, ideal para cuentos reconfortantes.",
    idealFor: "Historias con ternura, amistad o finales calmantes.",
    timbre: "Agudo suave con calidez.",
    sampleText:
      "Hola, soy Shimmer. Te leeré este cuento con dulzura y calidez en español latino.",
  },
];

export const DEFAULT_TTS_MODEL =
  process.env.OPENAI_TTS_MODEL || "gpt-4o-mini-tts";

export function resolveVoiceId(input?: string): string {
  if (!input) return AVAILABLE_TTS_VOICES[0].id;
  const found = AVAILABLE_TTS_VOICES.find((v) => v.id === input);
  return found ? found.id : AVAILABLE_TTS_VOICES[0].id;
}

export function cleanStoryText(raw: string): string {
  return raw
    .replace(/```json[\s\S]*?```/gi, "") // quita metadatos finales
    .replace(/```[\s\S]*?```/g, "")
    .replace(/^#+\s*/gm, "")
    .replace(/[*_`>]+/g, "")
    .replace(/[\r\n]{3,}/g, "\n\n")
    .trim();
}

export function estimateDurationSeconds(
  text: string,
  wordsPerMinute = 145
): number {
  const words = text.split(/\s+/).filter(Boolean).length;
  const minutes = words / wordsPerMinute;
  return Math.max(10, Math.round(minutes * 60));
}

export function audioResponse(
  req: Request,
  audioBuffer: Buffer,
  meta: { storyId?: string; voiceId: string; locale?: string; durationSeconds?: number }
): NextResponse {
  const headers = corsHeaders(req);
  headers["Content-Type"] = "audio/mpeg";
  headers["Content-Length"] = audioBuffer.byteLength.toString();
  headers["Content-Disposition"] = 'inline; filename="poplicuentos-narracion.mp3"';
  headers["X-TTS-Voice"] = meta.voiceId;
  if (meta.locale) headers["X-TTS-Locale"] = meta.locale;
  if (meta.storyId) headers["X-Story-Id"] = meta.storyId;
  if (meta.durationSeconds) {
    headers["X-Audio-Duration-Estimate"] = String(meta.durationSeconds);
  }
  const body = audioBuffer.buffer.slice(
    audioBuffer.byteOffset,
    audioBuffer.byteOffset + audioBuffer.byteLength
  );
  return new NextResponse(body, { status: 200, headers });
}
