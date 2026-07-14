export const runtime = 'nodejs';

import { jsonWithCors, optionsResponse } from '@/lib/cors';
import OpenAI from 'openai';
import { NextRequest } from 'next/server';

// ---------- Tipos ----------
type AgeRange = '2-5' | '6-10';
type ImageAspectRatio = '1:1' | '9:16' | '16:9' | '3:4' | '4:3';
type SceneIndex = 'intro' | 'middle' | 'end';
const SCENE_ORDER: SceneIndex[] = ['intro', 'middle', 'end'];

interface IllustrationPlan {
  characters: Array<{ name: string; description: string }>;
  setting: string;
  palette: string;
  style: string;
  scenes: { intro: string; middle: string; end: string };
}

interface IllustrateBody {
  story: string;
  age_range: AgeRange;
  tone?: string;
  num_images?: number;
  aspect_ratio?: string;
  size?: string; // kept for backwards compatibility, ignored (aspect_ratio is used instead)
  characters?: string; // descripción del protagonista escrita por el usuario
  scene_index?: SceneIndex; // qué escena pedir; si no viene, se usa el comportamiento legacy (slice)
  plan?: IllustrationPlan; // plan ya generado en una llamada previa, para reusar sin volver a llamar a OpenAI
  synopsis?: string; // sinopsis ya generada en una llamada previa, para reusar sin volver a llamar a OpenAI
}

// ---------- Utils de tipado ----------
function isString(x: unknown): x is string {
  return typeof x === 'string';
}
function isAgeRange(x: unknown): x is AgeRange {
  return x === '2-5' || x === '6-10';
}
function isSceneIndex(x: unknown): x is SceneIndex {
  return x === 'intro' || x === 'middle' || x === 'end';
}
function isIllustrationPlan(x: unknown): x is IllustrationPlan {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  const scenes = r.scenes as Record<string, unknown> | undefined;
  return (
    Array.isArray(r.characters) &&
    typeof r.setting === 'string' &&
    typeof r.palette === 'string' &&
    typeof r.style === 'string' &&
    typeof scenes === 'object' &&
    scenes !== null &&
    typeof scenes.intro === 'string' &&
    typeof scenes.middle === 'string' &&
    typeof scenes.end === 'string'
  );
}
function isIllustrateBody(x: unknown): x is IllustrateBody {
  if (typeof x !== 'object' || x === null) return false;
  const r = x as Record<string, unknown>;
  if (!isString(r.story) || !isAgeRange(r.age_range)) return false;
  if (r.scene_index !== undefined && !isSceneIndex(r.scene_index)) return false;
  if (r.plan !== undefined && !isIllustrationPlan(r.plan)) return false;
  if (r.synopsis !== undefined && !isString(r.synopsis)) return false;
  return true;
}

// ---------- Helpers ----------
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

function safeStorySnippet(story: string, maxLen = 400): string {
  return story.replace(/[*_`>#~]/g, '').replace(/\s+/g, ' ').slice(0, maxLen);
}

function cleanForPrompt(text: string) {
  return text.replace(/[*_`>#~]/g, '').replace(/\s+/g, ' ').trim();
}

function parseJsonLoose<T>(text: string): T | null {
  try { return JSON.parse(text); } catch { /* try to salvage below */ }
  const match = text.match(/\{[\s\S]*\}/m);
  if (match) {
    try { return JSON.parse(match[0]); } catch { return null; }
  }
  return null;
}

async function safeSynopsisWithOpenAI(
  story: string,
  age: AgeRange,
  tone: string,
): Promise<string> {
  try {
    if (!openai.apiKey) throw new Error('OPENAI_API_KEY missing');
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: 'You summarize kids stories safely. Keep it wholesome, avoid scary/violent terms. Output 2 short sentences.',
        },
        {
          role: 'user',
          content: `Age: ${age}. Tone: ${tone}. Story (truncated): ${story.slice(0, 2000)}`,
        },
      ],
      max_tokens: 120,
      temperature: 0.5,
    });
    const text = result.choices?.[0]?.message?.content || '';
    const cleaned = cleanForPrompt(text).slice(0, 400);
    return cleaned.length > 20 ? cleaned : safeStorySnippet(story, 200);
  } catch {
    return safeStorySnippet(story, 200);
  }
}

async function generatePlanWithOpenAI(
  story: string,
  age: AgeRange,
  tone: string,
  characters?: string,
): Promise<IllustrationPlan | null> {
  try {
    if (!openai.apiKey) throw new Error('OPENAI_API_KEY missing');
    const characterInstruction = characters
      ? `Main character (fixed, MUST be honored exactly, do not invent a different one): ${cleanForPrompt(characters).slice(0, 300)}. `
      : '';
    const result = await openai.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [
        {
          role: 'system',
          content: `You are an art director for children's books. Produce a JSON plan for consistent illustrations. Keep it safe, wholesome, no text in images, and consistent characters/setting.`,
        },
        {
          role: 'user',
          content: `Age: ${age}. Tone: ${tone}. ${characterInstruction}Story (truncated 2000 chars): ${story.slice(0, 2000)}. Return JSON with keys: characters (array of {name, description}), setting, palette, style, scenes {intro, middle, end}. Do NOT wrap in markdown.`,
        },
      ],
      max_tokens: 400,
      temperature: 0.4,
      response_format: { type: 'json_object' },
    });
    const msg = result.choices?.[0]?.message;
    const rawContent = Array.isArray((msg as any)?.content)
      ? ((msg as any).content || []).map((c: any) => (typeof c?.text === 'string' ? c.text : '')).join(' ')
      : (msg?.content || '');
    const text = (rawContent || '').replace(/```json/gi, '').replace(/```/g, '').trim();
    const parsed = parseJsonLoose<IllustrationPlan>(text);

    // Usa el mismo validador que el round-trip del `plan` en el request (isIllustrationPlan): si un plan no
    // pasa acá, tampoco pasaría al reenviarse en las llamadas 2/3, así que no tiene sentido devolverlo.
    if (parsed && isIllustrationPlan(parsed) && parsed.characters.length > 0) {
      return parsed;
    }
    return null;
  } catch (e) {
    console.error('Plan generation failed:', e);
    return null;
  }
}

function promptsFromPlan(plan: IllustrationPlan, synopsis: string): string[] {
  const characterLine = plan.characters
    .map((c) => `${c.name}: ${c.description}`)
    .join('; ');
  const shared = `Keep ALL characters identical across images (faces, clothes, colors) and in the same main setting. Do NOT change species, outfits, or colors. Reuse the same background elements. Do NOT draw any text, letters, signs, captions, or words inside the image. Characters: ${cleanForPrompt(characterLine)}. Setting: ${cleanForPrompt(plan.setting)}. Palette: ${cleanForPrompt(plan.palette)}. Style: ${cleanForPrompt(plan.style)}. Content must be safe, wholesome, age-appropriate, no violence, no weapons, no harm. Story context: ${synopsis}.`;

  return [
    `${shared} Scene 1 (beginning): ${plan.scenes.intro}. Close-ups encouraged for recognizability.`,
    `${shared} Scene 2 (middle): ${plan.scenes.middle}. Maintain same character designs and outfits.`,
    `${shared} Scene 3 (end): ${plan.scenes.end}. Same setting elements visible.`,
  ];
}

async function generatePromptsWithOpenAI(
  story: string,
  age: AgeRange,
  tone: string,
  characters?: string,
  existingPlan?: IllustrationPlan,
  existingSynopsis?: string,
): Promise<{ prompts: string[]; plan: IllustrationPlan | null; synopsis: string }> {
  // Reusar la sinopsis de una llamada previa evita 2 llamadas extra a OpenAI por ilustración y, ya que
  // safeSynopsisWithOpenAI no es determinística (temperature 0.5), evita que cada escena describa el
  // cuento con palabras ligeramente distintas.
  const synopsis = existingSynopsis ?? await safeSynopsisWithOpenAI(story, age, tone);
  const plan = existingPlan ?? await generatePlanWithOpenAI(story, age, tone, characters);
  if (plan) {
    return { prompts: promptsFromPlan(plan, synopsis), plan, synopsis };
  }
  // If plan failed, still return a simple consistent prompt set using the synopsis
  const base = `Children's book illustration, age ${age}, tone ${tone}. Maintain SAME characters and setting across all images. Do NOT draw text, letters, or words. Safe, wholesome, no violence or harm. Story context: ${synopsis}.`;
  return {
    prompts: [
      `${base} Scene from the beginning.`,
      `${base} Scene from the middle.`,
      `${base} Scene from the end.`,
    ],
    plan: null,
    synopsis,
  };
}

function fallbackPrompts(story: string, age: AgeRange, tone: string) {
    // Fallback if prompt/plan generation fails
    const base = `Children's book illustration, age ${age}, tone ${tone}. Maintain SAME characters and setting across all images. Do NOT draw text, letters, or words. Safe, wholesome, no violence or harm. Story context: ${safeStorySnippet(story)}.`;
    return [
        `${base} Scene from the beginning: ${story.slice(0, 100)}...`,
        `${base} Scene from the middle.`,
        `${base} Scene from the end.`,
    ];
}

function normalizeAspectRatio(ar?: string): ImageAspectRatio {
  switch ((ar || '').toLowerCase()) {
    case '9:16':
    case 'portrait':
      return '9:16';
    case '16:9':
    case 'landscape':
      return '16:9';
    case '3:4':
      return '3:4';
    case '4:3':
      return '4:3';
    default:
      return '1:1';
  }
}

async function generateImagesWithOpenAI(prompts: string[], aspectRatio: ImageAspectRatio) {
  if (!openai.apiKey) return { images: [], errors: ['OPENAI_API_KEY missing'] };
  // dall-e-3 fue dado de baja por OpenAI el 2026-05-12; gpt-image-1 es el
  // reemplazo (junto con gpt-image-2/gpt-image-1-mini, no soportados por el
  // SDK instalado @openai/openai@4.104.0 todavía). A diferencia de dall-e-3,
  // gpt-image-1 siempre devuelve base64 (b64_json), nunca una url.
  const size = aspectRatio === '9:16' ? '1024x1536'
    : aspectRatio === '16:9' ? '1536x1024'
    : aspectRatio === '3:4' ? '1024x1536'
    : aspectRatio === '4:3' ? '1536x1024'
    : '1024x1024';
  const errors: string[] = [];
  const images = await Promise.all(
    prompts.map(async (prompt) => {
      try {
        const res = await openai.images.generate({
          model: 'gpt-image-1',
          prompt: cleanForPrompt(prompt),
          size,
          quality: 'medium',
          n: 1,
        });
        const b64 = res.data?.[0]?.b64_json;
        return b64 ? `data:image/png;base64,${b64}` : '';
      } catch (err) {
        console.error('OpenAI image generation failed for prompt:', prompt, err);
        errors.push((err as Error)?.message || 'OpenAI image gen failed');
        return '';
      }
    }),
  );
  return { images: images.filter((i) => i.length > 0), errors };
}

// ---------- Handler ----------
export async function POST(req: NextRequest) {
  try {
    const parsed = (await req.json()) as unknown;

    if (!isIllustrateBody(parsed)) {
      return jsonWithCors(
        req,
        { error: 'Invalid body: story & age_range required' },
        { status: 400 },
      );
    }

    const {
      story,
      age_range,
      tone = 'tierno',
      num_images = 3,
      aspect_ratio,
      size,
      characters,
      scene_index,
      plan: incomingPlan,
      synopsis: incomingSynopsis,
    } = parsed;

    if (!openai.apiKey) {
      return jsonWithCors(req, { error: 'OPENAI_API_KEY missing' }, { status: 500 });
    }

    // 1. Generate Prompts with OpenAI (síntesis + plan de arte, texto del cuento nunca sale del proveedor ya usado para generar la historia)
    // Si vienen `plan`/`synopsis` ya generados en una llamada anterior de la misma sesión de ilustración, se
    // reutilizan en vez de volver a llamar a OpenAI (stateless: van y vuelven en el body, no se persisten server-side).
    let { prompts, plan: finalPlan, synopsis: finalSynopsis } = await generatePromptsWithOpenAI(
      story, age_range, tone, characters, incomingPlan, incomingSynopsis,
    );

    if (prompts.length === 0) {
        prompts = fallbackPrompts(story, age_range, tone);
    }

    // 2. Generate Images with OpenAI (gpt-image-1)
    const finalAspectRatio = normalizeAspectRatio(aspect_ratio || size);

    let promptsToUse: string[];
    if (scene_index) {
      // El cliente pidió una escena específica: usar ese prompt exacto en vez de siempre el primero.
      const idx = SCENE_ORDER.indexOf(scene_index);
      promptsToUse = [prompts[idx] ?? prompts[0]];
    } else {
      // Comportamiento legacy (clientes que no mandan scene_index): tomar los primeros N prompts.
      const requestedImages = Math.max(1, Math.min(num_images, 6));
      promptsToUse = prompts.slice(0, requestedImages);
      while (promptsToUse.length < requestedImages) {
        promptsToUse.push(prompts[promptsToUse.length % prompts.length]);
      }
    }

    const { images: finalImages, errors: generationErrors } = await generateImagesWithOpenAI(promptsToUse, finalAspectRatio);

    if (!finalImages.length) {
      return jsonWithCors(req, { error: 'No images returned', details: generationErrors }, { status: 502 });
    }

    return jsonWithCors(
      req,
      {
        provider: 'openai:gpt-image-1',
        aspect_ratio: finalAspectRatio,
        images: finalImages,
        errors: generationErrors,
        plan: finalPlan,
        synopsis: finalSynopsis,
      },
      { status: 200 },
    );
  } catch (err) {
    const msg = err instanceof Error ? `${err.name}: ${err.message}` : 'Illustration failed';
    const stack = err instanceof Error ? err.stack : undefined;
    return jsonWithCors(req, { error: msg, stack }, { status: 502 });
  }
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
