-- Enable pgvector extension for embedding columns
CREATE EXTENSION IF NOT EXISTS vector;

-- CreateEnum
CREATE TYPE "SectionType" AS ENUM ('text', 'info', 'warning', 'success');

-- CreateEnum
CREATE TYPE "UpdateType" AS ENUM ('minor', 'major', 'add', 'delete');

-- CreateEnum
CREATE TYPE "UpdateStatus" AS ENUM ('pending', 'approved', 'rejected', 'auto_applied');

-- CreateEnum
CREATE TYPE "ActionType" AS ENUM ('approved', 'rejected', 'auto_applied');

-- CreateEnum
CREATE TYPE "MessageSource" AS ENUM ('zulipchat', 'telegram');

-- CreateEnum
CREATE TYPE "VersionOp" AS ENUM ('add', 'edit', 'delete', 'rollback');

-- CreateEnum
CREATE TYPE "ProcessingStatus" AS ENUM ('PENDING', 'PROCESSING', 'COMPLETED', 'FAILED');

-- CreateEnum
CREATE TYPE "ProposalStatus" AS ENUM ('pending', 'approved', 'ignored');

-- CreateEnum
CREATE TYPE "BatchStatus" AS ENUM ('draft', 'submitted', 'merged', 'closed');

-- CreateTable
CREATE TABLE "documentation_sections" (
    "id" UUID NOT NULL,
    "sectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "level" INTEGER,
    "type" "SectionType",
    "orderIndex" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "documentation_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pending_updates" (
    "id" UUID NOT NULL,
    "sectionId" TEXT NOT NULL,
    "type" "UpdateType" NOT NULL,
    "summary" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "status" "UpdateStatus" NOT NULL DEFAULT 'pending',
    "diffBefore" TEXT,
    "diffAfter" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),
    "reviewedBy" TEXT,

    CONSTRAINT "pending_updates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "update_history" (
    "id" UUID NOT NULL,
    "updateId" UUID NOT NULL,
    "action" "ActionType" NOT NULL,
    "performedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "performedBy" TEXT,

    CONSTRAINT "update_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scraped_messages" (
    "id" UUID NOT NULL,
    "messageId" TEXT NOT NULL,
    "source" "MessageSource" NOT NULL,
    "channelName" TEXT NOT NULL,
    "topicName" TEXT,
    "senderEmail" TEXT,
    "senderName" TEXT,
    "content" TEXT NOT NULL,
    "messageTimestamp" TIMESTAMP(3) NOT NULL,
    "scrapedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "analyzed" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "scraped_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "scrape_metadata" (
    "id" UUID NOT NULL,
    "source" "MessageSource" NOT NULL,
    "channelName" TEXT NOT NULL,
    "lastMessageId" TEXT,
    "lastScrapeTimestamp" TIMESTAMP(3),
    "lastScrapeAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalMessagesFetched" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "scrape_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_versions" (
    "id" UUID NOT NULL,
    "sectionId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "level" INTEGER,
    "type" "SectionType",
    "orderIndex" INTEGER NOT NULL,
    "op" "VersionOp" NOT NULL,
    "parentVersionId" UUID,
    "fromUpdateId" UUID,
    "fromHistoryId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdBy" TEXT,

    CONSTRAINT "section_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_pages" (
    "id" SERIAL NOT NULL,
    "file_path" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "commit_hash" TEXT NOT NULL,
    "git_url" TEXT NOT NULL,
    "embedding" vector(768),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_pages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "git_sync_state" (
    "id" SERIAL NOT NULL,
    "git_url" TEXT NOT NULL,
    "branch" TEXT NOT NULL DEFAULT 'main',
    "last_commit_hash" TEXT,
    "last_sync_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "syncStatus" TEXT NOT NULL DEFAULT 'idle',
    "error_message" TEXT,

    CONSTRAINT "git_sync_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_index_cache" (
    "id" SERIAL NOT NULL,
    "commit_hash" TEXT NOT NULL,
    "config_hash" TEXT NOT NULL,
    "index_data" JSONB NOT NULL,
    "compact_index" TEXT NOT NULL,
    "generated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "doc_index_cache_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "stream_configs" (
    "id" SERIAL NOT NULL,
    "stream_id" TEXT NOT NULL,
    "adapter_type" TEXT NOT NULL,
    "config" JSONB NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "schedule" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "stream_configs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "import_watermarks" (
    "id" SERIAL NOT NULL,
    "stream_id" TEXT NOT NULL,
    "stream_type" TEXT NOT NULL,
    "resource_id" TEXT,
    "last_imported_time" TIMESTAMP(3),
    "last_imported_id" TEXT,
    "import_complete" BOOLEAN NOT NULL DEFAULT false,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "import_watermarks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processing_watermark" (
    "id" SERIAL NOT NULL,
    "stream_id" TEXT NOT NULL,
    "watermark_time" TIMESTAMP(3) NOT NULL,
    "last_processed_batch" TIMESTAMP(3),
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processing_watermark_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "unified_messages" (
    "id" SERIAL NOT NULL,
    "stream_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "author" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "channel" TEXT,
    "raw_data" JSONB NOT NULL,
    "metadata" JSONB,
    "embedding" vector(768),
    "processing_status" "ProcessingStatus" NOT NULL DEFAULT 'PENDING',
    "failure_count" INTEGER NOT NULL DEFAULT 0,
    "last_error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "unified_messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_classification" (
    "id" SERIAL NOT NULL,
    "message_id" INTEGER NOT NULL,
    "batch_id" TEXT,
    "conversation_id" TEXT,
    "category" TEXT NOT NULL,
    "doc_value_reason" TEXT NOT NULL,
    "suggested_doc_page" TEXT,
    "rag_search_criteria" JSONB,
    "model_used" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "message_classification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversation_rag_context" (
    "id" SERIAL NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "summary" VARCHAR(200),
    "retrieved_docs" JSONB NOT NULL,
    "total_tokens" INTEGER,
    "proposals_rejected" BOOLEAN,
    "rejection_reason" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "conversation_rag_context_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_proposals" (
    "id" SERIAL NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "batch_id" TEXT,
    "page" TEXT NOT NULL,
    "update_type" TEXT NOT NULL,
    "section" TEXT,
    "location" JSONB,
    "suggested_text" TEXT,
    "raw_suggested_text" TEXT,
    "reasoning" TEXT,
    "source_messages" JSONB,
    "status" "ProposalStatus" NOT NULL DEFAULT 'pending',
    "edited_text" TEXT,
    "edited_at" TIMESTAMP(3),
    "edited_by" TEXT,
    "admin_approved" BOOLEAN NOT NULL DEFAULT false,
    "admin_reviewed_at" TIMESTAMP(3),
    "admin_reviewed_by" TEXT,
    "discard_reason" TEXT,
    "model_used" TEXT,
    "warnings" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "pr_batch_id" INTEGER,
    "pr_application_status" TEXT,
    "pr_application_error" TEXT,
    "enrichment" JSONB,

    CONSTRAINT "doc_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "changeset_batches" (
    "id" SERIAL NOT NULL,
    "batch_id" TEXT NOT NULL,
    "status" "BatchStatus" NOT NULL DEFAULT 'draft',
    "pr_title" TEXT,
    "pr_body" TEXT,
    "pr_url" TEXT,
    "pr_number" INTEGER,
    "branch_name" TEXT,
    "total_proposals" INTEGER NOT NULL,
    "affected_files" JSONB NOT NULL,
    "target_repo" TEXT,
    "source_repo" TEXT,
    "base_branch" TEXT DEFAULT 'main',
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submitted_at" TIMESTAMP(3),
    "submitted_by" TEXT,

    CONSTRAINT "changeset_batches_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "batch_proposals" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "order_index" INTEGER NOT NULL,
    "added_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "batch_proposals_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_failures" (
    "id" SERIAL NOT NULL,
    "batch_id" INTEGER NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "failure_type" TEXT NOT NULL,
    "error_message" TEXT NOT NULL,
    "file_path" TEXT NOT NULL,
    "attempted_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_failures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_rulesets" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_rulesets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenant_prompt_overrides" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "prompt_key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenant_prompt_overrides_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ruleset_feedback" (
    "id" SERIAL NOT NULL,
    "tenant_id" TEXT NOT NULL,
    "proposal_id" INTEGER,
    "action_taken" TEXT NOT NULL,
    "feedback_text" TEXT NOT NULL,
    "use_for_improvement" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "processed_at" TIMESTAMP(3),

    CONSTRAINT "ruleset_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "proposal_review_logs" (
    "id" SERIAL NOT NULL,
    "proposal_id" INTEGER NOT NULL,
    "ruleset_version" TIMESTAMP(3) NOT NULL,
    "original_content" TEXT,
    "modifications_applied" JSONB,
    "rejected" BOOLEAN NOT NULL DEFAULT false,
    "rejection_reason" TEXT,
    "quality_flags" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "proposal_review_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pipeline_run_logs" (
    "id" SERIAL NOT NULL,
    "instance_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "pipeline_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'running',
    "input_messages" INTEGER NOT NULL,
    "steps" JSONB NOT NULL,
    "output_threads" INTEGER,
    "output_proposals" INTEGER,
    "total_duration_ms" INTEGER,
    "llm_calls" INTEGER,
    "llm_tokens_used" INTEGER,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completed_at" TIMESTAMP(3),

    CONSTRAINT "pipeline_run_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documentation_sections_sectionId_key" ON "documentation_sections"("sectionId");

-- CreateIndex
CREATE UNIQUE INDEX "scraped_messages_messageId_key" ON "scraped_messages"("messageId");

-- CreateIndex
CREATE UNIQUE INDEX "document_pages_file_path_commit_hash_key" ON "document_pages"("file_path", "commit_hash");

-- CreateIndex
CREATE UNIQUE INDEX "git_sync_state_git_url_key" ON "git_sync_state"("git_url");

-- CreateIndex
CREATE UNIQUE INDEX "doc_index_cache_commit_hash_config_hash_key" ON "doc_index_cache"("commit_hash", "config_hash");

-- CreateIndex
CREATE UNIQUE INDEX "stream_configs_stream_id_key" ON "stream_configs"("stream_id");

-- CreateIndex
CREATE INDEX "import_watermarks_stream_id_resource_id_idx" ON "import_watermarks"("stream_id", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "import_watermarks_stream_id_resource_id_key" ON "import_watermarks"("stream_id", "resource_id");

-- CreateIndex
CREATE UNIQUE INDEX "processing_watermark_stream_id_key" ON "processing_watermark"("stream_id");

-- CreateIndex
CREATE INDEX "unified_messages_timestamp_idx" ON "unified_messages"("timestamp" DESC);

-- CreateIndex
CREATE INDEX "unified_messages_processing_status_idx" ON "unified_messages"("processing_status");

-- CreateIndex
CREATE UNIQUE INDEX "unified_messages_stream_id_message_id_key" ON "unified_messages"("stream_id", "message_id");

-- CreateIndex
CREATE UNIQUE INDEX "message_classification_message_id_key" ON "message_classification"("message_id");

-- CreateIndex
CREATE INDEX "message_classification_batch_id_idx" ON "message_classification"("batch_id");

-- CreateIndex
CREATE INDEX "message_classification_conversation_id_idx" ON "message_classification"("conversation_id");

-- CreateIndex
CREATE UNIQUE INDEX "conversation_rag_context_conversation_id_key" ON "conversation_rag_context"("conversation_id");

-- CreateIndex
CREATE INDEX "conversation_rag_context_batch_id_idx" ON "conversation_rag_context"("batch_id");

-- CreateIndex
CREATE INDEX "doc_proposals_conversation_id_idx" ON "doc_proposals"("conversation_id");

-- CreateIndex
CREATE INDEX "doc_proposals_batch_id_idx" ON "doc_proposals"("batch_id");

-- CreateIndex
CREATE INDEX "doc_proposals_status_idx" ON "doc_proposals"("status");

-- CreateIndex
CREATE INDEX "doc_proposals_admin_approved_idx" ON "doc_proposals"("admin_approved");

-- CreateIndex
CREATE INDEX "doc_proposals_pr_batch_id_idx" ON "doc_proposals"("pr_batch_id");

-- CreateIndex
CREATE UNIQUE INDEX "changeset_batches_batch_id_key" ON "changeset_batches"("batch_id");

-- CreateIndex
CREATE INDEX "changeset_batches_status_idx" ON "changeset_batches"("status");

-- CreateIndex
CREATE INDEX "changeset_batches_submitted_at_idx" ON "changeset_batches"("submitted_at");

-- CreateIndex
CREATE INDEX "batch_proposals_batch_id_idx" ON "batch_proposals"("batch_id");

-- CreateIndex
CREATE INDEX "batch_proposals_proposal_id_idx" ON "batch_proposals"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "batch_proposals_batch_id_proposal_id_key" ON "batch_proposals"("batch_id", "proposal_id");

-- CreateIndex
CREATE INDEX "proposal_failures_batch_id_idx" ON "proposal_failures"("batch_id");

-- CreateIndex
CREATE INDEX "proposal_failures_proposal_id_idx" ON "proposal_failures"("proposal_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_rulesets_tenant_id_key" ON "tenant_rulesets"("tenant_id");

-- CreateIndex
CREATE INDEX "tenant_prompt_overrides_tenant_id_idx" ON "tenant_prompt_overrides"("tenant_id");

-- CreateIndex
CREATE UNIQUE INDEX "tenant_prompt_overrides_tenant_id_prompt_key_key" ON "tenant_prompt_overrides"("tenant_id", "prompt_key");

-- CreateIndex
CREATE INDEX "ruleset_feedback_tenant_id_idx" ON "ruleset_feedback"("tenant_id");

-- CreateIndex
CREATE INDEX "ruleset_feedback_proposal_id_idx" ON "ruleset_feedback"("proposal_id");

-- CreateIndex
CREATE INDEX "ruleset_feedback_processed_at_idx" ON "ruleset_feedback"("processed_at");

-- CreateIndex
CREATE INDEX "ruleset_feedback_use_for_improvement_idx" ON "ruleset_feedback"("use_for_improvement");

-- CreateIndex
CREATE UNIQUE INDEX "proposal_review_logs_proposal_id_key" ON "proposal_review_logs"("proposal_id");

-- CreateIndex
CREATE INDEX "proposal_review_logs_proposal_id_idx" ON "proposal_review_logs"("proposal_id");

-- CreateIndex
CREATE INDEX "pipeline_run_logs_instance_id_idx" ON "pipeline_run_logs"("instance_id");

-- CreateIndex
CREATE INDEX "pipeline_run_logs_batch_id_idx" ON "pipeline_run_logs"("batch_id");

-- CreateIndex
CREATE INDEX "pipeline_run_logs_created_at_idx" ON "pipeline_run_logs"("created_at");

-- CreateIndex
CREATE INDEX "pipeline_run_logs_status_idx" ON "pipeline_run_logs"("status");

-- AddForeignKey
ALTER TABLE "update_history" ADD CONSTRAINT "update_history_updateId_fkey" FOREIGN KEY ("updateId") REFERENCES "pending_updates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_fromUpdateId_fkey" FOREIGN KEY ("fromUpdateId") REFERENCES "pending_updates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_versions" ADD CONSTRAINT "section_versions_fromHistoryId_fkey" FOREIGN KEY ("fromHistoryId") REFERENCES "update_history"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "import_watermarks" ADD CONSTRAINT "import_watermarks_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "stream_configs"("stream_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "unified_messages" ADD CONSTRAINT "unified_messages_stream_id_fkey" FOREIGN KEY ("stream_id") REFERENCES "stream_configs"("stream_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "message_classification" ADD CONSTRAINT "message_classification_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "unified_messages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doc_proposals" ADD CONSTRAINT "doc_proposals_pr_batch_id_fkey" FOREIGN KEY ("pr_batch_id") REFERENCES "changeset_batches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_proposals" ADD CONSTRAINT "batch_proposals_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "changeset_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "batch_proposals" ADD CONSTRAINT "batch_proposals_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "doc_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_failures" ADD CONSTRAINT "proposal_failures_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "changeset_batches"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_failures" ADD CONSTRAINT "proposal_failures_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "doc_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleset_feedback" ADD CONSTRAINT "ruleset_feedback_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenant_rulesets"("tenant_id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ruleset_feedback" ADD CONSTRAINT "ruleset_feedback_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "doc_proposals"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "proposal_review_logs" ADD CONSTRAINT "proposal_review_logs_proposal_id_fkey" FOREIGN KEY ("proposal_id") REFERENCES "doc_proposals"("id") ON DELETE CASCADE ON UPDATE CASCADE;

