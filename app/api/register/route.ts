// app/api/register/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

// Inicializar cliente con variables de entorno
const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY! // usar Service Role para crear usuarios
);

export async function POST(req: Request) {
  try {
    const body = await req.json();

    const { first_name, last_name, email, country, phone, language, password } = body;

    if (!first_name || !last_name || !email || !password) {
      return NextResponse.json(
        { error: "Missing required fields" },
        { status: 400 }
      );
    }

    // Crear usuario en Supabase Auth
    const { data, error } = await supabase.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // marca email como confirmado
      user_metadata: {
        first_name,
        last_name,
        country,
        phone,
        language,
      },
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 400 });
    }

    return NextResponse.json(
      { message: "User registered successfully", user: data.user },
      { status: 201 }
    );
  } catch (err: any) {
    return NextResponse.json(
      { error: err.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
