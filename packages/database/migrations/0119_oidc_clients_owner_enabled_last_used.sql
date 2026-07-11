ALTER TABLE "oidc_clients" ADD COLUMN IF NOT EXISTS "owner_id" text;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN IF NOT EXISTS "enabled" boolean DEFAULT true NOT NULL;--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD COLUMN IF NOT EXISTS "last_used_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "oidc_clients" DROP CONSTRAINT IF EXISTS "oidc_clients_owner_id_users_id_fk";--> statement-breakpoint
ALTER TABLE "oidc_clients" ADD CONSTRAINT "oidc_clients_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "oidc_clients_owner_id_idx" ON "oidc_clients" USING btree ("owner_id");