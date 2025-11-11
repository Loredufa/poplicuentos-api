import { errorMessage, supabaseAnon } from "@/lib/supabase";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

type LoginBody = { email: string; password: string };

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json();
    const body = raw as Partial<LoginBody>;

    if (!isNonEmptyString(body.email) || !isNonEmptyString(body.password)) {
      return jsonWithCors(req, { error: "Body inválido" }, { status: 400 });
    }

    const supabase = supabaseAnon();
    const { data, error } = await supabase.auth.signInWithPassword({
      email: body.email,
      password: body.password,
    });

    if (error || !data.session || !data.user) {
      return jsonWithCors(req, { error: "Credenciales inválidas" }, { status: 401 });
    }

    const token = data.session.access_token;
    const md = data.user.user_metadata || {};
    return jsonWithCors(
      req,
      {
        token,
        user: {
          id: data.user.id,
          email: data.user.email,
          first_name: md.first_name ?? null,
          last_name: md.last_name ?? null,
        },
      }
    );
  } catch (err: unknown) {
    // Si tuvieras rate limit, acá mapearías a 429 según tu middleware
    return jsonWithCors(req, { error: errorMessage(err) }, { status: 500 });
  }
}

// 405 para otros métodos
export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

