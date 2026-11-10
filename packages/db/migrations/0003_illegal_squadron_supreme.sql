CREATE TYPE "public"."call_client" AS ENUM('livekit_web', 'element_call');--> statement-breakpoint
ALTER TABLE "tutoring_sessions" ADD COLUMN "call_client" "call_client" DEFAULT 'livekit_web' NOT NULL;--> statement-breakpoint
-- Backfill: sessions linked to a Matrix room ran in Element Call (until 2026-11-10 only through a
-- pasted call link); the rest in the web app's direct LiveKit room. Only the new column changes.
UPDATE "tutoring_sessions" SET "call_client" = 'element_call' WHERE "matrix_room_id" IS NOT NULL;
