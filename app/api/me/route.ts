import { bearerTokenFromAuthHeader, errorMessage, supabaseAnon } from "@/lib/supabase";
import { NextResponse } from "next/server";

export async function GET(req: Request) {
  try {
    const token = bearerTokenFromAuthHeader(req.headers.get("authorization"));
    if (!token) {
      return NextResponse.json({ error: "Token faltante" }, { status: 401 });
    }

    const supabase = supabaseAnon();
    const { data, error } = await supabase.auth.getUser(token);
    if (error || !data.user) {
      return NextResponse.json({ error: "Token inválido" }, { status: 403 });
    }

    const md = data.user.user_metadata || {};
    return NextResponse.json(
      {
        id: data.user.id,
        email: data.user.email,
        first_name: md.first_name ?? null,
        last_name: md.last_name ?? null,
        language: md.language ?? null,
        country: md.country ?? null,
        phone: md.phone ?? null,
        // puedes incluir otros campos si los tienes
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function POST() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}
