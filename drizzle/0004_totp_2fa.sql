-- 2FA (TOTP) + limpieza de tablas muertas.
--
-- Editado a mano despues de `drizzle-kit generate` para agregar IF NOT EXISTS
-- (drizzle-kit dejo de emitirlo por defecto) y los DROP de abajo. Editar este
-- .sql no desincroniza nada: los snapshots se computan desde db/schema.ts, no
-- desde el SQL. Es el mismo criterio que ya se uso en 0002 y 0003.

-- favorites y story_narrations existen en la base desde 0002, estan vacias
-- (0 filas, verificado) y no las referencia ningun archivo del repo. Al no
-- estar en schema.ts quedaban invisibles para drizzle: un `push` las habria
-- borrado sin aviso en algun momento. Mejor explicito que por accidente.
DROP TABLE IF EXISTS "favorites";--> statement-breakpoint
DROP TABLE IF EXISTS "story_narrations";--> statement-breakpoint

CREATE TABLE IF NOT EXISTS "auth_throttle" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"subject_key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "login_challenges" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"consumed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_backup_codes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"batch_id" uuid NOT NULL,
	"code_hash" text NOT NULL,
	"used_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "user_totp" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"secret_encrypted" text NOT NULL,
	"key_version" integer DEFAULT 1 NOT NULL,
	"status" text DEFAULT 'pending' NOT NULL,
	"last_used_step" bigint,
	"confirmed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "auth_throttle_lookup_idx" ON "auth_throttle" USING btree ("scope","subject_key","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "login_challenges_token_hash_idx" ON "login_challenges" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "login_challenges_expires_at_idx" ON "login_challenges" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "user_backup_codes_unused_idx" ON "user_backup_codes" USING btree ("user_id") WHERE "user_backup_codes"."used_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "user_totp_user_id_idx" ON "user_totp" USING btree ("user_id");
