import { bearerTokenFromAuthHeader, errorMessage, supabaseAnon } from "@/lib/supabase";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

export async function GET(req: Request) {
  try {
    const token = bearerTokenFromAuthHeader(req.headers.get("authorization"));
    if (!token) {
      return jsonWithCors(req, { error: "Token faltante" }, { status: 401 });
    }

    const supabase = supabaseAnon();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return jsonWithCors(req, { error: "Token inválido" }, { status: 403 });
    }

    const md = data.user.user_metadata || {};
    return jsonWithCors(req, {
      id: data.user.id,
      email: data.user.email,
      first_name: md.first_name ?? null,
      last_name: md.last_name ?? null,
      language: md.language ?? null,
      country: md.country ?? null,
      phone: md.phone ?? null,
      // puedes incluir otros campos si los tienes
    });
  } catch (err: unknown) {
    return jsonWithCors(req, { error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
