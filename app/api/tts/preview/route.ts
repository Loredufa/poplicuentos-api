export const runtime = "nodejs";

import { jsonWithCors, optionsResponse } from "@/lib/cors";
import {
  AVAILABLE_TTS_VOICES,
  DEFAULT_TTS_MODEL,
  audioResponse,
  resolveVoiceId,
} from "@/lib/tts";
import OpenAI from "openai";
import { NextRequest } from "next/server";

type PreviewBody = {
  voice_id?: string;
  locale?: string;
  text?: string;
};

function isPreviewBody(input: unknown): input is PreviewBody {
  if (typeof input !== "object" || input === null) return false;
  const data = input as Record<string, unknown>;
  const isString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (data.voice_id !== undefined && !isString(data.voice_id)) return false;
  if (data.locale !== undefined && !isString(data.locale)) return false;
  if (data.text !== undefined && !isString(data.text)) return false;
  return true;
}

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => ({}));
    if (!isPreviewBody(rawBody)) {
      return jsonWithCors(
        req,
        { error: "Cuerpo inválido. Envía voice_id opcional y text opcional." },
        { status: 400 }
      );
    }

    if (!process.env.OPENAI_API_KEY) {
      return jsonWithCors(
        req,
        { error: "OPENAI_API_KEY faltante en el backend" },
        { status: 500 }
      );
    }

    const voiceId = resolveVoiceId(rawBody.voice_id);
    const locale = rawBody.locale || "es-LATAM";
    const voiceConfig = AVAILABLE_TTS_VOICES.find((v) => v.id === voiceId);
    const input =
      rawBody.text?.trim() ||
      voiceConfig?.sampleText ||
      "Hola, esta es una muestra breve de la voz narradora en español latino.";

    const speech = await openai.audio.speech.create({
      model: DEFAULT_TTS_MODEL,
      voice: voiceId,
      input,
      format: "mp3",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());
    return audioResponse(req, buffer, { voiceId, locale });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "No se pudo generar la muestra";
    return jsonWithCors(req, { error: message }, { status: 502 });
  }
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
