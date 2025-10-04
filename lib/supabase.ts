// lib/supabase.ts
import { createClient } from "@supabase/supabase-js";

export const supabaseAnon = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );

export const supabaseAdmin = () =>
  createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY! // server-side only
  );

export function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : "Internal Server Error";
}

export function bearerTokenFromAuthHeader(h: string | null): string | null {
  if (!h) return null;
  const [scheme, token] = h.split(" ");
  if (!/^Bearer$/i.test(scheme || "")) return null;
  return token || null;
}
