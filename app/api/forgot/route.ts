// app/api/forgot/route.ts
import { errorMessage, supabaseAnon } from "@/lib/supabase";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

type ForgotBody = { email: string };
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json();
    const b = raw as Partial<ForgotBody>;
    if (!isStr(b.email)) {
      return jsonWithCors(req, { error: "Email inválido" }, { status: 400 });
    }

    const supabase = supabaseAnon();
    // sin redirectTo → usa el SITE_URL de Auth Settings
    await supabase.auth.resetPasswordForEmail(b.email);

    return jsonWithCors(req, { sent: true }, { status: 200 });
  } catch (err: unknown) {
    return jsonWithCors(req, { error: errorMessage(err) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
