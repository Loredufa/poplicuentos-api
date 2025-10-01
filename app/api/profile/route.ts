import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Internal Server Error";
}

export async function GET(req: Request) {
  try {
    const auth = req.headers.get("authorization") ?? "";
    const parts = auth.split(" ");
    const token = parts.length === 2 && /^Bearer$/i.test(parts[0]) ? parts[1] : "";

    if (!token) {
      return NextResponse.json(
        { error: "Missing Authorization bearer token" },
        { status: 401 }
      );
    }

    const supabase = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL!,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
    );

    const { data, error } = await supabase.auth.getUser(token);

    if (error || !data.user) {
      return NextResponse.json(
        { error: error?.message ?? "Invalid or expired token" },
        { status: 401 }
      );
    }

    const u = data.user;
    return NextResponse.json(
      {
        user: {
          id: u.id,
          email: u.email,
          app_metadata: u.app_metadata ?? {},
          user_metadata: u.user_metadata ?? {},
          created_at: u.created_at,
          last_sign_in_at: u.last_sign_in_at,
          phone: u.phone ?? null,
        },
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
