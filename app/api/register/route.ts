// app/api/register/route.ts
export const runtime = "nodejs";        // Service Role => Node
export const dynamic = "force-dynamic";

import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";

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

const admin = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.SUPABASE_SERVICE_ROLE_KEY!);
const anon = (): SupabaseClient =>
  createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!);

// parser tolerante: acepta JSON aunque el header venga mal desde la APK
async function readBodyAsJson(req: Request): Promise<unknown | null> {
  const ct = (req.headers.get("content-type") || "").toLowerCase();
  if (ct.includes("application/json")) {
    try { return await req.json(); } catch { /* fall through */ }
  }
  try {
    const txt = await req.text();
    if (!txt) return null;
    return JSON.parse(txt);
  } catch {
    return null;
  }
}

export async function POST(req: Request) {
  const respond = (body: unknown, init?: ResponseInit) =>
    jsonWithCors(req, body, init);
  try {
    const raw = await readBodyAsJson(req);
    if (!raw || typeof raw !== "object") {
      return respond({ error: "Body inválido o no-JSON" }, { status: 400 });
    }

    const b = raw as Partial<RegisterBody>;
    const missing = [
      ["first_name", b.first_name],
      ["last_name", b.last_name],
      ["email", b.email],
      ["password", b.password],
    ].filter(([_, v]) => !isStr(v)).map(([k]) => k);

    if (missing.length) {
      return respond(
        { error: `Body inválido. Faltan: ${missing.join(", ")}` },
        { status: 400 }
      );
    }

    // normalizamos email y campos
    const email = b.email!.trim().toLowerCase();
    const first_name = b.first_name!.trim();
    const last_name = b.last_name!.trim();
    const country = isStr(b.country) ? b.country.trim() : null;   // "AR" o "Argentina", lo guardamos tal cual
    const phone = isStr(b.phone) ? b.phone.trim() : null;
    const language = isStr(b.language) ? b.language.trim() : "es";
    const password = b.password!; // si tu policy es estricta, validala aquí

    const sa = admin();

    // 1) Chequeo de existencia idempotente (evita duplicados y carreras)
    // listUsers no tiene filtro exacto, así que filtramos client-side
    const { data: listed, error: listErr } = await sa.auth.admin.listUsers({ perPage: 200 }); 
    if (listErr) {
      return respond({ error: listErr.message }, { status: 400 });
    }
    const exists = listed?.users?.some(u => u.email?.toLowerCase() === email) ?? false;
    if (exists) {
      return respond({ error: "Email ya registrado" }, { status: 409 });
    }

    // 2) Crear usuario (Service Role, Node runtime)
    const { data: created, error } = await sa.auth.admin.createUser({
      email,
      password,
      email_confirm: true, // o false si querés verificación por email
      user_metadata: { first_name, last_name, country, phone, language },
    });

    if (error) {
      const m = (error.message || "").toLowerCase();
      if (m.includes("already") || m.includes("exists") || m.includes("duplicate") || m.includes("registered")) {
        return respond({ error: "Email ya registrado" }, { status: 409 });
      }
      // GoTrue a veces devuelve "database error saving new user" para violaciones genéricas
      return respond({ error: error.message }, { status: 400 });
    }

    // 3) Login automático (variante A) si tu proyecto permite sesión inmediata
    // (si tenés "Email confirmations = ON", probablemente no retorna sesión, y devolvemos user_id)
    const a = anon();
    const { data: signed } = await a.auth.signInWithPassword({ email, password });
    if (signed?.session?.access_token && signed.user) {
      return respond({
        token: signed.session.access_token,
        user: { id: signed.user.id, email: signed.user.email },
      });
    }

    // 4) Variante B: verificación por email
    return respond({ user_id: created.user?.id }, { status: 200 });
  } catch (e: unknown) {
    return respond({ error: errMsg(e) }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
