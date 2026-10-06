-- Hand-written: drizzle-kit rebuilt `sessions` to add the CHECK, but inside the migration
-- transaction PRAGMA foreign_keys=OFF is a no-op, so DROP TABLE would fire ON DELETE SET NULL on
-- writing_submissions.session_id (and its INSERT ... SELECT copied columns that did not exist yet).
-- SQLite allows a column-level CHECK in ADD COLUMN, so no rebuild is needed.
ALTER TABLE `sessions` ADD `status` text DEFAULT 'finished' NOT NULL CONSTRAINT "sessions_status" CHECK("status" in ('in_progress', 'finished', 'abandoned'));--> statement-breakpoint
ALTER TABLE `sessions` ADD `served_json` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `sessions` ADD `finished_at` integer;--> statement-breakpoint
ALTER TABLE `sessions` ADD `summary_json` text;--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_one_in_progress` ON `sessions` (`status`) WHERE "sessions"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX `sessions_finished_at` ON `sessions` (`finished_at`);
