import { corsHeaders } from "@/lib/cors";
import { buildNarrationInstruction } from "@/lib/ttsInstruction";
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

// El generador de cuentos pide EXACTAMENTE 2 marcas "(pausa)" (ver systemPrompt en
// app/api/story/route.ts), pero el modelo no siempre respeta la forma canonica: manda
// "(pausa breve)", "[Pausa...]", "—pausa—". El worker de RunPod solo reconocia la forma
// exacta, y el camino de OpenAI no las limpiaba en absoluto: el TTS las leia en voz alta.
// Con la voz clonada rioplatense "(pausa)" suena casi como "para" / "parar", que es como
// se reporto el bug.
//
// El limite de 24 caracteres dentro del parentesis es a proposito: acota el match a
// calificadores cortos ("breve", "larga", "...") y evita comerse una oracion entera que
// casualmente empiece con la palabra.
const PAUSE_CUE_RE =
  /[([{]\s*pausas?\b[^)\]}]{0,24}[)\]}]|[—–]\s*pausas?\s*[—–]/gi;

/**
 * Lleva cualquier variante de marca de pausa a la forma canonica "(pausa)", que es la
 * unica que el worker sabe convertir en silencio.
 */
export function normalizePauseMarkers(raw: string): string {
  return raw
    .replace(PAUSE_CUE_RE, "(pausa)")
    .replace(/(?:\(pausa\)\s*){2,}/gi, "(pausa) ");
}

/**
 * Saca las marcas para el camino de OpenAI, que no tiene SSML ni forma de pedir un
 * silencio: los puntos suspensivos mas el corte de parrafo son lo mas parecido a una
 * pausa que entiende gpt-4o-mini-tts.
 *
 * El camino de RunPod NO usa esto: ahi las marcas viajan canonicas y el worker las
 * convierte en silencio real (PAUSE_SECONDS en handler.py).
 */
export function stripPauseMarkers(raw: string): string {
  return raw
    .replace(/\(pausa\)/gi, "…\n\n")
    // El espacio que la marca tenia al lado queda pegado al salto de linea; se saca para
    // que el corte de parrafo sea limpio.
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n[ \t]+/g, "\n")
    .replace(/[\r\n]{3,}/g, "\n\n")
    .trim();
}

export function cleanStoryText(raw: string): string {
  return normalizePauseMarkers(raw)
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

type ClonedSpeechOpts = {
  /**
   * Locale completo del cuento, tipo "es-AR". De aca sale el `language_id` que recibe el worker
   * y, sobre todo, la instruccion de estilo: la region decide si se pide rioplatense, mexicano,
   * britanico o ninguna variedad en particular (ver lib/ttsInstruction.ts).
   *
   * Antes solo llegaba el idioma, porque la ruta hacia el split y tiraba la region.
   */
  locale?: string;
  /** Idioma suelto. Si no viene, sale de `locale`. */
  languageId?: string;
  /**
   * Transcripción del audio de referencia. CosyVoice arma el contexto con los tokens del
   * audio MÁS su transcripción, así que necesita saber qué se dice ahí. Si no se manda, el
   * worker lo transcribe con faster-whisper — que es el caso normal, porque a quien graba
   * se le pide que CUENTE el guion, no que lo lea palabra por palabra.
   */
  referenceText?: string;
  /**
   * Instruccion de estilo para CosyVoice. El worker la pone antes del token
   * <|endofprompt|> en el prompt_text, que es la misma perilla que usa
   * inference_instruct2: es la unica via para pedirle un idioma y un registro concretos.
   * Sin esto el worker usa su default ("You are a helpful assistant."), o sea que el
   * modelo no recibe ninguna senal de que tiene que narrar en español rioplatense.
   */
  instruction?: string;
  /**
   * Caracteres por pedazo. Cada pedazo se genera por separado y la voz se "reinicia" en
   * cada corte, asi que menos cortes = mas continuidad de prosodia. El worker default es
   * 300; se puede subir sin redeployarlo.
   */
  maxCharsPerChunk?: number;
  waitMs?: number;
};

// Escape hatch de entorno. Antes esta env var traia el DEFAULT de la instruccion (fija en
// rioplatense para todo el mundo); ahora la instruccion se arma por locale en ttsInstruction.ts y
// esto pasa a ser un OVERRIDE: si esta seteada, gana sobre lo que arme el constructor.
//
// Sirve para dos cosas, las mismas de antes: iterar la redaccion sin tocar codigo, y volver a un
// comportamiento fijo sin deployar si algo sale mal. `RUNPOD_TTS_INSTRUCTION=""` sigue
// desactivando la instruccion por completo — el string vacio no es nullish, asi que gana sobre el
// constructor, y mas abajo cae en el `instruction ? ... : {}` que directamente no la manda.
export const RUNPOD_TTS_INSTRUCTION_OVERRIDE = process.env.RUNPOD_TTS_INSTRUCTION;

const DEFAULT_RUNPOD_MAX_CHARS = Number(process.env.RUNPOD_TTS_MAX_CHARS) || 300;

const RUNPOD_POLL_INTERVAL_MS = 2000;
// El worker trocea el cuento y genera un pedazo por vez (ver handler.py): un cuento de
// 4 minutos son ~12 llamadas al modelo, mas el arranque en frio del worker. Con el
// presupuesto viejo de 120s se cortaba antes de que RunPod terminara.
// El tope de arriba lo pone Vercel: maxDuration de la ruta (300s), asi que dejamos
// margen para devolver la respuesta.
//
// Ojo al cambiar de modelo: este presupuesto se calibro con Chatterbox. CosyVoice tiene
// otro perfil de latencia (los pesos ahora vienen horneados en la imagen, asi que el
// arranque en frio deberia bajar, pero se suma el ASR de la referencia). Cronometrar un
// cuento largo real antes de darlo por bueno.
const RUNPOD_POLL_BUDGET_MS = Number(process.env.RUNPOD_POLL_BUDGET_MS) || 280000;

/**
 * Narra `text` con la voz de `referenceAudioBuffer`, contra el worker de RunPod.
 *
 * El worker corría Chatterbox y ahora corre CosyVoice. Con Chatterbox había que mandarle
 * `cfg_weight` y `exaggeration`; se sacaron porque son perillas de aquel modelo y no
 * existen en este. Tampoco se reemplazaron por las de CosyVoice: el troceado, la ventana de
 * referencia y el ASR los decide el worker, que es donde está el contexto para hacerlo.
 */
export async function generateClonedSpeech(
  text: string,
  referenceAudioBuffer: Buffer,
  opts: ClonedSpeechOpts = {}
): Promise<Buffer> {
  const apiKey = process.env.RUNPOD_API_KEY;
  const endpointId = process.env.RUNPOD_ENDPOINT_ID;
  if (!apiKey || !endpointId) {
    throw new Error("RUNPOD_API_KEY o RUNPOD_ENDPOINT_ID faltantes en el backend");
  }

  // El presupuesto se cuenta desde ACA, antes del primer fetch, y no despues de que vuelve.
  // Antes se calculaba recien al entrar al loop de polling, o sea despues de un runsync que
  // puede tardar hasta `waitMs` (90s): el techo real quedaba en 90 + 280 = 370s, por encima
  // del maxDuration de 300s de Vercel. Resultado: Vercel cortaba primero y el usuario veia
  // un 504 crudo en vez del mensaje de "el servidor de voz tardo demasiado".
  const deadline = Date.now() + RUNPOD_POLL_BUDGET_MS;

  const waitMs = Math.min(opts.waitMs || Number(process.env.RUNPOD_TTS_WAIT_MS) || 90000, 300000);
  const locale = opts.locale || opts.languageId || "es";
  // Precedencia: lo que pida el llamador > el override de entorno > la instruccion armada para
  // este locale. El constructor nunca tira, asi que esta cadena siempre resuelve.
  const instruction =
    opts.instruction ?? RUNPOD_TTS_INSTRUCTION_OVERRIDE ?? buildNarrationInstruction(locale);
  const maxChars = opts.maxCharsPerChunk ?? DEFAULT_RUNPOD_MAX_CHARS;
  const body = {
    input: {
      text,
      language_id: (opts.languageId || locale.split("-")[0] || "es").toLowerCase(),
      voice_audio_b64: referenceAudioBuffer.toString("base64"),
      ...(opts.referenceText ? { reference_text: opts.referenceText } : {}),
      ...(instruction ? { instruction } : {}),
      ...(maxChars ? { max_chars_per_chunk: maxChars } : {}),
    },
  };

  const runRes = await fetch(`https://api.runpod.ai/v2/${endpointId}/runsync?wait=${waitMs}`, {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!runRes.ok) throw new RunPodJobError(`RunPod HTTP ${runRes.status}`, "HTTP_ERROR");
  let job = await runRes.json();

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

  // Diagnostico del clon: si la voz sale con acento raro, lo primero a mirar es si el ASR
  // entendio bien la muestra — ese texto es la mitad del contexto que recibe CosyVoice.
  // Se loguea truncado y solo server-side; es un metadato efimero del request, no se
  // persiste ni se devuelve a la app (la premisa de privacidad sigue intacta).
  if (job.output.reference_transcript) {
    const quality = job.output.reference_quality
      ? ` quality=${job.output.reference_quality}`
      : "";
    console.log(
      `[tts] reference asr (${job.output.reference_seconds ?? "?"}s${quality}): ` +
        `${String(job.output.reference_transcript).slice(0, 160)}`
    );
  }

  return Buffer.from(job.output.audio_wav_b64, "base64");
}
