PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`desired_retention` real DEFAULT 0.9 NOT NULL,
	`weekly_goal_days` integer DEFAULT 5 NOT NULL,
	`default_session_budget` integer DEFAULT 8 NOT NULL,
	`feedback_mode` text DEFAULT 'direct' NOT NULL,
	`new_cards_per_day` integer DEFAULT 10 NOT NULL,
	`active_provider_id` integer,
	FOREIGN KEY (`active_provider_id`) REFERENCES `llm_providers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "settings_single_row" CHECK("__new_settings"."id" = 1),
	CONSTRAINT "settings_desired_retention" CHECK("__new_settings"."desired_retention" between 0.7 and 0.97),
	CONSTRAINT "settings_weekly_goal_days" CHECK("__new_settings"."weekly_goal_days" between 1 and 7),
	CONSTRAINT "settings_default_session_budget" CHECK("__new_settings"."default_session_budget" between 1 and 60),
	CONSTRAINT "settings_feedback_mode" CHECK("__new_settings"."feedback_mode" in ('direct', 'indirect')),
	CONSTRAINT "settings_new_cards_per_day" CHECK("__new_settings"."new_cards_per_day" between 0 and 50)
);
--> statement-breakpoint
-- Hand-edited: drizzle-kit selected "new_cards_per_day" from the old table, which lacks it.
-- The new column takes its default (10).
INSERT INTO `__new_settings`("id", "desired_retention", "weekly_goal_days", "default_session_budget", "feedback_mode", "active_provider_id") SELECT "id", "desired_retention", "weekly_goal_days", "default_session_budget", "feedback_mode", "active_provider_id" FROM `settings`;--> statement-breakpoint
DROP TABLE `settings`;--> statement-breakpoint
ALTER TABLE `__new_settings` RENAME TO `settings`;--> statement-breakpoint
PRAGMA foreign_keys=ON;