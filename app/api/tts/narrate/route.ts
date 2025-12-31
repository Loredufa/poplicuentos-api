export const runtime = "nodejs";

import { jsonWithCors, optionsResponse } from "@/lib/cors";
import {
  AVAILABLE_TTS_VOICES,
  DEFAULT_TTS_MODEL,
  audioResponse,
  cleanStoryText,
  estimateDurationSeconds,
  resolveVoiceId,
} from "@/lib/tts";
import OpenAI from "openai";
import { NextRequest } from "next/server";

type NarrateBody = {
  story_id?: string;
  story_text?: string;
  voice_id?: string;
  locale?: string;
};

function isNarrateBody(input: unknown): input is NarrateBody {
  if (typeof input !== "object" || input === null) return false;
  const data = input as Record<string, unknown>;
  const isString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (data.story_id !== undefined && !isString(data.story_id)) return false;
  if (data.story_text !== undefined && !isString(data.story_text)) return false;
  if (data.voice_id !== undefined && !isString(data.voice_id)) return false;
  if (data.locale !== undefined && !isString(data.locale)) return false;
  return true;
}

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

export async function POST(req: NextRequest) {
  try {
    const rawBody = await req.json().catch(() => null);
    if (!isNarrateBody(rawBody)) {
      return jsonWithCors(
        req,
        {
          error:
            "Cuerpo inválido. Envía story_text o story_id, voice_id opcional, locale opcional.",
        },
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
    const storyId = rawBody.story_id;
    const storyText = (rawBody.story_text || "").trim();

    if (!storyText) {
      return jsonWithCors(
        req,
        {
          error: "Debes enviar story_text con el cuento completo.",
          voices: AVAILABLE_TTS_VOICES,
        },
        { status: 400 }
      );
    }

    const cleaned = cleanStoryText(storyText);
    const durationSeconds = estimateDurationSeconds(cleaned);

    const speech = await openai.audio.speech.create({
      model: DEFAULT_TTS_MODEL,
      voice: voiceId,
      input: cleaned,
      format: "mp3",
    });

    const buffer = Buffer.from(await speech.arrayBuffer());

    return audioResponse(req, buffer, {
      storyId,
      voiceId,
      locale,
      durationSeconds,
    });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Narración TTS fallida";
    return jsonWithCors(req, { error: message }, { status: 502 });
  }
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
