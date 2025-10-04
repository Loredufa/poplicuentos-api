// app/api/forgot/route.ts
import { errorMessage, supabaseAnon } from "@/lib/supabase";
import { NextResponse } from "next/server";

type ForgotBody = { email: string };
const isStr = (v: unknown): v is string => typeof v === "string" && v.trim().length > 0;

export async function POST(req: Request) {
  try {
    const raw: unknown = await req.json();
    const b = raw as Partial<ForgotBody>;
    if (!isStr(b.email)) {
      return NextResponse.json({ error: "Email inválido" }, { status: 400 });
    }

    const supabase = supabaseAnon();
    // sin redirectTo → usa el SITE_URL de Auth Settings
    await supabase.auth.resetPasswordForEmail(b.email);

    return NextResponse.json({ sent: true }, { status: 200 });
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}

