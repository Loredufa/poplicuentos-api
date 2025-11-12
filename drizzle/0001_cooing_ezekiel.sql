ALTER TABLE "sessions" ALTER COLUMN "expires_at" SET DATA TYPE timestamp with time zone;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "created_at" timestamp DEFAULT now();--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "email" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "country" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "phone" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "language" text NOT NULL;--> statement-breakpoint
ALTER TABLE "profiles" ADD COLUMN "password" text NOT NULL;