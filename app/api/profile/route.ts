export const runtime = "nodejs";
export const dynamic = "force-dynamic";

import {
  bearerTokenFromAuthHeader,
  errorMessage,
  supabaseAdmin,
  supabaseAnon,
} from "@/lib/supabase";
import { NextResponse } from "next/server";

type ProfilePatch = {
  first_name?: string;
  last_name?: string;
  language?: string;
  country?: string;
  phone?: string;
  email?: string; // si decides permitir cambio de email
};

export async function PUT(req: Request) {
  try {
    const token = bearerTokenFromAuthHeader(req.headers.get("authorization"));
    if (!token) {
      return NextResponse.json({ error: "Token faltante" }, { status: 401 });
    }

    const bodyUnknown: unknown = await req.json();
    const patch = (bodyUnknown || {}) as ProfilePatch;

    const anon = supabaseAnon();
    const { data: auth, error: authErr } = await anon.auth.getUser(token);
    if (authErr || !auth.user) {
      return NextResponse.json({ error: "Token inválido" }, { status: 403 });
    }

    // Usamos Service Role para actualizar metadata del usuario por id
    const admin = supabaseAdmin();

    // 1) Metadata (first_name, last_name, language, country, phone)
    const newMeta = {
      ...auth.user.user_metadata,
      ...(patch.first_name !== undefined ? { first_name: patch.first_name } : {}),
      ...(patch.last_name !== undefined ? { last_name: patch.last_name } : {}),
      ...(patch.language !== undefined ? { language: patch.language } : {}),
      ...(patch.country !== undefined ? { country: patch.country } : {}),
      ...(patch.phone !== undefined ? { phone: patch.phone } : {}),
    };

    // 2) Si incluyes cambio de email, manejar colisión como 409
    const updateEmail = patch.email && patch.email !== auth.user.email;

    const { data: upd, error: updErr } = await admin.auth.admin.updateUserById(
      auth.user.id,
      {
        ...(updateEmail ? { email: patch.email } : {}),
        user_metadata: newMeta,
      }
    );

    if (updErr) {
      const msg = (updErr.message || "").toLowerCase();
      if (updateEmail && (msg.includes("already registered") || msg.includes("exists"))) {
        return NextResponse.json({ error: "Email en uso" }, { status: 409 });
      }
      return NextResponse.json({ error: updErr.message }, { status: 400 });
    }

    const u = upd?.user;
    const md = u?.user_metadata || {};
    return NextResponse.json(
      {
        id: u?.id,
        email: u?.email,
        first_name: md.first_name ?? null,
        last_name: md.last_name ?? null,
        language: md.language ?? null,
        country: md.country ?? null,
        phone: md.phone ?? null,
      },
      { status: 200 }
    );
  } catch (err: unknown) {
    return NextResponse.json({ error: errorMessage(err) }, { status: 500 });
  }
}

export async function GET() {
  return NextResponse.json({ message: "Method Not Allowed" }, { status: 405 });
}
