CREATE TABLE `drill_results` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`session_id` integer NOT NULL,
	`cache_id` integer NOT NULL,
	`topic_code` text NOT NULL,
	`correct` integer NOT NULL,
	`answered_at` integer NOT NULL,
	FOREIGN KEY (`session_id`) REFERENCES `sessions`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`cache_id`) REFERENCES `generated_cache`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "drill_results_topic_code" CHECK("drill_results"."topic_code" in ('ART', 'TNS', 'PLU', 'SVA', 'COP', 'PRE', 'COL', 'WFM', 'WOR', 'OTH'))
);
--> statement-breakpoint
CREATE INDEX `drill_results_answered_at` ON `drill_results` (`answered_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_cloze_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sentence_id` integer NOT NULL,
	`gap_type` text NOT NULL,
	`token_index` integer NOT NULL,
	`token_count` integer DEFAULT 1 NOT NULL,
	`typing_only` integer DEFAULT false NOT NULL,
	`answer` text NOT NULL,
	`options` text NOT NULL,
	`answer_vi` text,
	`lexeme_id` integer,
	`grammar_topic_id` integer,
	`level_band` integer NOT NULL,
	`rule_ok` integer NOT NULL,
	`critic_ok` integer,
	`validated` integer DEFAULT false NOT NULL,
	`rejection_reason` text,
	`critic_notes` text,
	`prompt_version` text NOT NULL,
	`model` text,
	`content_hash` text NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`sentence_id`) REFERENCES `sentences`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`lexeme_id`) REFERENCES `lexemes`(`id`) ON UPDATE no action ON DELETE restrict,
	FOREIGN KEY (`grammar_topic_id`) REFERENCES `grammar_topics`(`id`) ON UPDATE no action ON DELETE restrict,
	CONSTRAINT "cloze_items_gap_type" CHECK("__new_cloze_items"."gap_type" in ('lexical', 'article', 'preposition', 'verb_form', 'user_error'))
);
--> statement-breakpoint
-- Hand-edited: drizzle-kit copied token_count and typing_only, which the old table lacks (they
-- take their defaults). This rebuild (for the gap_type CHECK) drops a table that cards references
-- ON DELETE RESTRICT; it works because migrate() turns foreign keys off around migrations (see
-- db/client.ts) and runs foreign_key_check afterwards.
INSERT INTO `__new_cloze_items`("id", "sentence_id", "gap_type", "token_index", "answer", "options", "answer_vi", "lexeme_id", "grammar_topic_id", "level_band", "rule_ok", "critic_ok", "validated", "rejection_reason", "critic_notes", "prompt_version", "model", "content_hash", "created_at") SELECT "id", "sentence_id", "gap_type", "token_index", "answer", "options", "answer_vi", "lexeme_id", "grammar_topic_id", "level_band", "rule_ok", "critic_ok", "validated", "rejection_reason", "critic_notes", "prompt_version", "model", "content_hash", "created_at" FROM `cloze_items`;--> statement-breakpoint
DROP TABLE `cloze_items`;--> statement-breakpoint
ALTER TABLE `__new_cloze_items` RENAME TO `cloze_items`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `cloze_items_content_hash_unique` ON `cloze_items` (`content_hash`);--> statement-breakpoint
CREATE INDEX `cloze_items_validated_type_band` ON `cloze_items` (`validated`,`gap_type`,`level_band`);--> statement-breakpoint
CREATE INDEX `cloze_items_sentence_id` ON `cloze_items` (`sentence_id`);--> statement-breakpoint
-- Hand-written: new writing_submissions columns as ADD COLUMNs (a column-level CHECK is allowed),
-- instead of drizzle-kit's rebuild of a table that placement_results references.
ALTER TABLE `writing_submissions` ADD `task_kind` text DEFAULT 'writing' NOT NULL CONSTRAINT "writing_submissions_task_kind" CHECK("task_kind" in ('writing', 'translation'));--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `prompt_id` text;--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `sentence_id` integer REFERENCES sentences(id) ON DELETE set null;--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `reference_en` text;--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `on_topic` integer;--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `task_note_vi` text;--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `meaning_ok` integer;--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `mined_at` integer;--> statement-breakpoint
ALTER TABLE `writing_submissions` ADD `mined_count` integer DEFAULT 0 NOT NULL;
