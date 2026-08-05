import { cookies } from "next/headers";
import { auth } from "@/lib/auth";
import { requireAuth } from "@/lib/requireAuth";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

export async function POST(req: Request) {
  try {
    const authResult = await requireAuth(req);
    if (!authResult.ok) return authResult.response;

    await auth.invalidateSession(authResult.session.id);
    const blank = auth.createBlankSessionCookie();
    const cookieStore = await cookies();
    cookieStore.set(blank.name, blank.value, blank.attributes);

    return jsonWithCors(req, { ok: true }, { status: 200 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Logout failed";
    return jsonWithCors(req, { error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
