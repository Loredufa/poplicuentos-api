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
  meta: {
    storyId?: string;
    voiceId: string;
    locale?: string;
    durationSeconds?: number;
    format?: "mp3" | "wav";
  }
): NextResponse {
  const format = meta.format || "mp3";
  const headers = corsHeaders(req);
  headers["Content-Type"] = format === "wav" ? "audio/wav" : "audio/mpeg";
  headers["Content-Length"] = audioBuffer.byteLength.toString();
  headers["Content-Disposition"] = `inline; filename="poplicuentos-narracion.${format}"`;
  headers["X-TTS-Format"] = format;
  headers["X-TTS-Voice"] = meta.voiceId;
  if (meta.locale) headers["X-TTS-Locale"] = meta.locale;
  if (meta.storyId) headers["X-Story-Id"] = meta.storyId;
  if (meta.durationSeconds) {
    headers["X-Audio-Duration-Estimate"] = String(meta.durationSeconds);
  }
  const body = new Uint8Array(audioBuffer);
  return new NextResponse(body, { status: 200, headers });
}

export class RunPodJobError extends Error {
  status: "FAILED" | "TIMED_OUT" | "HTTP_ERROR";
  constructor(message: string, status: "FAILED" | "TIMED_OUT" | "HTTP_ERROR") {
    super(message);
    this.name = "RunPodJobError";
    this.status = status;
  }
}

type ChatterboxOpts = {
  languageId?: string;
  cfgWeight?: number;
  exaggeration?: number;
  waitMs?: number;
};

const RUNPOD_POLL_INTERVAL_MS = 2000;
const RUNPOD_POLL_BUDGET_MS = 120000;

export async function generateChatterboxSpeech(
  text: string,
  referenceAudioBuffer: Buffer,
  opts: ChatterboxOpts = {}
): Promise<Buffer> {
  const apiKey = process.env.RUNPOD_API_KEY;
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  if (!apiKey || !endpointId) {
    throw new Error("RUNPOD_API_KEY o RUNPOD_ENDPOINT_ID faltantes en el backend");
  }

  const waitMs = Math.min(opts.waitMs || Number(process.env.RUNPOD_TTS_WAIT_MS) || 90000, 300000);
  const body = {
    input: {
      text,
      language_id: opts.languageId || "es",
      voice_audio_b64: referenceAudioBuffer.toString("base64"),
      cfg_weight: opts.cfgWeight ?? 0.5,
      exaggeration: opts.exaggeration ?? 0.5,
    },
  };

  const runRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/runsync?wait=${waitMs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!runRes.ok) throw new RunPodJobError(`RunPod HTTP ${runRes.status}`, "HTTP_ERROR");
  let job = await runRes.json();

  const deadline = Date.now() + RUNPOD_POLL_BUDGET_MS;
  while (job.status === "IN_QUEUE" || job.status === "IN_PROGRESS") {
    if (Date.now() > deadline) throw new RunPodJobError("RunPod job did not finish in time", "TIMED_OUT");
    await new Promise((r) => setTimeout(r, RUNPOD_POLL_INTERVAL_MS));
    const statusRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/status/${job.id}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    if (!statusRes.ok) throw new RunPodJobError(`RunPod HTTP ${statusRes.status}`, "HTTP_ERROR");
    job = await statusRes.json();
  }

  if (job.status === "FAILED") {
    throw new RunPodJobError(job.output?.error || job.error || "RunPod job failed", "FAILED");
  }
  if (job.status === "TIMED_OUT") {
    throw new RunPodJobError("RunPod job timed out", "TIMED_OUT");
  }
  if (job.status !== "COMPLETED" || !job.output?.audio_wav_b64) {
    throw new RunPodJobError("RunPod job returned no audio", "FAILED");
  }
  return Buffer.from(job.output.audio_wav_b64, "base64");
}
