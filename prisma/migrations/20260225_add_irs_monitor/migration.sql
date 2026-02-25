-- CreateEnum
CREATE TYPE "IrsCheckTrigger" AS ENUM ('manual', 'schedule');

-- CreateEnum
CREATE TYPE "IrsCheckResult" AS ENUM ('success', 'not_found', 'error', 'timeout');

-- CreateTable
CREATE TABLE "irs_checks" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tax_case_id" UUID NOT NULL,
    "irs_raw_status" TEXT NOT NULL,
    "irs_details" TEXT,
    "screenshot_path" TEXT,
    "mapped_status" "FederalStatusNew",
    "status_changed" BOOLEAN NOT NULL DEFAULT false,
    "previous_status" "FederalStatusNew",
    "triggered_by" "IrsCheckTrigger" NOT NULL,
    "triggered_by_user_id" UUID,
    "check_result" "IrsCheckResult" NOT NULL,
    "error_message" TEXT,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "irs_checks_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "irs_checks_tax_case_id_idx" ON "irs_checks"("tax_case_id");

-- CreateIndex
CREATE INDEX "irs_checks_created_at_idx" ON "irs_checks"("created_at");

-- CreateIndex
CREATE INDEX "irs_checks_check_result_idx" ON "irs_checks"("check_result");

-- AddForeignKey
ALTER TABLE "irs_checks" ADD CONSTRAINT "irs_checks_tax_case_id_fkey"
    FOREIGN KEY ("tax_case_id") REFERENCES "tax_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
