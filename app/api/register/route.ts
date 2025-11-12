import { cookies } from "next/headers";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { auth } from "@/lib/auth";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { profiles, users } from "@/db/schema";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  first_name: z.string().min(1),
  last_name: z.string().min(1),
  language: z.string().optional(),
  country: z.string().optional(),
  phone: z.string().optional(),
});

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}

export async function POST(req: Request) {
  try {
    const data = Body.parse(await req.json());

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, data.email))
      .limit(1);

    if (existing.length > 0) {
      return jsonWithCors(req, { error: "Email already registered" }, { status: 409 });
    }

    const hashed = await hash(data.password, 12);
    const inserted = await db
      .insert(users)
      .values({ email: data.email, hashed_password: hashed })
      .returning({ id: users.id });

    const u = inserted[0];

    const profileRow: typeof profiles.$inferInsert = {
      user_id: u.id,
      first_name: data.first_name,
      last_name: data.last_name,
      display_name: `${data.first_name} ${data.last_name}`.trim(),
      email: data.email,
      country: data.country ?? "",
      phone: data.phone ?? "",
      language: data.language ?? "",
      password: hashed,
    };
    await db.insert(profiles).values(profileRow);

    const session = await auth.createSession(u.id, {});
    const sessionCookie = auth.createSessionCookie(session.id);
    const cookieStore = await cookies();
    cookieStore.set(sessionCookie.name, sessionCookie.value, sessionCookie.attributes);

    return jsonWithCors(
      req,
      { ok: true, user_id: u.id, token: session.id },
      { status: 201 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Bad request";
    return jsonWithCors(req, { error: message }, { status: 400 });
  }
}
