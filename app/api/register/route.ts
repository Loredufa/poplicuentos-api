import { errorMessage, supabaseAdmin, supabaseAnon } from "@/lib/supabase";
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

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json();
    const b = raw as Partial<RegisterBody>;

    if (
      !isNonEmptyString(b.first_name) ||
      !isNonEmptyString(b.last_name) ||
      !isNonEmptyString(b.email) ||
      !isNonEmptyString(b.password)
    ) {
      return NextResponse.json({ error: "Body inválido" }, { status: 400 });
    }

    // Crear usuario con Service Role
    const admin = supabaseAdmin();
    const { data, error } = await admin.auth.admin.createUser({
      email: b.email,
      password: b.password,
      user_metadata: {
        first_name: b.first_name,
        last_name: b.last_name,
        country: b.country ?? null,
        phone: b.phone ?? null,
        language: b.language ?? "es",
      },
      email_confirm: true, // puedes cambiarlo si quieres verificación por mail
    });

    if (error) {
      // Mapear "ya existe" a 409
      const msg = (error.message || "").toLowerCase();
      if (msg.includes("already registered") || msg.includes("user already exists")) {
        return NextResponse.json({ error: "Email ya registrado" }, { status: 409 });
      }
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    // Variante A: registro + login automático (preferida por tu front)
    const anon = supabaseAnon();
    const { data: d2 } = await anon.auth.signInWithPassword({
      email: b.email,
      password: b.password,
    });

    if (d2?.session?.access_token && d2.user) {
      return NextResponse.json(
        {
          token: d2.session.access_token,
          user: { id: d2.user.id, email: d2.user.email },
        },
        { status: 200 }
      );
    }

    // Variante B: si no hay sesión (p.ej., requiere verificación), devolvemos user_id
    return NextResponse.json({ user_id: data.user?.id }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}

