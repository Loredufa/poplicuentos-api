import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";

type LoginBody = { email: string; password: string };

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
);

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Internal Server Error";
}

function isNonEmptyString(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

export async function POST(req: Request) {
  try {
    const bodyUnknown = await req.json();
    const b = bodyUnknown as Partial<LoginBody>;

    if (!isNonEmptyString(b.email) || !isNonEmptyString(b.password)) {
      return NextResponse.json(
        { error: "Email and password are required" },
        { status: 400 }
      );
    }

    const { data, error } = await supabase.auth.signInWithPassword({
      email: b.email,
      password: b.password,
    });

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 401 });
    }

    return NextResponse.json(
      { message: "Login successful", session: data.session, user: data.user },
      { status: 200 }
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}
