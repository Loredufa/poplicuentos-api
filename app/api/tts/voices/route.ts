export const runtime = "nodejs";

import { NextRequest } from "next/server";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { AVAILABLE_TTS_VOICES } from "@/lib/tts";

export async function GET(req: NextRequest) {
  return jsonWithCors(req, {
    voices: AVAILABLE_TTS_VOICES.map((v) => ({
      id: v.id,
      label: v.label,
      description: v.description,
      idealFor: v.idealFor,
      timbre: v.timbre,
      sample_text: v.sampleText,
    })),
  });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
