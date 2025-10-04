// app/api/register/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type RegisterBody = {
  first_name: string;
  last_name: string;
  email: string;
  country?: string;
  phone?: string;
  language?: string;
  password: string;
};

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Internal Server Error");

// Cliente ANON (sirve en Edge o Node)
const anon = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

export async function POST(req: Request) {
  try {
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) {
      return NextResponse.json({ error: "Content-Type debe ser application/json" }, { status: 400 });
    }

    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }

    const b = raw as Partial<RegisterBody>;
    const missing = [
      ["first_name", b.first_name],
      ["last_name", b.last_name],
      ["email", b.email],
      ["password", b.password],
    ]
      .filter(([_, v]) => !isStr(v))
      .map(([k]) => k);

    if (missing.length) {
      return NextResponse.json(
        { error: `Body inválido. Faltan: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    const supabase = anon();
    const { data, error } = await supabase.auth.signUp({
      email: b.email!,
      password: b.password!,
      options: {
        data: {
          first_name: b.first_name!,
          last_name: b.last_name!,
          country: isStr(b.country) ? b.country : null,
        // acepta “Argentina” o “AR”; lo guardamos tal cual
          phone: isStr(b.phone) ? b.phone : null,
          language: isStr(b.language) ? b.language : "es",
        },
        // Si luego implementás deep link, podés setear emailRedirectTo aquí
        // emailRedirectTo: process.env.RESET_PASSWORD_REDIRECT_URL,
      },
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      // Mapear “ya registrado” a 409 (cubre variantes de Supabase)
      if (
        msg.includes("already") || msg.includes("exists") ||
        msg.includes("registered") || msg.includes("duplicate")
      ) {
        return NextResponse.json({ error: "Email ya registrado" }, { status: 409 });
      }
      // Password policy u otros -> 400 con detalle
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Variante A (login automático): si tu proyecto permite sesión inmediata
    if (data?.session?.access_token && data.user) {
      return NextResponse.json(
        {
          token: data.session.access_token,
          user: { id: data.user.id, email: data.user.email },
        },
        { status: 200 }
      );
    }

    // Variante B (verificación por email)
    return NextResponse.json({ user_id: data.user?.id }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}

