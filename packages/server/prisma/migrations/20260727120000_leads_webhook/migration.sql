-- CreateEnum
CREATE TYPE "LeadWebhookStatus" AS ENUM ('skipped', 'sent', 'failed');

-- AlterTable
ALTER TABLE "leads" ADD COLUMN     "apartments" JSONB,
ADD COLUMN     "webhook_at" TIMESTAMP(3),
ADD COLUMN     "webhook_error" TEXT,
ADD COLUMN     "webhook_status" "LeadWebhookStatus" NOT NULL DEFAULT 'skipped';
