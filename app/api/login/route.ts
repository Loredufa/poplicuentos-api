import { cookies } from "next/headers";
import { compare } from "bcryptjs";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { profiles, users } from "@/db/schema";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());

    const [record] = await db
      .select({
        id: users.id,
        email: users.email,
        hashed_password: users.hashed_password,
        profile: {
          first_name: profiles.first_name,
          last_name: profiles.last_name,
          language: profiles.language,
          country: profiles.country,
          phone: profiles.phone,
        },
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.user_id, users.id))
      .where(eq(users.email, body.email))
      .limit(1);

    if (!record || !(await compare(body.password, record.hashed_password))) {
      return jsonWithCors(req, { error: "Credenciales inválidas" }, { status: 401 });
    }

    const session = await auth.createSession(record.id, {});
    const sessionCookie = auth.createSessionCookie(session.id);
    const cookieStore = await cookies();
    cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    const profile = record.profile;
    return jsonWithCors(req, {
      token: session.id,
      user: {
        id: record.id,
        email: record.email,
        first_name: profile?.first_name ?? null,
        last_name: profile?.last_name ?? null,
        language: profile?.language ?? null,
        country: profile?.country ?? null,
        phone: profile?.phone ?? null,
      },
    });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Login failed";
    return jsonWithCors(req, { error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
