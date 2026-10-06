-- Phase 12: learner profiles. Hand-written (drizzle-kit's rebuilds copied a profile_id column the
-- old user_profile lacks, and cannot add a NOT NULL column without a default). Nothing is dropped:
-- the learning settings are copied to profile_settings before settings is rebuilt, the single
-- user_profile row keeps its id, and every existing per-learner row belongs to profile 1.
-- The per-learner profile_id columns keep DEFAULT 1 in SQLite (ADD COLUMN NOT NULL needs a default);
-- the Drizzle schema has no default, so the app must always set profile_id explicitly.
CREATE TABLE `profiles` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`emoji` text,
	`created_at` integer NOT NULL,
	`archived_at` integer,
	CONSTRAINT "profiles_name_length" CHECK(length("profiles"."name") between 1 and 30)
);
--> statement-breakpoint
CREATE UNIQUE INDEX `profiles_name_unique` ON `profiles` (`name`);
--> statement-breakpoint
INSERT INTO `profiles` (`id`, `name`, `emoji`, `created_at`) VALUES (1, 'Hồ sơ 1', NULL, cast(unixepoch('subsec') * 1000 as integer));
--> statement-breakpoint
CREATE TABLE `profile_settings` (
	`profile_id` integer PRIMARY KEY NOT NULL,
	`desired_retention` real DEFAULT 0.9 NOT NULL,
	`weekly_goal_days` integer DEFAULT 5 NOT NULL,
	`default_session_budget` integer DEFAULT 8 NOT NULL,
	`feedback_mode` text DEFAULT 'direct' NOT NULL,
	`new_cards_per_day` integer DEFAULT 10 NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE cascade,
	CONSTRAINT "profile_settings_desired_retention" CHECK("profile_settings"."desired_retention" between 0.7 and 0.97),
	CONSTRAINT "profile_settings_weekly_goal_days" CHECK("profile_settings"."weekly_goal_days" between 1 and 7),
	CONSTRAINT "profile_settings_default_session_budget" CHECK("profile_settings"."default_session_budget" between 1 and 60),
	CONSTRAINT "profile_settings_feedback_mode" CHECK("profile_settings"."feedback_mode" in ('direct', 'indirect')),
	CONSTRAINT "profile_settings_new_cards_per_day" CHECK("profile_settings"."new_cards_per_day" between 0 and 50)
);
--> statement-breakpoint
INSERT INTO `profile_settings` (`profile_id`, `desired_retention`, `weekly_goal_days`, `default_session_budget`, `feedback_mode`, `new_cards_per_day`)
	SELECT 1, `desired_retention`, `weekly_goal_days`, `default_session_budget`, `feedback_mode`, `new_cards_per_day` FROM `settings` WHERE `id` = 1;
--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`active_provider_id` integer,
	FOREIGN KEY (`active_provider_id`) REFERENCES `llm_providers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "settings_single_row" CHECK("__new_settings"."id" = 1)
);
--> statement-breakpoint
INSERT INTO `__new_settings` (`id`, `active_provider_id`) SELECT `id`, `active_provider_id` FROM `settings`;
--> statement-breakpoint
DROP TABLE `settings`;
--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;
--> statement-breakpoint
CREATE TABLE `__new_user_profile` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`profile_id` integer NOT NULL,
	`theta` real,
	`cefr_estimate` text,
	`vstep_estimate` integer,
	`ielts_estimate` real,
	`toeic_estimate` integer,
	`vocab_theta` real,
	`grammar_theta` real,
	`reading_theta` real,
	`writing_theta` real,
	`known_band_ceiling` integer DEFAULT 1 NOT NULL,
	`placement_skipped_at` integer,
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	FOREIGN KEY (`profile_id`) REFERENCES `profiles`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "user_profile_cefr_estimate" CHECK("__new_user_profile"."cefr_estimate" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "user_profile_known_band_ceiling" CHECK("__new_user_profile"."known_band_ceiling" between 1 and 8)
);
--> statement-breakpoint
INSERT INTO `__new_user_profile` (`id`, `profile_id`, theta, cefr_estimate, vstep_estimate, ielts_estimate, toeic_estimate, vocab_theta, grammar_theta, reading_theta, writing_theta, known_band_ceiling, placement_skipped_at, updated_at)
	SELECT `id`, 1, theta, cefr_estimate, vstep_estimate, ielts_estimate, toeic_estimate, vocab_theta, grammar_theta, reading_theta, writing_theta, known_band_ceiling, placement_skipped_at, updated_at FROM `user_profile`;
--> statement-breakpoint
DROP TABLE `user_profile`;
--> statement-breakpoint
ALTER TABLE `__new_user_profile` RENAME TO `user_profile`;
--> statement-breakpoint
CREATE UNIQUE INDEX `user_profile_profile_id_unique` ON `user_profile` (`profile_id`);
--> statement-breakpoint
DROP INDEX `cards_item_unique`;
--> statement-breakpoint
DROP INDEX `cards_cloze_item_unique`;
--> statement-breakpoint
ALTER TABLE `cards` ADD `profile_id` integer NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `cards_profile_state_due` ON `cards` (`profile_id`,`state`,`due`);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_item_unique` ON `cards` (`profile_id`,`kind`,(case when "lexeme_id" is null then 0 else "lexeme_id" end),(case when "sentence_id" is null then 0 else "sentence_id" end),(case when "grammar_topic_id" is null then 0 else "grammar_topic_id" end));
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_cloze_item_unique` ON `cards` (`profile_id`,`cloze_item_id`) WHERE "cards"."cloze_item_id" is not null;
--> statement-breakpoint
DROP INDEX `placement_attempts_one_in_progress`;
--> statement-breakpoint
ALTER TABLE `placement_attempts` ADD `profile_id` integer NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE UNIQUE INDEX `placement_attempts_one_in_progress` ON `placement_attempts` (`profile_id`,`status`) WHERE "placement_attempts"."status" = 'in_progress';
--> statement-breakpoint
DROP INDEX `sessions_one_in_progress`;
--> statement-breakpoint
ALTER TABLE `sessions` ADD `profile_id` integer NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `sessions_profile_finished_at` ON `sessions` (`profile_id`,`finished_at`);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_one_in_progress` ON `sessions` (`profile_id`,`status`) WHERE "sessions"."status" = 'in_progress';
--> statement-breakpoint
ALTER TABLE `placement_results` ADD `profile_id` integer NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `placement_results_profile_id` ON `placement_results` (`profile_id`,`id`);
--> statement-breakpoint
ALTER TABLE `review_logs` ADD `profile_id` integer NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `review_logs_profile_review` ON `review_logs` (`profile_id`,`review`);
--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `profile_id` integer NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `writing_submissions_profile_status` ON `writing_submissions` (`profile_id`,`status`);
--> statement-breakpoint
ALTER TABLE `drill_results` ADD `profile_id` integer NOT NULL DEFAULT 1 REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `drill_results_profile_answered_at` ON `drill_results` (`profile_id`,`answered_at`);
--> statement-breakpoint
ALTER TABLE `auth_sessions` ADD `profile_id` integer REFERENCES profiles(id) ON DELETE set null;
--> statement-breakpoint
ALTER TABLE `sentences` ADD `profile_id` integer REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `sentences_profile_id` ON `sentences` (`profile_id`);
--> statement-breakpoint
UPDATE `sentences` SET `profile_id` = 1 WHERE `source` = 'user_error';
--> statement-breakpoint
ALTER TABLE `cloze_items` ADD `profile_id` integer REFERENCES profiles(id) ON DELETE restrict;
--> statement-breakpoint
CREATE INDEX `cloze_items_profile_id` ON `cloze_items` (`profile_id`);
--> statement-breakpoint
UPDATE `cloze_items` SET `profile_id` = 1 WHERE `gap_type` = 'user_error';
--> statement-breakpoint
ALTER TABLE `llm_calls` ADD `profile_id` integer;
--> statement-breakpoint
CREATE INDEX `llm_calls_profile_created_at` ON `llm_calls` (`profile_id`,`created_at`);
