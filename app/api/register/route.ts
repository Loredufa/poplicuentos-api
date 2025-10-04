export const runtime = "nodejs";
export const dynamic = "force-dynamic";

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

// Service Role (solo server-side, Node runtime)
const admin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

// Anon para login automático
const anon = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;
const errMsg = (e: unknown) => (e instanceof Error ? e.message : "Internal Server Error");

export async function POST(req: Request) {
  try {
    // 1) Content-Type debe ser JSON
    const ct = req.headers.get("content-type") || "";
    if (!ct.toLowerCase().includes("application/json")) {
      return NextResponse.json(
        { error: "Content-Type debe ser application/json" },
        { status: 400 }
      );
    }

    // 2) Parseo body
    let raw: unknown;
    try {
      raw = await req.json();
    } catch {
      return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
    }
    const b = raw as Partial<RegisterBody>;

    // 3) Validación de requeridos
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

    // 4) Crear usuario
    const adm = admin();
    const { data, error } = await adm.auth.admin.createUser({
      email: b.email!,
      password: b.password!,
      email_confirm: true,
      user_metadata: {
        first_name: b.first_name!,
        last_name: b.last_name!,
        country: isStr(b.country) ? b.country : null,
        phone: isStr(b.phone) ? b.phone : null,
        language: isStr(b.language) ? b.language : "es",
      },
    });

    if (error) {
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already") || msg.includes("exists") || msg.includes("registered")) {
        return NextResponse.json({ error: "Email ya registrado" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // 5) Login automático (variante A esperada por tu app)
    const a = anon();
    const { data: signed } = await a.auth.signInWithPassword({
      email: b.email!,
      password: b.password!,
    });

    if (signed?.session?.access_token && signed.user) {
      return NextResponse.json(
        {
          token: signed.session.access_token,
          user: { id: signed.user.id, email: signed.user.email },
        },
        { status: 200 }
      );
    }

    // 6) Variante B: verificación por email
    return NextResponse.json({ user_id: data.user?.id }, { status: 200 });
  } catch (e: unknown) {
    return NextResponse.json({ error: errMsg(e) }, { status: 500 });
  }
}

// 405 explícito
export async function GET() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}

