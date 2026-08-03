export const runtime = "nodejs";
// Narrar con voz grabada implica esperar a RunPod: arranque en frio del worker (~80s)
// mas una llamada al modelo por cada pedazo del cuento (~12 en un cuento de 4 minutos).
// Con el default de Vercel la funcion se cortaba antes de que el worker contestara.
export const maxDuration = 300;

import { jsonWithCors, optionsResponse } from "@/lib/cors";
import {
  AVAILABLE_TTS_VOICES,
  DEFAULT_TTS_MODEL,
  audioResponse,
  cleanStoryText,
  estimateDurationSeconds,
  resolveVoiceId,
  generateClonedSpeech,
  stripPauseMarkers,
  RunPodJobError,
} from "@/lib/tts";
import OpenAI from "openai";
import { NextRequest } from "next/server";

type NarrateBody = {
  story_id?: string;
  story_text?: string;
  voice_id?: string;
  locale?: string;
  reference_audio_b64?: string;
};

const MAX_REFERENCE_AUDIO_B64_CHARS = 20_000_000; // generoso para un clip de 60s

function isNarrateBody(input: unknown): input is NarrateBody {
  if (typeof input !== "object" || input === null) return false;
  const data = input as Record<string, unknown>;
  const isString = (v: unknown) => typeof v === "string" && v.trim().length > 0;
  if (data.story_id !== undefined && !isString(data.story_id)) return false;
  if (data.story_text !== undefined && !isString(data.story_text)) return false;
  if (data.voice_id !== undefined && !isString(data.voice_id)) return false;
  if (data.locale !== undefined && !isString(data.locale)) return false;
  if (data.reference_audio_b64 !== undefined && !isString(data.reference_audio_b64)) return false;
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

    if (rawBody.reference_audio_b64) {
      if (rawBody.reference_audio_b64.length > MAX_REFERENCE_AUDIO_B64_CHARS) {
        return jsonWithCors(
          req,
          { error: "La muestra de voz es demasiado grande." },
          { status: 413 }
        );
      }
      try {
        const referenceBuffer = Buffer.from(rawBody.reference_audio_b64, "base64");
        // Va el locale COMPLETO, no solo el idioma: la region es la que decide la variedad que se
        // le pide al modelo (rioplatense, mexicano, britanico...). Antes aca se hacia el split y
        // la region se perdia, asi que todo el mundo recibia la instruccion fija en rioplatense.
        const buffer = await generateClonedSpeech(cleaned, referenceBuffer, {
          locale,
        });
        return audioResponse(req, buffer, {
          storyId,
          voiceId: rawBody.voice_id || "custom",
          locale,
          durationSeconds,
          format: "wav",
        });
      } catch (err) {
        if (err instanceof RunPodJobError) {
          const message =
            err.status === "TIMED_OUT"
              ? "El servidor de voz tardó demasiado. Probá de nuevo."
              : "No se pudo generar la narración con tu voz grabada.";
          return jsonWithCors(req, { error: message }, { status: 502 });
        }
        throw err;
      }
    }

    if (!process.env.OPENAI_API_KEY) {
      return jsonWithCors(
        req,
        { error: "OPENAI_API_KEY faltante en el backend" },
        { status: 500 }
      );
    }

    // Este camino no tiene forma de pedir un silencio, asi que las marcas se cambian por
    // puntos suspensivos ANTES de mandar el texto: si viajan tal cual, el modelo las lee
    // en voz alta. El camino de RunPod (arriba) sigue mandando `cleaned` con las marcas,
    // porque ahi el worker las convierte en silencio real.
    const speech = await openai.audio.speech.create({
      model: DEFAULT_TTS_MODEL,
      voice: voiceId as Parameters<typeof openai.audio.speech.create>[0]['voice'],
      input: stripPauseMarkers(cleaned),
      instructions:
        "Narra este cuento infantil para dormir en español latinoamericano, con voz suave, " +
        "calida y pausada. Haz pausas largas donde haya puntos suspensivos.",
      response_format: "mp3",
    });
    const buffer = Buffer.from(await speech.arrayBuffer());

    return audioResponse(req, buffer, {
      storyId,
      voiceId,
      locale,
      durationSeconds,
      format: "mp3",
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
