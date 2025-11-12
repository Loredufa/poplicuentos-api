CREATE TABLE IF NOT EXISTS "favorites" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"title" text NOT NULL,
	"story" text NOT NULL,
	"age_range" text,
	"skill" text,
	"tone" text,
	"minutes" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp DEFAULT now()
);
--> statement-breakpoint
DO $$
BEGIN
	IF NOT EXISTS (
		SELECT 1
		FROM information_schema.table_constraints
		WHERE constraint_name = 'favorites_user_id_users_id_fk'
	) THEN
		ALTER TABLE "favorites"
			ADD CONSTRAINT "favorites_user_id_users_id_fk"
			FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE;
	END IF;
END $$;
