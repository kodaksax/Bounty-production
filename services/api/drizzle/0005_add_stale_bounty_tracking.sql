-- Migration: Add stale bounty tracking and soft delete for users
-- This migration adds support for detecting and managing "stale" bounties
-- when a hunter's account is deleted.

-- Add soft delete support to users table
ALTER TABLE "users" ADD COLUMN "deleted_at" timestamp with time zone;

-- Add stale bounty tracking fields to bounties table
ALTER TABLE "bounties" ADD COLUMN "is_stale" boolean DEFAULT false NOT NULL;
ALTER TABLE "bounties" ADD COLUMN "stale_reason" text;
ALTER TABLE "bounties" ADD COLUMN "stale_detected_at" timestamp with time zone;

-- Add comments for documentation
COMMENT ON COLUMN "users"."deleted_at" IS 'Timestamp when user account was soft deleted';
COMMENT ON COLUMN "bounties"."is_stale" IS 'Flag indicating bounty is stale (hunter deleted account)';
COMMENT ON COLUMN "bounties"."stale_reason" IS 'Reason why bounty became stale (e.g., hunter_deleted)';
COMMENT ON COLUMN "bounties"."stale_detected_at" IS 'Timestamp when stale condition was detected';

-- Create index for efficient stale bounty queries
CREATE INDEX IF NOT EXISTS "idx_bounties_is_stale" ON "bounties" ("is_stale") WHERE "is_stale" = true;
CREATE INDEX IF NOT EXISTS "idx_users_deleted_at" ON "users" ("deleted_at") WHERE "deleted_at" IS NOT NULL;

-- Create index to quickly find in-progress bounties by hunter
CREATE INDEX IF NOT EXISTS "idx_bounties_hunter_status" ON "bounties" ("hunter_id", "status") WHERE "status" = 'in_progress';
