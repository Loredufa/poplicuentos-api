import { bearerTokenFromAuthHeader, errorMessage, supabaseAnon } from "@/lib/supabase";
import { NextResponse } from "next/server";

// Nota: Supabase maneja JWT stateless; el front puede borrar el token local.
// Si quieres revocar refresh tokens, necesitarías enviarlo explícitamente.
// Aquí devolvemos {ok:true} si hay un Bearer y es válido.

export async function POST(req: Request) {
  try {
    const token = bearerTokenFromAuthHeader(req.headers.get("authorization"));
    if (!token) {
      return NextResponse.json({ error: "Token faltante" }, { status: 401 });
    }

    // Validamos el token (opcional, para responder 401 si es inválido)
    const supabase = supabaseAnon();
    const { data } = await supabase.auth.getUser(token);
    if (!data.user) {
      return NextResponse.json({ error: "Token inválido" }, { status: 401 });
    }

    // Aquí podrías revocar refresh tokens si los recibieras.
    return NextResponse.json({ ok: true }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}
