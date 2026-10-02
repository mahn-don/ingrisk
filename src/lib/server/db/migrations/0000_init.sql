CREATE TABLE `cards` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`lexeme_id` integer,
	`sentence_id` integer,
	`grammar_topic_id` integer,
	`prompt_mode` text DEFAULT 'choice' NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`reps` integer NOT NULL,
	`lapses` integer NOT NULL,
	`state` text NOT NULL,
	`last_review` integer,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`sentence_id`) REFERENCES `sentences`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`grammar_topic_id`) REFERENCES `grammar_topics`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cards_kind" CHECK("cards"."kind" in ('cloze', 'translate', 'grammar', 'reading', 'error')),
	CONSTRAINT "cards_prompt_mode" CHECK("cards"."prompt_mode" in ('choice', 'typing')),
	CONSTRAINT "cards_state" CHECK("cards"."state" in ('New', 'Learning', 'Review', 'Relearning'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cards_item_unique` ON `cards` (`kind`,(case when "lexeme_id" is null then 0 else "lexeme_id" end),(case when "sentence_id" is null then 0 else "sentence_id" end),(case when "grammar_topic_id" is null then 0 else "grammar_topic_id" end));--> statement-breakpoint
CREATE INDEX `cards_due` ON `cards` (`due`);--> statement-breakpoint
CREATE TABLE `collocations` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`lexeme_id` integer NOT NULL,
	`chunk` text NOT NULL,
	`example_en` text,
	`example_vi` text,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE INDEX `collocations_lexeme_id` ON `collocations` (`lexeme_id`);--> statement-breakpoint
CREATE TABLE `generated_cache` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`kind` text NOT NULL,
	`params_hash` text NOT NULL,
	`content_hash` text NOT NULL,
	`level_band` integer NOT NULL,
	`payload_json` text NOT NULL,
	`model` text NOT NULL,
	`created_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	`validated` integer DEFAULT false NOT NULL,
	`validation_notes` text,
	`served_at` integer,
	CONSTRAINT "generated_cache_kind" CHECK("generated_cache"."kind" in ('cloze', 'translate', 'grammar', 'reading', 'error'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `generated_cache_content_hash_unique` ON `generated_cache` (`content_hash`);--> statement-breakpoint
CREATE INDEX `generated_cache_kind_params_hash` ON `generated_cache` (`kind`,`params_hash`);--> statement-breakpoint
CREATE INDEX `generated_cache_kind_validated_served_at` ON `generated_cache` (`kind`,`validated`,`served_at`);--> statement-breakpoint
CREATE TABLE `grammar_topics` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`code` text NOT NULL,
	`name_vi` text NOT NULL,
	`name_en` text NOT NULL,
	`l1_interference` text NOT NULL,
	CONSTRAINT "grammar_topics_code" CHECK("grammar_topics"."code" in ('ART', 'TNS', 'PLU', 'SVA', 'COP', 'PRE', 'COL', 'WFM', 'WOR', 'OTH'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `grammar_topics_code_unique` ON `grammar_topics` (`code`);--> statement-breakpoint
CREATE TABLE `lexemes` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`headword` text NOT NULL,
	`pos` text,
	`ngsl_rank` integer,
	`freq_band` integer,
	`forms` text NOT NULL,
	`supplementary` integer DEFAULT false NOT NULL,
	`vi_gloss` text,
	`en_def` text,
	`source` text NOT NULL,
	`license_tag` text NOT NULL
);
--> statement-breakpoint
CREATE UNIQUE INDEX `lexemes_headword_unique` ON `lexemes` (`headword`);--> statement-breakpoint
CREATE TABLE `llm_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`wire_format` text NOT NULL,
	`env_key_name` text NOT NULL,
	`enabled` integer DEFAULT true NOT NULL,
	`is_fallback` integer DEFAULT false NOT NULL,
	CONSTRAINT "llm_providers_wire_format" CHECK("llm_providers"."wire_format" in ('openai', 'anthropic')),
	CONSTRAINT "llm_providers_env_key_name" CHECK(length("llm_providers"."env_key_name") between 1 and 64 and "llm_providers"."env_key_name" not glob '*[^A-Z0-9_]*')
);
--> statement-breakpoint
CREATE UNIQUE INDEX `llm_providers_name_unique` ON `llm_providers` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `llm_providers_one_fallback` ON `llm_providers` (`is_fallback`) WHERE "llm_providers"."is_fallback" = 1;--> statement-breakpoint
CREATE TABLE `placement_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`taken_at` integer NOT NULL,
	`theta` real NOT NULL,
	`cefr` text NOT NULL,
	`subscores_json` text NOT NULL,
	`item_log_json` text NOT NULL,
	`writing_status` text DEFAULT 'none' NOT NULL,
	CONSTRAINT "placement_results_cefr" CHECK("placement_results"."cefr" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "placement_results_writing_status" CHECK("placement_results"."writing_status" in ('none', 'queued', 'scored'))
);
--> statement-breakpoint
CREATE TABLE `review_logs` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`card_id` integer NOT NULL,
	`rating` text NOT NULL,
	`state` text NOT NULL,
	`due` integer NOT NULL,
	`stability` real NOT NULL,
	`difficulty` real NOT NULL,
	`elapsed_days` integer NOT NULL,
	`last_elapsed_days` integer NOT NULL,
	`scheduled_days` integer NOT NULL,
	`learning_steps` integer NOT NULL,
	`review` integer NOT NULL,
	`old_s` real NOT NULL,
	`new_s` real NOT NULL,
	`old_d` real NOT NULL,
	`new_d` real NOT NULL,
	FOREIGN KEY (`card_id`) REFERENCES `cards`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "review_logs_rating" CHECK("review_logs"."rating" in ('Manual', 'Again', 'Hard', 'Good', 'Easy')),
	CONSTRAINT "review_logs_state" CHECK("review_logs"."state" in ('New', 'Learning', 'Review', 'Relearning'))
);
--> statement-breakpoint
CREATE INDEX `review_logs_card_id` ON `review_logs` (`card_id`,`review`);--> statement-breakpoint
CREATE TABLE `sentences` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`en_text` text NOT NULL,
	`vi_text` text NOT NULL,
	`source` text NOT NULL,
	`tatoeba_id_en` integer,
	`tatoeba_id_vi` integer,
	`ngsl_band_max` integer,
	`off_list_count` integer DEFAULT 0 NOT NULL,
	`license_tag` text NOT NULL,
	`level_band` integer
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sentences_tatoeba_id_en_unique` ON `sentences` (`tatoeba_id_en`);--> statement-breakpoint
CREATE TABLE `sessions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`client_session_id` text NOT NULL,
	`started_at` integer NOT NULL,
	`ended_at` integer,
	`budget_min` integer NOT NULL,
	`shape` text NOT NULL,
	`items_done` integer DEFAULT 0 NOT NULL,
	`streak_after` integer,
	CONSTRAINT "sessions_shape" CHECK("sessions"."shape" in ('quick', 'read', 'write'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `sessions_client_session_id_unique` ON `sessions` (`client_session_id`);--> statement-breakpoint
CREATE TABLE `settings` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
	`desired_retention` real DEFAULT 0.9 NOT NULL,
	`weekly_goal_days` integer DEFAULT 5 NOT NULL,
	`default_session_budget` integer DEFAULT 8 NOT NULL,
	`feedback_mode` text DEFAULT 'direct' NOT NULL,
	`active_provider_id` integer,
	FOREIGN KEY (`active_provider_id`) REFERENCES `llm_providers`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "settings_single_row" CHECK("settings"."id" = 1),
	CONSTRAINT "settings_desired_retention" CHECK("settings"."desired_retention" between 0.7 and 0.97),
	CONSTRAINT "settings_weekly_goal_days" CHECK("settings"."weekly_goal_days" between 1 and 7),
	CONSTRAINT "settings_default_session_budget" CHECK("settings"."default_session_budget" between 1 and 60),
	CONSTRAINT "settings_feedback_mode" CHECK("settings"."feedback_mode" in ('direct', 'indirect'))
);
--> statement-breakpoint
CREATE TABLE `user_profile` (
	`id` integer PRIMARY KEY DEFAULT 1 NOT NULL,
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
	`updated_at` integer DEFAULT (cast(unixepoch('subsec') * 1000 as integer)) NOT NULL,
	CONSTRAINT "user_profile_single_row" CHECK("user_profile"."id" = 1),
	CONSTRAINT "user_profile_cefr_estimate" CHECK("user_profile"."cefr_estimate" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2')),
	CONSTRAINT "user_profile_known_band_ceiling" CHECK("user_profile"."known_band_ceiling" between 1 and 8)
);
--> statement-breakpoint
CREATE TABLE `writing_submissions` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer,
	`prompt` text NOT NULL,
	`user_text` text NOT NULL,
	`corrected_text` text,
	`errors_json` text,
	`cefr_estimate` text,
	`status` text DEFAULT 'queued' NOT NULL,
	`submitted_at` integer NOT NULL,
	`scored_at` integer,
	`feedback_seen_at` integer,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE set null,
	CONSTRAINT "writing_submissions_status" CHECK("writing_submissions"."status" in ('queued', 'scored', 'failed')),
	CONSTRAINT "writing_submissions_cefr_estimate" CHECK("writing_submissions"."cefr_estimate" in ('A1', 'A2', 'B1', 'B2', 'C1', 'C2'))
);
--> statement-breakpoint
CREATE INDEX `writing_submissions_status` ON `writing_submissions` (`status`);--> statement-breakpoint
-- Seed data (hand-written): Part I §6 taxonomy and the single settings/profile rows.
INSERT INTO `grammar_topics` (`code`, `name_vi`, `name_en`, `l1_interference`) VALUES
	('ART', 'Mạo từ', 'Articles', 'Vietnamese has no article system'),
	('TNS', 'Thì và thể', 'Tense / aspect', 'Time is marked by particles, not inflection'),
	('PLU', 'Danh từ số nhiều', 'Plural morphology', 'No morphological plural'),
	('SVA', 'Hòa hợp chủ ngữ – động từ', 'Subject–verb agreement', 'No verb inflection'),
	('COP', 'Thiếu động từ "to be"', 'Missing copula', 'Vietnamese adjectives act as verbs'),
	('PRE', 'Giới từ', 'Prepositions', 'No one-to-one mapping'),
	('COL', 'Kết hợp từ', 'Collocation', 'Largest single error class in Vietnamese learner writing (~33%)'),
	('WFM', 'Dạng từ', 'Word form', 'About 18% of errors'),
	('WOR', 'Trật tự từ', 'Word order', 'Vietnamese modifiers follow the head'),
	('OTH', 'Lỗi khác', 'Other', 'Not covered by the other codes');
--> statement-breakpoint
INSERT INTO `settings` (`id`) VALUES (1);
--> statement-breakpoint
INSERT INTO `user_profile` (`id`) VALUES (1);
