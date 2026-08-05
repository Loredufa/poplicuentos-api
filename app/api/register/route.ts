import { z } from "zod";
import { sql } from "drizzle-orm";
import { hash } from "bcryptjs";
import { db } from "@/lib/db";
import { issueSession } from "@/lib/session";
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

    // Se normaliza en el backend y no solo en el cliente: es lo unico que
    // garantiza que el chequeo de duplicados y el login coincidan.
    const email = data.email.trim().toLowerCase();

    const existing = await db
      .select({ id: users.id })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (existing.length > 0) {
      return jsonWithCors(req, { error: "Email already registered" }, { status: 409 });
    }

    const hashed = await hash(data.password, 12);
    const inserted = await db
      .insert(users)
      .values({ email, hashed_password: hashed })
      .returning({ id: users.id });

    const u = inserted[0];

    const profileRow: typeof profiles.$inferInsert = {
      user_id: u.id,
      first_name: data.first_name,
      last_name: data.last_name,
      display_name: `${data.first_name} ${data.last_name}`.trim(),
      email,
      country: data.country ?? "",
      phone: data.phone ?? "",
      language: data.language ?? "",
      password: hashed,
    };
    await db.insert(profiles).values(profileRow);

    // Un usuario recien creado no tiene 2FA, asi que no hay corte que hacer.
    const sesion = await issueSession(u.id);

    return jsonWithCors(
      req,
      { ok: true, user_id: u.id, token: sesion.token, user: sesion.user },
      { status: 201 }
    );
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : "Bad request";
    return jsonWithCors(req, { error: message }, { status: 400 });
  }
}
