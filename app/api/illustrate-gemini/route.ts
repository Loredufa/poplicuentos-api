export const runtime = "nodejs";

import { NextRequest, NextResponse } from "next/server";

// ---------- Tipos ----------

type AgeRange = "2-5" | "6-10";

interface IllustrateBody {
  age_range: AgeRange;
  theme?: string;
  skill?: string;
  characters?: string;
  tone?: string;
  locale?: string;
  story: string;
  count?: number;      // lo que estás logueando
  num_images?: number; // idem
}

// Endpoint oficial de NanoBanana :contentReference[oaicite:0]{index=0}
const NANOBANANA_ENDPOINT =
  "https://api.nanobananaapi.ai/api/v1/nanobanana/generate";

// ---------- CORS ----------

const corsHeaders: HeadersInit = {
  "Access-Control-Allow-Origin": "*", // si querés, cambiá por tu dominio
  "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function OPTIONS() {
  // Respuesta al preflight CORS
  return new NextResponse(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// ---------- Helpers ----------

function buildPrompt(body: IllustrateBody): string {
  const { age_range, theme, skill, characters, tone, locale, story } = body;

  const lines: string[] = [];

  lines.push(`Ilustración para cuento infantil (edad ${age_range} años).`);

  if (locale) {
    lines.push(`Público objetivo: familias de ${locale}.`);
  }

  if (theme) {
    lines.push(`Tema educativo: ${theme}.`);
  }

  if (skill) {
    lines.push(
      `Habilidad emocional que se quiere trabajar con esta escena: ${skill}.`
    );
  }

  if (characters) {
    lines.push(
      `Personajes principales (mantener consistencia de diseño a lo largo del libro): ${characters}.`
    );
  }

  if (tone) {
    lines.push(`Tono visual: ${tone}, cálido y amigable.`);
  } else {
    lines.push("Tono visual: tierno, cálido y amigable.");
  }

  lines.push(
    "Estilo artístico: ilustración para libro infantil, colores suaves, sin texto dentro de la imagen."
  );

  lines.push(
    "Describe claramente la escena clave y la expresión emocional de los personajes."
  );

  lines.push("Escena a ilustrar (texto original del cuento):");
  lines.push(story);

  return lines.join("\n");
}

// mapeo simple de rango de edad -> aspecto de imagen :contentReference[oaicite:1]{index=1}
function mapAspectRatio(ageRange: AgeRange): string {
  switch (ageRange) {
    case "2-5":
      return "3:4"; // vertical tipo libro infantil
    case "6-10":
      return "4:3"; // un poco más ancho
    default:
      return "3:4";
  }
}

// ---------- Handler principal ----------

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as IllustrateBody;

    console.log("[illustrate-gemini] request body", body);

    if (!body.story || !body.age_range) {
      return NextResponse.json(
        { error: "story y age_range son obligatorios" },
        { status: 400, headers: corsHeaders }
      );
    }

    const apiKey = process.env.NANOBANANA_API_KEY;
    const callbackUrl = process.env.NANOBANANA_CALLBACK_URL;

    if (!apiKey || !callbackUrl) {
      console.error(
        "[illustrate-gemini] Faltan NANOBANANA_API_KEY o NANOBANANA_CALLBACK_URL"
      );
      return NextResponse.json(
        { error: "Configuración del servidor incompleta" },
        { status: 500, headers: corsHeaders }
      );
    }

    // Queremos varias imágenes en UN solo llamado.
    // Usamos body.num_images o body.count, por defecto 3.
    let requested =
      body.num_images ?? body.count ?? 3; // puede venir como string en algún caso

    if (typeof requested !== "number") {
      requested = Number(requested) || 3;
    }

    // La API permite 1–4 imágenes por request :contentReference[oaicite:2]{index=2}
    const numImages = Math.min(Math.max(requested, 1), 4);

    const prompt = buildPrompt(body);
    const imageSize = mapAspectRatio(body.age_range);

    const nanobananaRequest = {
      prompt,
      numImages,
      type: "TEXTTOIAMGE", // sí, está escrito así en la doc
      image_size: imageSize,
      callBackUrl: callbackUrl,
    };

    console.log(
      "[illustrate-gemini] sending ONE request to NanoBanana",
      nanobananaRequest
    );

    const response = await fetch(NANOBANANA_ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(nanobananaRequest),
    });

    const raw = await response.text();

    console.log(
      "[illustrate-gemini] NanoBanana response",
      response.status,
      raw
    );

    if (!response.ok) {
      // Devolvemos info para debug
      return NextResponse.json(
        {
          error: "Error al llamar a NanoBanana",
          status: response.status,
          body: raw,
        },
        { status: 502, headers: corsHeaders }
      );
    }

    let parsed: any;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }

    // Respuesta típica: { code, msg, data: { taskId } } :contentReference[oaicite:3]{index=3}
    const taskId = parsed?.data?.taskId ?? null;

    if (!taskId) {
      return NextResponse.json(
        { error: "NanoBanana no devolvió taskId", raw: parsed },
        { status: 502, headers: corsHeaders }
      );
    }

    // Poll a record-info hasta obtener las URLs
    const urls: string[] = [];
    const errors: string[] = [];

    const collectUrls = (source: unknown) => {
      if (!source) return;
      if (typeof source === "string" && /^https?:\/\//i.test(source)) {
        urls.push(source);
        return;
      }
      if (Array.isArray(source)) {
        source.forEach(collectUrls);
        return;
      }
      if (typeof source === "object") {
        Object.values(source as Record<string, unknown>).forEach(collectUrls);
      }
    };

    const pollUrl = `${NANOBANANA_ENDPOINT.replace("/generate", "")}/record-info?taskId=${encodeURIComponent(
      taskId
    )}`;

    const start = Date.now();
    const timeoutMs = 120_000;
    const intervalMs = 5_000;

    while (Date.now() - start < timeoutMs) {
      const pollRes = await fetch(pollUrl, {
        headers: { Authorization: `Bearer ${apiKey}` },
      });
      const pollRaw = await pollRes.text();
      let pollJson: any;
      try {
        pollJson = JSON.parse(pollRaw);
      } catch {
        pollJson = { raw: pollRaw };
      }

      console.log("[illustrate-gemini] poll", pollRes.status);

      if (!pollRes.ok || pollJson?.code !== 200) {
        errors.push(pollJson?.msg || pollRes.statusText || "poll failed");
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }

      const data = pollJson?.data || {};
      const status = data.successFlag;

      if (status === 0) {
        await new Promise((r) => setTimeout(r, intervalMs));
        continue;
      }

      if (status === 1) {
        collectUrls(data.response);
        collectUrls(data.resultImageUrl);
        collectUrls(data.resultImageUrls);
        collectUrls(data.originImageUrl);
        collectUrls(data.originImageUrls);
        break;
      }

      const msg = data.errorMessage || "Generation failed";
      errors.push(msg);
      break;
    }

    const finalImages = urls.slice(0, numImages);

    if (!finalImages.length) {
      console.error("[illustrate-gemini] no images after poll", { errors });
      return NextResponse.json(
        { error: "No images returned", errors },
        { status: 502, headers: corsHeaders }
      );
    }

    return NextResponse.json(
      {
        provider: "nanobanana",
        aspect_ratio: imageSize,
        images: finalImages,
        errors,
        taskId,
      },
      { status: 200, headers: corsHeaders }
    );
  } catch (err: any) {
    console.error("[illustrate-gemini] unexpected error", err);
    return NextResponse.json(
      {
        error: err?.message ?? "Internal server error",
      },
      { status: 500, headers: corsHeaders }
    );
  }
}
