CREATE TABLE `cloze_items` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`sentence_id` integer NOT NULL,
	`gap_type` text NOT NULL,
	`token_index` integer NOT NULL,
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
	CONSTRAINT "cloze_items_gap_type" CHECK("cloze_items"."gap_type" in ('lexical', 'article', 'preposition', 'verb_form'))
);
--> statement-breakpoint
CREATE UNIQUE INDEX `cloze_items_content_hash_unique` ON `cloze_items` (`content_hash`);--> statement-breakpoint
CREATE INDEX `cloze_items_validated_type_band` ON `cloze_items` (`validated`,`gap_type`,`level_band`);--> statement-breakpoint
CREATE INDEX `cloze_items_sentence_id` ON `cloze_items` (`sentence_id`);--> statement-breakpoint
-- Hand-edited: drizzle-kit omitted the ON DELETE clause that schema.ts declares.
ALTER TABLE `cards` ADD `cloze_item_id` integer REFERENCES cloze_items(id) ON DELETE restrict;--> statement-breakpoint
CREATE UNIQUE INDEX `cards_cloze_item_unique` ON `cards` (`cloze_item_id`) WHERE "cards"."cloze_item_id" is not null;--> statement-breakpoint
ALTER TABLE `generated_cache` ADD `prompt_version` text;--> statement-breakpoint
ALTER TABLE `sentences` ADD `blocked` integer DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE `sentences` ADD `blocked_reason` text;--> statement-breakpoint
ALTER TABLE `sentences` ADD `has_stock_names` integer DEFAULT false NOT NULL;--> statement-breakpoint
CREATE INDEX `sentences_blocked_level_band` ON `sentences` (`blocked`,`level_band`);