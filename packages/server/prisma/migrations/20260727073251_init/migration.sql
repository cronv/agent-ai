-- CreateEnum
CREATE TYPE "FeedFormat" AS ENUM ('yandex', 'cian', 'custom');

-- CreateEnum
CREATE TYPE "FeedRunStatus" AS ENUM ('ok', 'error', 'running');

-- CreateEnum
CREATE TYPE "KnowledgeDocStatus" AS ENUM ('pending', 'ready', 'error');

-- CreateEnum
CREATE TYPE "MessageRole" AS ENUM ('user', 'assistant');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('new', 'in_progress', 'reached', 'rejected');

-- CreateTable
CREATE TABLE "projects" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "developer" TEXT,
    "district" TEXT,
    "metro" TEXT,
    "metro_distance_min" INTEGER,
    "address" TEXT,
    "deadline" DATE,
    "finishing" TEXT,
    "description" TEXT,
    "url" TEXT,
    "image_url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feeds" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url" TEXT NOT NULL,
    "format" "FeedFormat" NOT NULL DEFAULT 'yandex',
    "field_mapping" JSONB,
    "schedule_cron" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "last_run_at" TIMESTAMP(3),
    "last_status" "FeedRunStatus",
    "last_error" TEXT,
    "last_count" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "feeds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "apartments" (
    "id" TEXT NOT NULL,
    "feed_id" TEXT NOT NULL,
    "project_id" TEXT,
    "external_id" TEXT NOT NULL,
    "rooms" INTEGER,
    "area" DOUBLE PRECISION,
    "living_area" DOUBLE PRECISION,
    "kitchen_area" DOUBLE PRECISION,
    "floor" INTEGER,
    "floors_total" INTEGER,
    "price" DOUBLE PRECISION NOT NULL,
    "price_per_m2" DOUBLE PRECISION,
    "building" TEXT,
    "section" TEXT,
    "finishing" TEXT,
    "deadline" DATE,
    "plan_image_url" TEXT,
    "url" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "raw" JSONB,
    "synced_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "apartments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_docs" (
    "id" TEXT NOT NULL,
    "project_id" TEXT,
    "filename" TEXT NOT NULL,
    "mime_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "char_count" INTEGER NOT NULL DEFAULT 0,
    "status" "KnowledgeDocStatus" NOT NULL DEFAULT 'pending',
    "error" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "knowledge_docs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "knowledge_chunks" (
    "id" TEXT NOT NULL,
    "doc_id" TEXT NOT NULL,
    "project_id" TEXT,
    "content" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "tsv" tsvector,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "knowledge_chunks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "conversations" (
    "id" TEXT NOT NULL,
    "session_id" TEXT NOT NULL,
    "page_url" TEXT,
    "referrer" TEXT,
    "utm" JSONB,
    "user_agent" TEXT,
    "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "last_message_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "message_count" INTEGER NOT NULL DEFAULT 0,
    "tokens_in" INTEGER NOT NULL DEFAULT 0,
    "tokens_out" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "conversations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "messages" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT NOT NULL,
    "role" "MessageRole" NOT NULL,
    "content" TEXT NOT NULL,
    "apartments" JSONB,
    "tool_calls" JSONB,
    "model" TEXT,
    "tokens_in" INTEGER,
    "tokens_out" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "messages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "leads" (
    "id" TEXT NOT NULL,
    "conversation_id" TEXT,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "comment" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'new',
    "consent_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "leads_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "settings_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE UNIQUE INDEX "projects_slug_key" ON "projects"("slug");

-- CreateIndex
CREATE INDEX "projects_is_active_idx" ON "projects"("is_active");

-- CreateIndex
CREATE INDEX "projects_district_idx" ON "projects"("district");

-- CreateIndex
CREATE INDEX "projects_metro_idx" ON "projects"("metro");

-- CreateIndex
CREATE INDEX "feeds_is_active_idx" ON "feeds"("is_active");

-- CreateIndex
CREATE INDEX "apartments_project_id_idx" ON "apartments"("project_id");

-- CreateIndex
CREATE INDEX "apartments_is_active_idx" ON "apartments"("is_active");

-- CreateIndex
CREATE INDEX "apartments_price_idx" ON "apartments"("price");

-- CreateIndex
CREATE INDEX "apartments_rooms_idx" ON "apartments"("rooms");

-- CreateIndex
CREATE INDEX "apartments_area_idx" ON "apartments"("area");

-- CreateIndex
CREATE INDEX "apartments_deadline_idx" ON "apartments"("deadline");

-- CreateIndex
CREATE UNIQUE INDEX "apartments_feed_id_external_id_key" ON "apartments"("feed_id", "external_id");

-- CreateIndex
CREATE INDEX "knowledge_docs_project_id_idx" ON "knowledge_docs"("project_id");

-- CreateIndex
CREATE INDEX "knowledge_docs_status_idx" ON "knowledge_docs"("status");

-- CreateIndex
CREATE INDEX "knowledge_chunks_project_id_idx" ON "knowledge_chunks"("project_id");

-- CreateIndex
CREATE UNIQUE INDEX "knowledge_chunks_doc_id_position_key" ON "knowledge_chunks"("doc_id", "position");

-- CreateIndex
CREATE UNIQUE INDEX "conversations_session_id_key" ON "conversations"("session_id");

-- CreateIndex
CREATE INDEX "conversations_last_message_at_idx" ON "conversations"("last_message_at");

-- CreateIndex
CREATE INDEX "conversations_started_at_idx" ON "conversations"("started_at");

-- CreateIndex
CREATE INDEX "messages_conversation_id_created_at_idx" ON "messages"("conversation_id", "created_at");

-- CreateIndex
CREATE INDEX "leads_status_idx" ON "leads"("status");

-- CreateIndex
CREATE INDEX "leads_created_at_idx" ON "leads"("created_at");

-- CreateIndex
CREATE INDEX "leads_phone_idx" ON "leads"("phone");

-- AddForeignKey
ALTER TABLE "apartments" ADD CONSTRAINT "apartments_feed_id_fkey" FOREIGN KEY ("feed_id") REFERENCES "feeds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "apartments" ADD CONSTRAINT "apartments_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_docs" ADD CONSTRAINT "knowledge_docs_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_doc_id_fkey" FOREIGN KEY ("doc_id") REFERENCES "knowledge_docs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "knowledge_chunks" ADD CONSTRAINT "knowledge_chunks_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "messages" ADD CONSTRAINT "messages_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "leads" ADD CONSTRAINT "leads_conversation_id_fkey" FOREIGN KEY ("conversation_id") REFERENCES "conversations"("id") ON DELETE SET NULL ON UPDATE CASCADE;
