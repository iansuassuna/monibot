CREATE EXTENSION IF NOT EXISTS vector;--> statement-breakpoint
CREATE TYPE "public"."user_role" AS ENUM('student', 'researcher');--> statement-breakpoint
CREATE TYPE "public"."knowledge_category" AS ENUM('lecture_slides', 'exercise_list', 'past_exam', 'code_reference');--> statement-breakpoint
CREATE TYPE "public"."knowledge_document_status" AS ENUM('processing', 'indexed', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tutoring_session_status" AS ENUM('scheduled', 'active', 'ended');--> statement-breakpoint
CREATE TABLE "account" (
	"id" text PRIMARY KEY NOT NULL,
	"account_id" text NOT NULL,
	"provider_id" text NOT NULL,
	"user_id" text NOT NULL,
	"access_token" text,
	"refresh_token" text,
	"id_token" text,
	"access_token_expires_at" timestamp with time zone,
	"refresh_token_expires_at" timestamp with time zone,
	"scope" text,
	"password" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session" (
	"id" text PRIMARY KEY NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"token" text NOT NULL,
	"ip_address" text,
	"user_agent" text,
	"user_id" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "session_token_unique" UNIQUE("token")
);
--> statement-breakpoint
CREATE TABLE "user" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"email" text NOT NULL,
	"email_verified" boolean DEFAULT false NOT NULL,
	"image" text,
	"role" "user_role" DEFAULT 'student' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "user_email_unique" UNIQUE("email")
);
--> statement-breakpoint
CREATE TABLE "verification" (
	"id" text PRIMARY KEY NOT NULL,
	"identifier" text NOT NULL,
	"value" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_evaluations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" text,
	"sus_answers" jsonb NOT NULL,
	"sus_calculated_score" real NOT NULL,
	"tam_perceived_usefulness" real NOT NULL,
	"tam_perceived_ease_of_use" real NOT NULL,
	"avatar_naturalness_score" real,
	"comments" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "knowledge_chunks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_id" uuid NOT NULL,
	"chunk_index" integer NOT NULL,
	"content" text NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"embedding" vector(768) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "knowledge_chunks_document_chunk_unique" UNIQUE("document_id","chunk_index")
);
--> statement-breakpoint
CREATE TABLE "knowledge_documents" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"category" "knowledge_category" NOT NULL,
	"course" text DEFAULT 'Fundamentos de Programação' NOT NULL,
	"raw_text" text NOT NULL,
	"status" "knowledge_document_status" DEFAULT 'processing' NOT NULL,
	"chunk_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "interaction_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"student_transcript" text NOT NULL,
	"retrieved_chunks" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"agent_response" text NOT NULL,
	"stt_latency_ms" integer NOT NULL,
	"rag_latency_ms" integer NOT NULL,
	"llm_ttft_ms" integer NOT NULL,
	"llm_total_latency_ms" integer NOT NULL,
	"tts_latency_ms" integer NOT NULL,
	"total_e2e_latency_ms" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tutoring_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"title" text NOT NULL,
	"matrix_room_id" text,
	"livekit_room_name" text NOT NULL,
	"rag_enabled" boolean DEFAULT true NOT NULL,
	"avatar_enabled" boolean DEFAULT true NOT NULL,
	"llm_model" text DEFAULT 'llama3.1:8b' NOT NULL,
	"status" "tutoring_session_status" DEFAULT 'scheduled' NOT NULL,
	"started_at" timestamp with time zone,
	"ended_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "tutoring_sessions_livekit_room_name_unique" UNIQUE("livekit_room_name")
);
--> statement-breakpoint
ALTER TABLE "account" ADD CONSTRAINT "account_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session" ADD CONSTRAINT "session_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_evaluations" ADD CONSTRAINT "user_evaluations_session_id_tutoring_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutoring_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_evaluations" ADD CONSTRAINT "user_evaluations_user_id_user_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_document_id_knowledge_documents_id_fk" FOREIGN KEY ("document_id") REFERENCES "public"."knowledge_documents"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "interaction_logs" ADD CONSTRAINT "interaction_logs_session_id_tutoring_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."tutoring_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "account_user_id_idx" ON "account" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "session_user_id_idx" ON "session" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "verification_identifier_idx" ON "verification" USING btree ("identifier");--> statement-breakpoint
CREATE INDEX "user_evaluations_session_id_idx" ON "user_evaluations" USING btree ("session_id");--> statement-breakpoint
CREATE INDEX "knowledge_chunks_embedding_hnsw_idx" ON "knowledge_chunks" USING hnsw ("embedding" vector_cosine_ops);--> statement-breakpoint
CREATE INDEX "knowledge_documents_category_idx" ON "knowledge_documents" USING btree ("category");--> statement-breakpoint
CREATE INDEX "interaction_logs_session_id_idx" ON "interaction_logs" USING btree ("session_id","created_at");--> statement-breakpoint
CREATE INDEX "tutoring_sessions_matrix_room_id_idx" ON "tutoring_sessions" USING btree ("matrix_room_id");--> statement-breakpoint
CREATE INDEX "tutoring_sessions_condition_idx" ON "tutoring_sessions" USING btree ("rag_enabled","avatar_enabled");