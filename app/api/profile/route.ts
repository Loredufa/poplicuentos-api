// app/api/profile/route.ts
import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

/**
 * GET /api/profile
 * Authorization: Bearer <access_token>
 *
 * Devuelve los datos del usuario autenticado.
 */
export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") || "";
    const [, token] = auth.split(" ");

    if (!token) {
      return NextResponse.json(
        { error: "Missing Authorization bearer token" },
        { status: 401 }
      );
    }

    // Para leer/validar el JWT, alcanza con la anon key
    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    // Valida el JWT y obtiene el usuario
    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message || "Invalid or expired token" },
        { status: 401 }
      );
    }

    // Estructura de respuesta (puedes ajustar según tu necesidad)
    const user = data.user;
    const profile = {
      id: user.id,
      email: user.email,
      app_metadata: user.app_metadata ?? {},
      user_metadata: user.user_metadata ?? {},
      created_at: user.created_at,
      last_sign_in_at: user.last_sign_in_at,
      phone: user.phone ?? null,
    };

    return NextResponse.json({ user: profile }, { status: 200 });
  } catch (err: any) {
    return NextResponse.json(
      { error: err?.message || "Internal Server Error" },
      { status: 500 }
    );
  }
}
