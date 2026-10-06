CREATE TABLE `placement_attempts` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`started_at` integer NOT NULL,
	`finished_at` integer,
	`status` text DEFAULT 'in_progress' NOT NULL,
	`part` text DEFAULT 'A' NOT NULL,
	`state_json` text NOT NULL,
	`result_id` integer,
	FOREIGN KEY (`result_id`) REFERENCES `placement_results`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "placement_attempts_status" CHECK("placement_attempts"."status" in ('in_progress', 'completed', 'abandoned')),
	CONSTRAINT "placement_attempts_part" CHECK("placement_attempts"."part" in ('A', 'B', 'C', 'done'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_attempts_one_in_progress` ON `placement_attempts` (`status`) WHERE "placement_attempts"."status" = 'in_progress';--> statement-breakpoint
ALTER TABLE `placement_results` ADD `vocab_band` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
ALTER TABLE `placement_results` ADD `cloze_theta` real;--> statement-breakpoint
ALTER TABLE `placement_results` ADD `ability_band` integer DEFAULT 1 NOT NULL;--> statement-breakpoint
-- Hand-edited: drizzle-kit drops ON DELETE from a foreign key added with ALTER TABLE.
ALTER TABLE `placement_results` ADD `writing_submission_id` integer REFERENCES writing_submissions(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `placement_results` ADD `reliability_flags` text DEFAULT '[]' NOT NULL;--> statement-breakpoint
ALTER TABLE `user_profile` ADD `placement_skipped_at` integer;