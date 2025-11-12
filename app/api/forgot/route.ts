import { eq } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { users } from "@/db/schema";
import { jsonWithCors, optionsResponse } from "@/lib/cors";

const Body = z.object({
  email: z.string().email(),
});

export async function POST(req: Request) {
  try {
    const { email } = Body.parse(await req.json());
    await db
      .select({ id: users.id })
      .from(users)
      .where(eq(users.email, email))
      .limit(1);

    // Aquí podrías generar un token y enviarlo por email.
    return jsonWithCors(req, { sent: true }, { status: 202 });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "No se pudo iniciar el reset";
    return jsonWithCors(req, { error: message }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
