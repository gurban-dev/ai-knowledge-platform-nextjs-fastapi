-- Baseline equivalent to Prisma migration history (init + governance + enterprise + google_identity)

-- >>> BEGIN 00000000000000_init
-- AI Knowledge Platform — initial schema
-- Requires the `vector` and `pg_trgm` extensions (created by docker init / CI step).

CREATE EXTENSION IF NOT EXISTS "vector";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ------------------------------- Enums -------------------------------------
CREATE TYPE "Role" AS ENUM ('OWNER', 'ADMIN', 'MEMBER', 'VIEWER');
CREATE TYPE "OrganizationStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');
CREATE TYPE "UserStatus" AS ENUM ('ACTIVE', 'INVITED', 'DISABLED');
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'INVITED', 'REVOKED');
CREATE TYPE "ApiKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');
CREATE TYPE "DataSourceType" AS ENUM ('UPLOAD', 'GOOGLE_DRIVE', 'NOTION', 'CONFLUENCE', 'GITHUB', 'SLACK', 'WEB', 'DATABASE', 'API');
CREATE TYPE "DataSourceStatus" AS ENUM ('CONNECTED', 'SYNCING', 'ERROR', 'DISABLED');
CREATE TYPE "DocumentStatus" AS ENUM ('PENDING', 'PROCESSING', 'INDEXED', 'FAILED', 'ARCHIVED');
CREATE TYPE "JobType" AS ENUM ('INGEST_DOCUMENT', 'SYNC_SOURCE', 'REEMBED', 'EVALUATE');
CREATE TYPE "JobStatus" AS ENUM ('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED');
CREATE TYPE "MessageRole" AS ENUM ('USER', 'ASSISTANT', 'SYSTEM', 'TOOL');
CREATE TYPE "EvaluationStatus" AS ENUM ('PENDING', 'RUNNING', 'COMPLETED', 'FAILED');
CREATE TYPE "UsageKind" AS ENUM ('EMBEDDING', 'CHAT_COMPLETION', 'RERANK');

-- ---------------------------- organizations --------------------------------
CREATE TABLE "organizations" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "status" "OrganizationStatus" NOT NULL DEFAULT 'ACTIVE',
    "settings" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "organizations_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "organizations_slug_key" ON "organizations"("slug");
CREATE INDEX "organizations_status_idx" ON "organizations"("status");

-- -------------------------------- users ------------------------------------
CREATE TABLE "users" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "password_hash" TEXT,
    "name" TEXT NOT NULL,
    "status" "UserStatus" NOT NULL DEFAULT 'ACTIVE',
    "avatar_url" TEXT,
    "last_login_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "users_email_key" ON "users"("email");
CREATE INDEX "users_status_idx" ON "users"("status");

-- ----------------------------- memberships ---------------------------------
CREATE TABLE "memberships" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "memberships_organization_id_user_id_key" ON "memberships"("organization_id", "user_id");
CREATE INDEX "memberships_user_id_idx" ON "memberships"("user_id");
CREATE INDEX "memberships_organization_id_role_idx" ON "memberships"("organization_id", "role");

-- ------------------------------- sessions ----------------------------------
CREATE TABLE "sessions" (
    "id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "replaced_by_id" TEXT,
    "user_agent" TEXT,
    "ip_address" TEXT,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");
CREATE INDEX "sessions_user_id_idx" ON "sessions"("user_id");
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- ------------------------------- api_keys ----------------------------------
CREATE TABLE "api_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "key_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "status" "ApiKeyStatus" NOT NULL DEFAULT 'ACTIVE',
    "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "created_by_id" TEXT,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "api_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "api_keys_key_hash_key" ON "api_keys"("key_hash");
CREATE INDEX "api_keys_organization_id_status_idx" ON "api_keys"("organization_id", "status");

-- -------------------------------- invites ----------------------------------
CREATE TABLE "invites" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "token_hash" TEXT NOT NULL,
    "invited_by_id" TEXT,
    "accepted_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "invites_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "invites_token_hash_key" ON "invites"("token_hash");
CREATE UNIQUE INDEX "invites_organization_id_email_key" ON "invites"("organization_id", "email");

-- ----------------------------- data_sources --------------------------------
CREATE TABLE "data_sources" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "DataSourceType" NOT NULL,
    "name" TEXT NOT NULL,
    "status" "DataSourceStatus" NOT NULL DEFAULT 'CONNECTED',
    "config" JSONB NOT NULL DEFAULT '{}',
    "last_synced_at" TIMESTAMP(3),
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "data_sources_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "data_sources_organization_id_status_idx" ON "data_sources"("organization_id", "status");

-- ------------------------------ documents ----------------------------------
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "data_source_id" TEXT,
    "title" TEXT NOT NULL,
    "source_uri" TEXT,
    "mime_type" TEXT NOT NULL,
    "content_hash" TEXT NOT NULL,
    "status" "DocumentStatus" NOT NULL DEFAULT 'PENDING',
    "byte_size" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "error" TEXT,
    "indexed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "documents_organization_id_content_hash_key" ON "documents"("organization_id", "content_hash");
CREATE INDEX "documents_organization_id_status_idx" ON "documents"("organization_id", "status");
CREATE INDEX "documents_data_source_id_idx" ON "documents"("data_source_id");

-- --------------------------- document_chunks -------------------------------
CREATE TABLE "document_chunks" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_index" INTEGER NOT NULL,
    "content" TEXT NOT NULL,
    "token_count" INTEGER NOT NULL DEFAULT 0,
    "embedding" vector(1536),
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_chunks_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_chunks_document_id_chunk_index_key" ON "document_chunks"("document_id", "chunk_index");
CREATE INDEX "document_chunks_organization_id_idx" ON "document_chunks"("organization_id");
-- Lexical search support for hybrid retrieval.
CREATE INDEX "document_chunks_content_trgm_idx" ON "document_chunks" USING GIN ("content" gin_trgm_ops);
-- Approximate nearest-neighbour index for cosine similarity (HNSW).
CREATE INDEX "document_chunks_embedding_hnsw_idx" ON "document_chunks" USING hnsw ("embedding" vector_cosine_ops);

-- ---------------------------- conversations --------------------------------
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL DEFAULT 'New conversation',
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "conversations_organization_id_user_id_idx" ON "conversations"("organization_id", "user_id");
CREATE INDEX "conversations_user_id_updated_at_idx" ON "conversations"("user_id", "updated_at");

-- ------------------------------- messages ----------------------------------
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "prompt_tokens" INTEGER,
    "completion_tokens" INTEGER,
    "latency_ms" INTEGER,
    "model" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- ------------------------------- citations ---------------------------------
CREATE TABLE "citations" (
    "id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "chunk_id" TEXT,
    "score" DOUBLE PRECISION NOT NULL,
    "span_start" INTEGER,
    "span_end" INTEGER,
    "snippet" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "citations_message_id_idx" ON "citations"("message_id");
CREATE INDEX "citations_document_id_idx" ON "citations"("document_id");

-- ---------------------------- ingestion_jobs -------------------------------
CREATE TABLE "ingestion_jobs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "type" "JobType" NOT NULL,
    "status" "JobStatus" NOT NULL DEFAULT 'QUEUED',
    "queue_job_id" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "started_at" TIMESTAMP(3),
    "finished_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ingestion_jobs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "ingestion_jobs_organization_id_status_idx" ON "ingestion_jobs"("organization_id", "status");
CREATE INDEX "ingestion_jobs_type_status_idx" ON "ingestion_jobs"("type", "status");

-- ----------------------------- evaluations ---------------------------------
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'PENDING',
    "summary" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finished_at" TIMESTAMP(3),
    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "evaluations_organization_id_status_idx" ON "evaluations"("organization_id", "status");

-- ------------------------- evaluation_results ------------------------------
CREATE TABLE "evaluation_results" (
    "id" TEXT NOT NULL,
    "evaluation_id" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "expected" TEXT,
    "answer" TEXT NOT NULL,
    "scores" JSONB NOT NULL DEFAULT '{}',
    "hallucinated" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "evaluation_results_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "evaluation_results_evaluation_id_idx" ON "evaluation_results"("evaluation_id");

-- ----------------------------- usage_events --------------------------------
CREATE TABLE "usage_events" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "kind" "UsageKind" NOT NULL,
    "model" TEXT NOT NULL,
    "prompt_tokens" INTEGER NOT NULL DEFAULT 0,
    "completion_tokens" INTEGER NOT NULL DEFAULT 0,
    "total_tokens" INTEGER NOT NULL DEFAULT 0,
    "cost_micros" INTEGER NOT NULL DEFAULT 0,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "usage_events_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "usage_events_organization_id_created_at_idx" ON "usage_events"("organization_id", "created_at");
CREATE INDEX "usage_events_organization_id_kind_created_at_idx" ON "usage_events"("organization_id", "kind", "created_at");

-- ------------------------------ audit_logs ---------------------------------
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_user_id" TEXT,
    "action" TEXT NOT NULL,
    "resource_type" TEXT,
    "resource_id" TEXT,
    "ip_address" TEXT,
    "user_agent" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "audit_logs_organization_id_created_at_idx" ON "audit_logs"("organization_id", "created_at");
CREATE INDEX "audit_logs_organization_id_action_created_at_idx" ON "audit_logs"("organization_id", "action", "created_at");
CREATE INDEX "audit_logs_actor_user_id_idx" ON "audit_logs"("actor_user_id");

-- ----------------------------- Foreign keys --------------------------------
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "memberships" ADD CONSTRAINT "memberships_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "api_keys" ADD CONSTRAINT "api_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "invites" ADD CONSTRAINT "invites_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "data_sources" ADD CONSTRAINT "data_sources_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "documents" ADD CONSTRAINT "documents_data_source_id_fkey" FOREIGN KEY ("data_source_id") REFERENCES "data_sources"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "document_chunks" ADD CONSTRAINT "document_chunks_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "conversations" ADD CONSTRAINT "conversations_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "citations" ADD CONSTRAINT "citations_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ingestion_jobs" ADD CONSTRAINT "ingestion_jobs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "evaluation_results" ADD CONSTRAINT "evaluation_results_evaluation_id_fkey" FOREIGN KEY ("evaluation_id") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "usage_events" ADD CONSTRAINT "usage_events_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
-- >>> END 00000000000000_init

-- >>> BEGIN 20260719000000_governance_hardening
-- Governance & production-hardening migration
-- Adds: MFA, API-key hardening, encrypted connector secrets, embedding
-- provenance, BigInt cost/size columns, webhooks, answer feedback, idempotency,
-- and audit-log immutability enforcement.

-- ------------------------------- Enums -------------------------------------
CREATE TYPE "WebhookEndpointStatus" AS ENUM ('ACTIVE', 'DISABLED');
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'DEAD');
CREATE TYPE "FeedbackRating" AS ENUM ('UP', 'DOWN');
CREATE TYPE "FeedbackReason" AS ENUM ('INCORRECT', 'INCOMPLETE', 'OUTDATED', 'UNSAFE', 'OTHER');
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED');

-- ------------------------------- users -------------------------------------
ALTER TABLE "users"
  ADD COLUMN "mfa_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "mfa_secret" TEXT,
  ADD COLUMN "mfa_recovery_codes" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "mfa_verified_at" TIMESTAMP(3);

-- ------------------------------ api_keys -----------------------------------
ALTER TABLE "api_keys"
  ADD COLUMN "description" TEXT,
  ADD COLUMN "rate_limit_per_minute" INTEGER,
  ADD COLUMN "ip_allowlist" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "last_rotated_at" TIMESTAMP(3);

-- ---------------------------- data_sources ---------------------------------
ALTER TABLE "data_sources"
  ADD COLUMN "secret_ciphertext" TEXT,
  ADD COLUMN "sync_cursor" TEXT;

-- ------------------------------ documents ----------------------------------
ALTER TABLE "documents"
  ALTER COLUMN "byte_size" SET DATA TYPE BIGINT USING "byte_size"::BIGINT;

-- --------------------------- document_chunks -------------------------------
ALTER TABLE "document_chunks"
  ADD COLUMN "embedding_model" TEXT,
  ADD COLUMN "embedding_version" INTEGER NOT NULL DEFAULT 1;

-- ----------------------------- usage_events --------------------------------
ALTER TABLE "usage_events"
  ADD COLUMN "user_id" TEXT,
  ALTER COLUMN "total_tokens" SET DATA TYPE BIGINT USING "total_tokens"::BIGINT,
  ALTER COLUMN "cost_micros" SET DATA TYPE BIGINT USING "cost_micros"::BIGINT;

-- --------------------------- webhook_endpoints -----------------------------
CREATE TABLE "webhook_endpoints" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "secret_ciphertext" TEXT NOT NULL,
    "events" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "status" "WebhookEndpointStatus" NOT NULL DEFAULT 'ACTIVE',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_endpoints_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_endpoints_organization_id_status_idx" ON "webhook_endpoints"("organization_id", "status");

-- --------------------------- webhook_deliveries ----------------------------
CREATE TABLE "webhook_deliveries" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "endpoint_id" TEXT NOT NULL,
    "event_type" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "response_status" INTEGER,
    "last_error" TEXT,
    "next_attempt_at" TIMESTAMP(3),
    "delivered_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "webhook_deliveries_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "webhook_deliveries_organization_id_status_idx" ON "webhook_deliveries"("organization_id", "status");
CREATE INDEX "webhook_deliveries_status_next_attempt_at_idx" ON "webhook_deliveries"("status", "next_attempt_at");

-- ---------------------------- message_feedback -----------------------------
CREATE TABLE "message_feedback" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "rating" "FeedbackRating" NOT NULL,
    "reason" "FeedbackReason",
    "comment" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "message_feedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "message_feedback_message_id_user_id_key" ON "message_feedback"("message_id", "user_id");
CREATE INDEX "message_feedback_organization_id_rating_created_at_idx" ON "message_feedback"("organization_id", "rating", "created_at");

-- ---------------------------- idempotency_keys -----------------------------
CREATE TABLE "idempotency_keys" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "response_status" INTEGER,
    "response_body" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "idempotency_keys_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "idempotency_keys_organization_id_key_key" ON "idempotency_keys"("organization_id", "key");
CREATE INDEX "idempotency_keys_expires_at_idx" ON "idempotency_keys"("expires_at");

-- ----------------------------- Foreign keys --------------------------------
ALTER TABLE "webhook_endpoints" ADD CONSTRAINT "webhook_endpoints_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "webhook_deliveries" ADD CONSTRAINT "webhook_deliveries_endpoint_id_fkey" FOREIGN KEY ("endpoint_id") REFERENCES "webhook_endpoints"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "message_feedback" ADD CONSTRAINT "message_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -------------------- Audit-log immutability (WORM) ------------------------
-- Compliance requires a tamper-evident audit trail. Enforce append-only at the
-- database so an application bug (or a compromised app credential) cannot alter
-- or delete history. INSERTs remain allowed.
CREATE OR REPLACE FUNCTION "akp_prevent_audit_mutation"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "audit_logs_no_update"
  BEFORE UPDATE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "akp_prevent_audit_mutation"();

CREATE TRIGGER "audit_logs_no_delete"
  BEFORE DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION "akp_prevent_audit_mutation"();
-- >>> END 20260719000000_governance_hardening

-- >>> BEGIN 20260719120000_enterprise_platform
-- Enterprise platform expansion: document ACL, teams, collections, prompts,
-- object storage, SSO/SCIM, billing/budgets, MCP tool audit, and Postgres RLS
-- as defense-in-depth for multi-tenant isolation.

-- ------------------------------- Enums -------------------------------------
CREATE TYPE "AclSubjectType" AS ENUM ('USER', 'TEAM', 'ROLE');
CREATE TYPE "AclPermission" AS ENUM ('READ', 'WRITE', 'ADMIN');
CREATE TYPE "CollectionVisibility" AS ENUM ('PRIVATE', 'TEAM', 'ORGANIZATION');
CREATE TYPE "SsoProvider" AS ENUM ('OIDC', 'SAML');
CREATE TYPE "SubscriptionStatus" AS ENUM ('TRIALING', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED');
CREATE TYPE "ToolSideEffect" AS ENUM ('READ', 'WRITE', 'DESTRUCTIVE');
CREATE TYPE "ToolInvocationStatus" AS ENUM ('SUCCEEDED', 'FAILED', 'DENIED');

-- ------------------------------ documents ----------------------------------
ALTER TABLE "documents"
  ADD COLUMN "stored_object_id" TEXT,
  ADD COLUMN "chunking_strategy" TEXT NOT NULL DEFAULT 'recursive-v1',
  ADD COLUMN "deleted_at" TIMESTAMP(3),
  ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

CREATE INDEX "documents_organization_id_deleted_at_idx" ON "documents"("organization_id", "deleted_at");

-- -------------------------- document_versions ------------------------------
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "content_hash" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL DEFAULT 0,
    "stored_object_id" TEXT,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_versions_document_id_version_key" ON "document_versions"("document_id", "version");
CREATE INDEX "document_versions_organization_id_document_id_idx" ON "document_versions"("organization_id", "document_id");

-- ----------------------------- document_acls -------------------------------
CREATE TABLE "document_acls" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "subject_type" "AclSubjectType" NOT NULL,
    "subject_id" TEXT NOT NULL,
    "permission" "AclPermission" NOT NULL DEFAULT 'READ',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "document_acls_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "document_acls_document_id_subject_type_subject_id_key" ON "document_acls"("document_id", "subject_type", "subject_id");
CREATE INDEX "document_acls_organization_id_subject_type_subject_id_idx" ON "document_acls"("organization_id", "subject_type", "subject_id");

-- --------------------------------- teams -----------------------------------
CREATE TABLE "teams" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "teams_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "teams_organization_id_slug_key" ON "teams"("organization_id", "slug");
CREATE INDEX "teams_organization_id_idx" ON "teams"("organization_id");

CREATE TABLE "team_memberships" (
    "id" TEXT NOT NULL,
    "team_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "role" "Role" NOT NULL DEFAULT 'MEMBER',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "team_memberships_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "team_memberships_team_id_user_id_key" ON "team_memberships"("team_id", "user_id");
CREATE INDEX "team_memberships_user_id_idx" ON "team_memberships"("user_id");

-- ------------------------------ collections --------------------------------
CREATE TABLE "collections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "team_id" TEXT,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "visibility" "CollectionVisibility" NOT NULL DEFAULT 'ORGANIZATION',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "collections_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collections_organization_id_slug_key" ON "collections"("organization_id", "slug");
CREATE INDEX "collections_organization_id_idx" ON "collections"("organization_id");

CREATE TABLE "collection_documents" (
    "id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "document_id" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "collection_documents_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "collection_documents_collection_id_document_id_key" ON "collection_documents"("collection_id", "document_id");
CREATE INDEX "collection_documents_document_id_idx" ON "collection_documents"("document_id");

-- --------------------------- prompt_templates ------------------------------
CREATE TABLE "prompt_templates" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "system_prompt" TEXT NOT NULL,
    "user_prompt_tpl" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "metadata" JSONB NOT NULL DEFAULT '{}',
    "created_by_id" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "prompt_templates_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "prompt_templates_organization_id_slug_version_key" ON "prompt_templates"("organization_id", "slug", "version");
CREATE INDEX "prompt_templates_organization_id_slug_is_active_idx" ON "prompt_templates"("organization_id", "slug", "is_active");

-- ---------------------------- stored_objects -------------------------------
CREATE TABLE "stored_objects" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "storage_key" TEXT NOT NULL,
    "bucket" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "byte_size" BIGINT NOT NULL DEFAULT 0,
    "content_hash" TEXT NOT NULL,
    "encrypted" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deleted_at" TIMESTAMP(3),
    CONSTRAINT "stored_objects_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "stored_objects_organization_id_storage_key_key" ON "stored_objects"("organization_id", "storage_key");
CREATE INDEX "stored_objects_organization_id_content_hash_idx" ON "stored_objects"("organization_id", "content_hash");

ALTER TABLE "documents" ADD CONSTRAINT "documents_stored_object_id_fkey"
  FOREIGN KEY ("stored_object_id") REFERENCES "stored_objects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ---------------------------- sso_connections ------------------------------
CREATE TABLE "sso_connections" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "provider" "SsoProvider" NOT NULL,
    "name" TEXT NOT NULL,
    "config" JSONB NOT NULL DEFAULT '{}',
    "secret_ciphertext" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "allowed_domains" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "sso_connections_organization_id_enabled_idx" ON "sso_connections"("organization_id", "enabled");

-- ------------------------------ scim_tokens --------------------------------
CREATE TABLE "scim_tokens" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token_hash" TEXT NOT NULL,
    "prefix" TEXT NOT NULL,
    "last_used_at" TIMESTAMP(3),
    "expires_at" TIMESTAMP(3),
    "revoked_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "scim_tokens_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "scim_tokens_token_hash_key" ON "scim_tokens"("token_hash");
CREATE INDEX "scim_tokens_organization_id_idx" ON "scim_tokens"("organization_id");

-- ----------------------------- subscriptions -------------------------------
CREATE TABLE "subscriptions" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "plan" TEXT NOT NULL DEFAULT 'starter',
    "status" "SubscriptionStatus" NOT NULL DEFAULT 'TRIALING',
    "external_customer_id" TEXT,
    "external_subscription_id" TEXT,
    "max_documents" INTEGER NOT NULL DEFAULT 1000,
    "max_members" INTEGER NOT NULL DEFAULT 25,
    "max_api_keys" INTEGER NOT NULL DEFAULT 10,
    "monthly_budget_micros" BIGINT,
    "current_period_start" TIMESTAMP(3) NOT NULL,
    "current_period_end" TIMESTAMP(3) NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "subscriptions_organization_id_key" ON "subscriptions"("organization_id");

-- ----------------------------- budget_periods ------------------------------
CREATE TABLE "budget_periods" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "spent_micros" BIGINT NOT NULL DEFAULT 0,
    "budget_micros" BIGINT,
    "alerted_at" TIMESTAMP(3),
    "hard_stopped_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "budget_periods_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "budget_periods_organization_id_period_key" ON "budget_periods"("organization_id", "period");

-- --------------------------- tool_invocations ------------------------------
CREATE TABLE "tool_invocations" (
    "id" TEXT NOT NULL,
    "organization_id" TEXT NOT NULL,
    "actor_id" TEXT NOT NULL,
    "tool_name" TEXT NOT NULL,
    "side_effect" "ToolSideEffect" NOT NULL,
    "status" "ToolInvocationStatus" NOT NULL DEFAULT 'SUCCEEDED',
    "arguments" JSONB NOT NULL DEFAULT '{}',
    "result_summary" TEXT,
    "latency_ms" INTEGER NOT NULL DEFAULT 0,
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "tool_invocations_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "tool_invocations_organization_id_created_at_idx" ON "tool_invocations"("organization_id", "created_at");
CREATE INDEX "tool_invocations_organization_id_tool_name_created_at_idx" ON "tool_invocations"("organization_id", "tool_name", "created_at");

-- ----------------------------- Foreign keys --------------------------------
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_acls" ADD CONSTRAINT "document_acls_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "document_acls" ADD CONSTRAINT "document_acls_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "teams" ADD CONSTRAINT "teams_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "team_memberships" ADD CONSTRAINT "team_memberships_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collections" ADD CONSTRAINT "collections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collections" ADD CONSTRAINT "collections_team_id_fkey" FOREIGN KEY ("team_id") REFERENCES "teams"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "collection_documents" ADD CONSTRAINT "collection_documents_collection_id_fkey" FOREIGN KEY ("collection_id") REFERENCES "collections"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "collection_documents" ADD CONSTRAINT "collection_documents_document_id_fkey" FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "prompt_templates" ADD CONSTRAINT "prompt_templates_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "stored_objects" ADD CONSTRAINT "stored_objects_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "sso_connections" ADD CONSTRAINT "sso_connections_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "scim_tokens" ADD CONSTRAINT "scim_tokens_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "budget_periods" ADD CONSTRAINT "budget_periods_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "tool_invocations" ADD CONSTRAINT "tool_invocations_organization_id_fkey" FOREIGN KEY ("organization_id") REFERENCES "organizations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- -------------------- Row-Level Security (defense-in-depth) ----------------
-- Application sets `SET LOCAL app.current_org_id = '<orgId>'` per transaction.
-- Policies allow rows where organization_id matches the session GUC, or when
-- the GUC is unset (migration/admin scripts and the bootstrap path).

CREATE OR REPLACE FUNCTION akp_current_org_id() RETURNS text AS $$
  SELECT nullif(current_setting('app.current_org_id', true), '');
$$ LANGUAGE sql STABLE;

DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'documents',
    'document_chunks',
    'document_acls',
    'document_versions',
    'data_sources',
    'conversations',
    'messages',
    'ingestion_jobs',
    'evaluations',
    'usage_events',
    'audit_logs',
    'api_keys',
    'invites',
    'memberships',
    'webhook_endpoints',
    'webhook_deliveries',
    'message_feedback',
    'idempotency_keys',
    'teams',
    'collections',
    'prompt_templates',
    'stored_objects',
    'sso_connections',
    'scim_tokens',
    'subscriptions',
    'budget_periods',
    'tool_invocations'
  ]
  LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
    EXECUTE format(
      'CREATE POLICY %I ON %I
         USING (akp_current_org_id() IS NULL OR organization_id = akp_current_org_id())
         WITH CHECK (akp_current_org_id() IS NULL OR organization_id = akp_current_org_id())',
      tbl || '_tenant_isolation',
      tbl
    );
  END LOOP;
END $$;-- >>> END 20260719120000_enterprise_platform

-- >>> BEGIN 20260720000000_google_identity
-- Link user accounts to a Google OAuth identity.
-- Nullable: password and other federated accounts leave it NULL.
-- Unique: a given Google subject maps to exactly one user.
ALTER TABLE "users" ADD COLUMN "google_sub" TEXT;

CREATE UNIQUE INDEX "users_google_sub_key" ON "users"("google_sub");
-- >>> END 20260720000000_google_identity
