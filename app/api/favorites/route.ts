// app/api/favorites/route.ts
export const runtime = "nodejs";
export const dynamic = "force-dynamic";
import { createClient } from "@supabase/supabase-js";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

// --- Tipos mínimos de tu tabla (ajústalos si tu esquema real difiere) ---
type FavoritesInsert = {
  id?: string;
  user_id: string;
  title: string;
  story: string;
  age_range: string | null;
  skill: string | null;
  tone: string | null;
  minutes: number;
  created_at?: string;
};

// Si querés diferenciar Row/Insert, podés hacer Row = Insert with id/created_at always present
type FavoritesRow = Required<Omit<FavoritesInsert, "created_at">> & {
  created_at: string;
};

type Database = {
  public: {
    Tables: {
      favorites: {
        Row: FavoritesRow;
        Insert: FavoritesInsert;
        Update: Partial<FavoritesInsert>;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

// --- helpers locales para no depender de otros archivos ---
const admin = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!
  );

const anon = () =>
  createClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

function bearer(h: string | null): string | null {
  if (!h) return null;
  const [scheme, token] = h.split(" ");
  return /^Bearer$/i.test(scheme || "") ? token || null : null;
}

function isStr(v: unknown): v is string {
  return typeof v === "string" && v.trim().length > 0;
}

function isNum(v: unknown): v is number {
  return typeof v === "number" && Number.isFinite(v);
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Internal Server Error";
}

// Campos que vamos a devolver tras insertar
const COLS =
  "id,user_id,title,story,age_range,skill,tone,minutes,created_at";

// ----------------------------------------------------------------------
// POST /api/favorites  -> Crea un favorito del usuario autenticado
// Body esperado: { title: string, story: string, age_range?: string, skill?: string, tone?: string, minutes: number }
// Header: Authorization: Bearer <token>
// ----------------------------------------------------------------------
export async function POST(req: Request) {
  const respond = (body: unknown, init?: ResponseInit) =>
    jsonWithCors(req, body, init);
  try {
    const token = bearer(req.headers.get("authorization"));
    if (!token) {
      return respond({ error: "Token faltante" }, { status: 401 });
    }

    // Validamos al usuario con el token (anon - valida JWT)
    const a = anon();
    const { data: who, error: whoErr } = await a.auth.getUser(token);
    if (whoErr || !who.user) {
      return respond({ error: "Token inválido" }, { status: 403 });
    }
    const userId = who.user.id;

    const raw: unknown = await req.json();
    const body = raw as Partial<{
      title: unknown;
      story: unknown;
      age_range: unknown;
      skill: unknown;
      tone: unknown;
      minutes: unknown;
    }>;

    // Validación mínima
    if (!isStr(body.title) || !isStr(body.story)) {
      return respond(
        { error: "Body inválido: title y story son requeridos" },
        { status: 400 }
      );
    }
    if (body.minutes !== undefined && !isNum(body.minutes)) {
      return respond(
        { error: "Body inválido: minutes debe ser número" },
        { status: 400 }
      );
    }

    const payload: FavoritesInsert = {
      user_id: userId,
      title: body.title,
      story: body.story,
      age_range: body.age_range && isStr(body.age_range) ? body.age_range : null,
      skill: body.skill && isStr(body.skill) ? body.skill : null,
      tone: body.tone && isStr(body.tone) ? body.tone : null,
      minutes: isNum(body.minutes) ? body.minutes : 0,
    };

    // Cliente ADMIN tipado -> la tabla ya no es "never"
    const db = admin();
    const { data, error } = await db
      .from("favorites")
      .insert(payload)              // también vale .insert([payload]) si preferís array
      .select(COLS)
      .single();

    if (error) {
      return respond({ error: error.message }, { status: 400 });
    }

    return respond(data, { status: 200 });
  } catch (err: unknown) {
    return respond({ error: errorMessage(err) }, { status: 500 });
  }
}

// ----------------------------------------------------------------------
// GET /api/favorites  -> Lista los favoritos del usuario autenticado
// Header: Authorization: Bearer <token>
// ----------------------------------------------------------------------
export async function GET(req: Request) {
  const respond = (body: unknown, init?: ResponseInit) =>
    jsonWithCors(req, body, init);
  try {
    const token = bearer(req.headers.get("authorization"));
    if (!token) {
      return respond({ error: "Token faltante" }, { status: 401 });
    }

    const a = anon();
    const { data: who, error: whoErr } = await a.auth.getUser(token);
    if (whoErr || !who.user) {
      return respond({ error: "Token inválido" }, { status: 403 });
    }
    const userId = who.user.id;

    // Para listar podemos usar anon si tenés RLS, o admin si no tenés políticas
    const db = admin();
    const { data, error } = await db
      .from("favorites")
      .select(COLS)
      .eq("user_id", userId)
      .order("created_at", { ascending: false });

    if (error) {
      return respond({ error: error.message }, { status: 400 });
    }
    return respond(data ?? [], { status: 200 });
  } catch (err: unknown) {
    return respond({ error: errorMessage(err) }, { status: 500 });
  }
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
