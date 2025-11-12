// drizzle.config.ts
import * as dotenv from "dotenv";
import type { Config } from "drizzle-kit";

// fuerza a leer .env.local cuando corre el CLI
dotenv.config({ path: ".env.local" });

export default {
  schema: "./db/schema.ts",   // o "./src/db/schema.ts" si usas src
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.DATABASE_URL!, // viene de .env.local
  },
} satisfies Config;

