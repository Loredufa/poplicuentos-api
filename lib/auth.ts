import { cookies } from "next/headers";
import { DrizzlePostgreSQLAdapter } from "@lucia-auth/adapter-drizzle";
import { Lucia } from "lucia";
import { sessions, users } from "../db/schema";
import { db } from "../lib/db";
import { esDeploy } from "./entorno";

export const auth = new Lucia(
  new DrizzlePostgreSQLAdapter(db, sessions, users),
  {
    sessionCookie: {
      name: process.env.AUTH_COOKIE_NAME || "auth_session",
      attributes: {
        sameSite: "lax",
        // esDeploy() y no NODE_ENV a secas: NODE_ENV se puede pisar a mano en
        // el panel de Vercel, y un "development" cargado por error dejaria la
        // cookie de sesion viajando sin el flag Secure, o sea por HTTP plano.
        secure: esDeploy(),
        path: "/",
        // httpOnly es implícito en Lucia v3 (no se configura)
      },
    },
    getUserAttributes: (user) => ({ email: user.email }),
  }
);

export async function validateRequest(req: Request) {
  const cookieStore = await cookies();
  const cookieSessionId = cookieStore.get(auth.sessionCookieName)?.value ?? null;
  const bearer = req.headers.get("authorization");
  const bearerSessionId = bearer ? auth.readBearerToken(bearer) : null;
  const sessionId = bearerSessionId ?? cookieSessionId;
  if (!sessionId) {
    return { user: null, session: null } as const;
  }
  try {
    return await auth.validateSession(sessionId);
  } catch {
    return { user: null, session: null } as const;
  }
}

// Tipos para TS (Lucia v3)
declare module "lucia" {
  interface Register {
    Lucia: typeof auth;
    DatabaseUserAttributes: {
      email: string;
    };
  }
}
