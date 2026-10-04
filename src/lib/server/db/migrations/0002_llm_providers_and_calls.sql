CREATE TABLE `llm_calls` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`created_at` integer NOT NULL,
	`provider_id` integer NOT NULL,
	`model` text NOT NULL,
	`purpose` text NOT NULL,
	`mode` text NOT NULL,
	`attempt` integer NOT NULL,
	`ok` integer NOT NULL,
	`http_status` integer,
	`error_code` text,
	`input_tokens` integer,
	`output_tokens` integer,
	`latency_ms` integer NOT NULL
);
--> statement-breakpoint
CREATE INDEX `llm_calls_created_at` ON `llm_calls` (`created_at`);--> statement-breakpoint
PRAGMA foreign_keys=OFF;--> statement-breakpoint
CREATE TABLE `__new_llm_providers` (
	`id` integer PRIMARY KEY AUTOINCREMENT NOT NULL,
	`name` text NOT NULL,
	`base_url` text NOT NULL,
	`model` text NOT NULL,
	`wire_format` text NOT NULL,
	`structured_mode` text DEFAULT 'json_schema' NOT NULL,
	`env_key_name` text,
	`enabled` integer DEFAULT true NOT NULL,
	`is_fallback` integer DEFAULT false NOT NULL,
	CONSTRAINT "llm_providers_wire_format" CHECK("__new_llm_providers"."wire_format" in ('openai', 'anthropic')),
	CONSTRAINT "llm_providers_structured_mode" CHECK("__new_llm_providers"."structured_mode" in ('json_schema', 'tool', 'json_prompt')),
	CONSTRAINT "llm_providers_env_key_name" CHECK("__new_llm_providers"."env_key_name" is null or (length("__new_llm_providers"."env_key_name") between 1 and 64 and "__new_llm_providers"."env_key_name" not glob '*[^A-Z0-9_]*'))
);
--> statement-breakpoint
-- Hand-edited (see plans/phase-04.md):
-- 1. drizzle-kit selected "structured_mode" from the old table, which lacks it; it takes its default.
-- 2. Migrations run inside one transaction, where PRAGMA foreign_keys=OFF is a no-op, so dropping
--    llm_providers fires ON DELETE SET NULL on settings.active_provider_id. Save and restore it.
INSERT INTO `__new_llm_providers`("id", "name", "base_url", "model", "wire_format", "env_key_name", "enabled", "is_fallback") SELECT "id", "name", "base_url", "model", "wire_format", "env_key_name", "enabled", "is_fallback" FROM `llm_providers`;--> statement-breakpoint
CREATE TABLE `__settings_active_provider` AS SELECT `id`, `active_provider_id` FROM `settings`;--> statement-breakpoint
DROP TABLE `llm_providers`;--> statement-breakpoint
ALTER TABLE `__new_llm_providers` RENAME TO `llm_providers`;--> statement-breakpoint
UPDATE `settings` SET `active_provider_id` = (SELECT `active_provider_id` FROM `__settings_active_provider` WHERE `__settings_active_provider`.`id` = `settings`.`id`);--> statement-breakpoint
DROP TABLE `__settings_active_provider`;--> statement-breakpoint
PRAGMA foreign_keys=ON;--> statement-breakpoint
CREATE UNIQUE INDEX `llm_providers_name_unique` ON `llm_providers` (`name`);--> statement-breakpoint
CREATE UNIQUE INDEX `llm_providers_one_fallback` ON `llm_providers` (`is_fallback`) WHERE "llm_providers"."is_fallback" = 1;