export const runtime = "nodejs";

import { compare } from "bcryptjs";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@/lib/db";
import { jsonWithCors, optionsResponse } from "@/lib/cors";
import { loginChallenges, userTotp, users } from "@/db/schema";
import { issueSession } from "@/lib/session";
import {
  calcularVencimiento,
  generarToken,
  hashearToken,
  TTL_MS,
} from "@/lib/mfaChallenge";

const Body = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const body = Body.parse(await req.json());

    // La columna es `text`, asi que `=` compara sensible a mayusculas. El
    // registro guarda el email en minusculas pero el login lo mandaba tal cual
    // lo tipeaba el usuario: quien escribiera una mayuscula no podia entrar.
    const email = body.email.trim().toLowerCase();

    const [record] = await db
      .select({
        id: users.id,
        hashed_password: users.hashed_password,
      })
      .from(users)
      .where(sql`lower(${users.email}) = ${email}`)
      .limit(1);

    if (!record || !(await compare(body.password, record.hashed_password))) {
      return jsonWithCors(req, { error: "Credenciales inválidas" }, { status: 401 });
    }

    // --- Corte de 2FA ---
    // La contraseña ya es correcta, pero si el usuario tiene un segundo factor
    // activo no se crea la sesion todavia.
    const [totp] = await db
      .select({ id: userTotp.id })
      .from(userTotp)
      .where(and(eq(userTotp.userId, record.id), eq(userTotp.status, "active")))
      .limit(1);

    if (totp) {
      const token = generarToken();
      await db.insert(loginChallenges).values({
        userId: record.id,
        tokenHash: hashearToken(token),
        expiresAt: calcularVencimiento(),
      });

      // HTTP 200 y no 401: el helper del cliente lanza ante cualquier !res.ok y
      // el catch se comeria el mfaToken. El discriminante va en el body.
      // Sin token ni user: no se crea sesion, no se setea cookie y no se filtra
      // el perfil antes del segundo factor.
      return jsonWithCors(req, {
        mfaRequired: true,
        mfaToken: token,
        expiresIn: Math.floor(TTL_MS / 1000),
        methods: ["totp", "backup_code"],
      });
    }

    // Sin 2FA la respuesta es identica a la de siempre. Es lo que garantiza que
    // los usuarios existentes y las versiones viejas de la app no se rompan.
    return jsonWithCors(req, await issueSession(record.id));
  } catch (err: unknown) {
    if (err instanceof z.ZodError) {
      return jsonWithCors(req, { error: "Datos inválidos" }, { status: 400 });
    }
    console.error("Error en /api/login:", err);
    return jsonWithCors(req, { error: "Error interno" }, { status: 500 });
  }
}

export async function GET(req: Request) {
  return jsonWithCors(req, { message: "Method Not Allowed" }, { status: 405 });
}

export function OPTIONS(req: Request) {
  return optionsResponse(req);
}
