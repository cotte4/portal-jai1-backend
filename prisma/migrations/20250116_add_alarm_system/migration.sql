-- Migration: Add Alarm System (History + Custom Thresholds)

-- CreateEnum: AlarmType
DO $$ BEGIN
    CREATE TYPE "AlarmType" AS ENUM ('possible_verification_federal', 'possible_verification_state', 'verification_timeout', 'letter_sent_timeout');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: AlarmLevel
DO $$ BEGIN
    CREATE TYPE "AlarmLevel" AS ENUM ('warning', 'critical');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateEnum: AlarmResolution
DO $$ BEGIN
    CREATE TYPE "AlarmResolution" AS ENUM ('active', 'acknowledged', 'resolved', 'auto_resolved');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- CreateTable: alarm_thresholds (custom thresholds per tax case)
CREATE TABLE IF NOT EXISTS "alarm_thresholds" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tax_case_id" UUID NOT NULL,
    "federal_in_process_days" INTEGER,
    "state_in_process_days" INTEGER,
    "verification_timeout_days" INTEGER,
    "letter_sent_timeout_days" INTEGER,
    "disable_federal_alarms" BOOLEAN NOT NULL DEFAULT false,
    "disable_state_alarms" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "created_by_id" UUID,
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_thresholds_pkey" PRIMARY KEY ("id")
);

-- CreateTable: alarm_history (tracks all triggered alarms)
CREATE TABLE IF NOT EXISTS "alarm_history" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "tax_case_id" UUID NOT NULL,
    "alarm_type" "AlarmType" NOT NULL,
    "alarm_level" "AlarmLevel" NOT NULL,
    "track" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "threshold_days" INTEGER NOT NULL,
    "actual_days" INTEGER NOT NULL,
    "status_at_trigger" TEXT NOT NULL,
    "status_changed_at" TIMESTAMPTZ NOT NULL,
    "resolution" "AlarmResolution" NOT NULL DEFAULT 'active',
    "resolved_at" TIMESTAMPTZ,
    "resolved_by_id" UUID,
    "resolved_note" TEXT,
    "auto_resolve_reason" TEXT,
    "triggered_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "alarm_history_pkey" PRIMARY KEY ("id")
);

-- CreateIndex: alarm_thresholds unique constraint on tax_case_id
CREATE UNIQUE INDEX IF NOT EXISTS "alarm_thresholds_tax_case_id_key" ON "alarm_thresholds"("tax_case_id");

-- CreateIndexes: alarm_history
CREATE INDEX IF NOT EXISTS "alarm_history_tax_case_id_idx" ON "alarm_history"("tax_case_id");
CREATE INDEX IF NOT EXISTS "alarm_history_alarm_type_idx" ON "alarm_history"("alarm_type");
CREATE INDEX IF NOT EXISTS "alarm_history_alarm_level_idx" ON "alarm_history"("alarm_level");
CREATE INDEX IF NOT EXISTS "alarm_history_resolution_idx" ON "alarm_history"("resolution");
CREATE INDEX IF NOT EXISTS "alarm_history_triggered_at_idx" ON "alarm_history"("triggered_at");
CREATE INDEX IF NOT EXISTS "alarm_history_tax_case_id_resolution_idx" ON "alarm_history"("tax_case_id", "resolution");

-- AddForeignKey: alarm_thresholds -> tax_cases
ALTER TABLE "alarm_thresholds"
ADD CONSTRAINT "alarm_thresholds_tax_case_id_fkey"
FOREIGN KEY ("tax_case_id") REFERENCES "tax_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey: alarm_history -> tax_cases
ALTER TABLE "alarm_history"
ADD CONSTRAINT "alarm_history_tax_case_id_fkey"
FOREIGN KEY ("tax_case_id") REFERENCES "tax_cases"("id") ON DELETE CASCADE ON UPDATE CASCADE;
