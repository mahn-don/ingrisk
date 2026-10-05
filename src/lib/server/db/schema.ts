// Drizzle schema: the single source for the SQLite tables (Part II §3 of docs/architecture.md).
// Conventions: timestamps are integer Unix milliseconds, JSON is text, booleans are 0/1 integers,
// enumerations are text checked against their allowed values, every foreign key names its onDelete.
import { sql, type SQL } from 'drizzle-orm';
import {
	type AnySQLiteColumn,
	check,
	index,
	integer,
	real,
	sqliteTable,
	text,
	uniqueIndex
} from 'drizzle-orm/sqlite-core';

// --- Enumerations ------------------------------------------------------------------------------

export const CARD_KINDS = ['cloze', 'translate', 'grammar', 'reading', 'error'] as const;
/** What a cloze gap tests (Phase 5a). */
export const CLOZE_GAP_TYPES = ['lexical', 'article', 'preposition', 'verb_form'] as const;
export const WRITING_STATUSES = ['queued', 'scored', 'failed'] as const;
export const WIRE_FORMATS = ['openai', 'anthropic'] as const;
/** How a provider is asked for structured output (see src/lib/server/llm/). */
export const STRUCTURED_MODES = ['json_schema', 'tool', 'json_prompt'] as const;
export const SESSION_SHAPES = ['quick', 'read', 'write'] as const;
export const PLACEMENT_WRITING_STATUSES = ['none', 'queued', 'scored'] as const;
/** Direct correction plus a short explanation (default, Part I §5), or indirect prompts. */
export const FEEDBACK_MODES = ['direct', 'indirect'] as const;
/** Multiple choice while a card is weak, free typing once its stability is high (Part I §3). */
export const PROMPT_MODES = ['choice', 'typing'] as const;
export const CEFR_LEVELS = ['A1', 'A2', 'B1', 'B2', 'C1', 'C2'] as const;
/** The L1 interference taxonomy codes of Part I §6. */
export const TOPIC_CODES = ['ART', 'TNS', 'PLU', 'SVA', 'COP', 'PRE', 'COL', 'WFM', 'WOR', 'OTH'] as const;
/** ts-fsrs `State` names (New = 0 ... Relearning = 3). */
export const FSRS_STATES = ['New', 'Learning', 'Review', 'Relearning'] as const;
/** ts-fsrs `Rating` names (Manual = 0 ... Easy = 4). */
export const FSRS_RATINGS = ['Manual', 'Again', 'Hard', 'Good', 'Easy'] as const;

/** CHECK that a text column holds one of the allowed values (NULL passes for nullable columns). */
function oneOf(column: AnySQLiteColumn, values: readonly string[]): SQL {
	return sql`${column} in (${sql.raw(values.map((v) => `'${v}'`).join(', '))})`;
}

/**
 * `column`, or 0 when NULL. Written as CASE rather than coalesce() because drizzle-kit splits
 * index expressions on commas and would emit invalid SQL.
 */
function nullAsZero(column: AnySQLiteColumn): SQL {
	return sql`(case when ${column} is null then 0 else ${column} end)`;
}

const createdNow = sql`(cast(unixepoch('subsec') * 1000 as integer))`;

// --- JSON column types --------------------------------------------------------------------------

export interface PlacementSubscores {
	vocab: number;
	grammar: number;
	reading: number;
	writing: number | null;
}

/** One answered placement item; Phase 8 fixes the exact shape. */
export type PlacementLogEntry = Record<string, unknown>;

/** One ranked error from writing feedback (Part II §5 WritingFeedback schema). */
export interface WritingError {
	original: string;
	correction: string;
	topic_code: (typeof TOPIC_CODES)[number];
	explanation_vi: string;
}

// --- Configuration ------------------------------------------------------------------------------

export const llmProviders = sqliteTable(
	'llm_providers',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		name: text('name').notNull(),
		baseUrl: text('base_url').notNull(),
		model: text('model').notNull(),
		wireFormat: text('wire_format', { enum: WIRE_FORMATS }).notNull(),
		structuredMode: text('structured_mode', { enum: STRUCTURED_MODES }).notNull().default('json_schema'),
		/**
		 * Name of the environment variable holding the API key, e.g. OPENAI_API_KEY. Never the key.
		 * NULL for providers that need no key (a local Ollama).
		 */
		envKeyName: text('env_key_name'),
		enabled: integer('enabled', { mode: 'boolean' }).notNull().default(true),
		isFallback: integer('is_fallback', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [
		uniqueIndex('llm_providers_name_unique').on(t.name),
		uniqueIndex('llm_providers_one_fallback').on(t.isFallback).where(sql`${t.isFallback} = 1`),
		check('llm_providers_wire_format', oneOf(t.wireFormat, WIRE_FORMATS)),
		check('llm_providers_structured_mode', oneOf(t.structuredMode, STRUCTURED_MODES)),
		// Upper-case env var names only: an API key pasted here by mistake is rejected.
		check(
			'llm_providers_env_key_name',
			sql`${t.envKeyName} is null or (length(${t.envKeyName}) between 1 and 64 and ${t.envKeyName} not glob '*[^A-Z0-9_]*')`
		)
	]
);

/** Single row (id = 1), seeded by the initial migration. */
export const settings = sqliteTable(
	'settings',
	{
		id: integer('id').primaryKey().default(1),
		desiredRetention: real('desired_retention').notNull().default(0.9),
		weeklyGoalDays: integer('weekly_goal_days').notNull().default(5),
		defaultSessionBudget: integer('default_session_budget').notNull().default(8),
		feedbackMode: text('feedback_mode', { enum: FEEDBACK_MODES }).notNull().default('direct'),
		/** New cards introduced per learning day (see srs/queue.ts). */
		newCardsPerDay: integer('new_cards_per_day').notNull().default(10),
		activeProviderId: integer('active_provider_id').references(() => llmProviders.id, {
			onDelete: 'set null'
		})
	},
	(t) => [
		check('settings_single_row', sql`${t.id} = 1`),
		check('settings_desired_retention', sql`${t.desiredRetention} between 0.7 and 0.97`),
		check('settings_weekly_goal_days', sql`${t.weeklyGoalDays} between 1 and 7`),
		check('settings_default_session_budget', sql`${t.defaultSessionBudget} between 1 and 60`),
		check('settings_feedback_mode', oneOf(t.feedbackMode, FEEDBACK_MODES)),
		check('settings_new_cards_per_day', sql`${t.newCardsPerDay} between 0 and 50`)
	]
);

// --- Learner ------------------------------------------------------------------------------------

/** Single row (id = 1), seeded by the initial migration. Estimates stay null until placement. */
export const userProfile = sqliteTable(
	'user_profile',
	{
		id: integer('id').primaryKey().default(1),
		theta: real('theta'),
		cefrEstimate: text('cefr_estimate', { enum: CEFR_LEVELS }),
		vstepEstimate: integer('vstep_estimate'),
		ieltsEstimate: real('ielts_estimate'),
		toeicEstimate: integer('toeic_estimate'),
		vocabTheta: real('vocab_theta'),
		grammarTheta: real('grammar_theta'),
		readingTheta: real('reading_theta'),
		writingTheta: real('writing_theta'),
		knownBandCeiling: integer('known_band_ceiling').notNull().default(1),
		updatedAt: integer('updated_at', { mode: 'timestamp_ms' }).notNull().default(createdNow)
	},
	(t) => [
		check('user_profile_single_row', sql`${t.id} = 1`),
		check('user_profile_cefr_estimate', oneOf(t.cefrEstimate, CEFR_LEVELS)),
		check('user_profile_known_band_ceiling', sql`${t.knownBandCeiling} between 1 and 8`)
	]
);

export const placementResults = sqliteTable(
	'placement_results',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		takenAt: integer('taken_at', { mode: 'timestamp_ms' }).notNull(),
		theta: real('theta').notNull(),
		cefr: text('cefr', { enum: CEFR_LEVELS }).notNull(),
		subscoresJson: text('subscores_json', { mode: 'json' }).$type<PlacementSubscores>().notNull(),
		itemLogJson: text('item_log_json', { mode: 'json' }).$type<PlacementLogEntry[]>().notNull(),
		writingStatus: text('writing_status', { enum: PLACEMENT_WRITING_STATUSES }).notNull().default('none')
	},
	(t) => [
		check('placement_results_cefr', oneOf(t.cefr, CEFR_LEVELS)),
		check('placement_results_writing_status', oneOf(t.writingStatus, PLACEMENT_WRITING_STATUSES))
	]
);

// --- Content ------------------------------------------------------------------------------------

export const lexemes = sqliteTable(
	'lexemes',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		headword: text('headword').notNull(),
		pos: text('pos'),
		/** NGSL rank; null for supplementary and LLM-introduced words. */
		ngslRank: integer('ngsl_rank'),
		freqBand: integer('freq_band'),
		/** Every inflected form, headword included (lowercase, sorted). */
		forms: text('forms', { mode: 'json' }).$type<string[]>().notNull(),
		/** NGSL supplementary word (day, month, number word): known, but unranked. */
		supplementary: integer('supplementary', { mode: 'boolean' }).notNull().default(false),
		viGloss: text('vi_gloss'),
		enDef: text('en_def'),
		source: text('source').notNull(),
		licenseTag: text('license_tag').notNull()
	},
	(t) => [uniqueIndex('lexemes_headword_unique').on(t.headword)]
);

export const collocations = sqliteTable(
	'collocations',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		lexemeId: integer('lexeme_id')
			.notNull()
			.references(() => lexemes.id, { onDelete: 'cascade' }),
		chunk: text('chunk').notNull(),
		exampleEn: text('example_en'),
		exampleVi: text('example_vi')
	},
	(t) => [index('collocations_lexeme_id').on(t.lexemeId)]
);

export const sentences = sqliteTable(
	'sentences',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		enText: text('en_text').notNull(),
		viText: text('vi_text').notNull(),
		source: text('source').notNull(),
		/** Null for LLM-generated sentences. */
		tatoebaIdEn: integer('tatoeba_id_en'),
		tatoebaIdVi: integer('tatoeba_id_vi'),
		/** Highest NGSL band among the English words; null when no word matched (Phase 1). */
		ngslBandMax: integer('ngsl_band_max'),
		offListCount: integer('off_list_count').notNull().default(0),
		licenseTag: text('license_tag').notNull(),
		levelBand: integer('level_band'),
		/** Matched the content blocklist; kept (never deleted) but never used. */
		blocked: integer('blocked', { mode: 'boolean' }).notNull().default(false),
		blockedReason: text('blocked_reason'),
		/** English mentions Tatoeba's stock names Tom or Mary (sessions cap how many they show). */
		hasStockNames: integer('has_stock_names', { mode: 'boolean' }).notNull().default(false)
	},
	(t) => [
		uniqueIndex('sentences_tatoeba_id_en_unique').on(t.tatoebaIdEn),
		index('sentences_blocked_level_band').on(t.blocked, t.levelBand)
	]
);

export const grammarTopics = sqliteTable(
	'grammar_topics',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		code: text('code', { enum: TOPIC_CODES }).notNull(),
		nameVi: text('name_vi').notNull(),
		nameEn: text('name_en').notNull(),
		/** Why Vietnamese speakers make this error (Part I §6). */
		l1Interference: text('l1_interference').notNull()
	},
	(t) => [
		uniqueIndex('grammar_topics_code_unique').on(t.code),
		check('grammar_topics_code', oneOf(t.code, TOPIC_CODES))
	]
);

// --- Cloze pool (Phase 5a) ----------------------------------------------------------------------

/**
 * Cloze items built from Tatoeba sentences: the gap is chosen by code, lexical distractors come
 * from the LLM, rules and a blind LLM critic validate. Failed items are kept for analysis.
 */
export const clozeItems = sqliteTable(
	'cloze_items',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sentenceId: integer('sentence_id')
			.notNull()
			.references(() => sentences.id, { onDelete: 'restrict' }),
		gapType: text('gap_type', { enum: CLOZE_GAP_TYPES }).notNull(),
		/** Index of the gap in the sentence's token list (see generation/cloze/tokens.ts). */
		tokenIndex: integer('token_index').notNull(),
		answer: text('answer').notNull(),
		/** The four options in display order (shuffled deterministically); '—' means "no word". */
		options: text('options', { mode: 'json' }).$type<string[]>().notNull(),
		/** Vietnamese gloss of the answer in this sentence (lexical gaps). */
		answerVi: text('answer_vi'),
		lexemeId: integer('lexeme_id').references(() => lexemes.id, { onDelete: 'restrict' }),
		grammarTopicId: integer('grammar_topic_id').references(() => grammarTopics.id, { onDelete: 'restrict' }),
		levelBand: integer('level_band').notNull(),
		ruleOk: integer('rule_ok', { mode: 'boolean' }).notNull(),
		/** Null when the critic did not run (the item already failed the rules). */
		criticOk: integer('critic_ok', { mode: 'boolean' }),
		validated: integer('validated', { mode: 'boolean' }).notNull().default(false),
		rejectionReason: text('rejection_reason'),
		criticNotes: text('critic_notes'),
		/** Versions of the prompt modules used, e.g. "cloze-distractors@1+cloze-critic@1". */
		promptVersion: text('prompt_version').notNull(),
		/** Model(s) that produced/judged the item; null if no LLM was involved. */
		model: text('model'),
		/** Identity of the candidate (sentence, gap type, position, answer): reruns skip it. */
		contentHash: text('content_hash').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [
		uniqueIndex('cloze_items_content_hash_unique').on(t.contentHash),
		index('cloze_items_validated_type_band').on(t.validated, t.gapType, t.levelBand),
		index('cloze_items_sentence_id').on(t.sentenceId),
		check('cloze_items_gap_type', oneOf(t.gapType, CLOZE_GAP_TYPES))
	]
);

// --- Spaced repetition --------------------------------------------------------------------------

/**
 * One reviewable item. The FSRS columns mirror every field of ts-fsrs's `Card` one-to-one
 * (`state` stores the `State` name), so a card round-trips without loss.
 */
export const cards = sqliteTable(
	'cards',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		kind: text('kind', { enum: CARD_KINDS }).notNull(),
		lexemeId: integer('lexeme_id').references(() => lexemes.id, { onDelete: 'restrict' }),
		sentenceId: integer('sentence_id').references(() => sentences.id, { onDelete: 'restrict' }),
		grammarTopicId: integer('grammar_topic_id').references(() => grammarTopics.id, {
			onDelete: 'restrict'
		}),
		/** The cloze item this card practises (cloze cards, Phase 9). */
		clozeItemId: integer('cloze_item_id').references(() => clozeItems.id, { onDelete: 'restrict' }),
		promptMode: text('prompt_mode', { enum: PROMPT_MODES }).notNull().default('choice'),
		// ts-fsrs Card
		due: integer('due', { mode: 'timestamp_ms' }).notNull(),
		stability: real('stability').notNull(),
		difficulty: real('difficulty').notNull(),
		elapsedDays: integer('elapsed_days').notNull(),
		scheduledDays: integer('scheduled_days').notNull(),
		learningSteps: integer('learning_steps').notNull(),
		reps: integer('reps').notNull(),
		lapses: integer('lapses').notNull(),
		state: text('state', { enum: FSRS_STATES }).notNull(),
		lastReview: integer('last_review', { mode: 'timestamp_ms' })
	},
	(t) => [
		// SQLite treats NULLs as distinct in unique indexes, so the nullable references are
		// mapped to 0 (never a real id): the same item cannot become two cards.
		uniqueIndex('cards_item_unique').on(
			t.kind,
			nullAsZero(t.lexemeId),
			nullAsZero(t.sentenceId),
			nullAsZero(t.grammarTopicId)
		),
		uniqueIndex('cards_cloze_item_unique').on(t.clozeItemId).where(sql`${t.clozeItemId} is not null`),
		index('cards_due').on(t.due),
		check('cards_kind', oneOf(t.kind, CARD_KINDS)),
		check('cards_prompt_mode', oneOf(t.promptMode, PROMPT_MODES)),
		check('cards_state', oneOf(t.state, FSRS_STATES))
	]
);

/**
 * Every review ever made: all fields of ts-fsrs's `ReviewLog` (`stability`/`difficulty` are the
 * values the log reports), plus stability and difficulty before and after the review.
 * Cards with reviews cannot be deleted (onDelete: restrict) so the history needed to
 * re-optimize FSRS parameters is never lost.
 */
export const reviewLogs = sqliteTable(
	'review_logs',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		cardId: integer('card_id')
			.notNull()
			.references(() => cards.id, { onDelete: 'restrict' }),
		// ts-fsrs ReviewLog
		rating: text('rating', { enum: FSRS_RATINGS }).notNull(),
		state: text('state', { enum: FSRS_STATES }).notNull(),
		due: integer('due', { mode: 'timestamp_ms' }).notNull(),
		stability: real('stability').notNull(),
		difficulty: real('difficulty').notNull(),
		elapsedDays: integer('elapsed_days').notNull(),
		lastElapsedDays: integer('last_elapsed_days').notNull(),
		scheduledDays: integer('scheduled_days').notNull(),
		learningSteps: integer('learning_steps').notNull(),
		review: integer('review', { mode: 'timestamp_ms' }).notNull(),
		// Before and after this review
		oldS: real('old_s').notNull(),
		newS: real('new_s').notNull(),
		oldD: real('old_d').notNull(),
		newD: real('new_d').notNull()
	},
	(t) => [
		index('review_logs_card_id').on(t.cardId, t.review),
		check('review_logs_rating', oneOf(t.rating, FSRS_RATINGS)),
		check('review_logs_state', oneOf(t.state, FSRS_STATES))
	]
);

// --- Sessions and generated content -------------------------------------------------------------

export const sessions = sqliteTable(
	'sessions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		/** Generated by the client when the session starts; makes result submission idempotent. */
		clientSessionId: text('client_session_id').notNull(),
		startedAt: integer('started_at', { mode: 'timestamp_ms' }).notNull(),
		endedAt: integer('ended_at', { mode: 'timestamp_ms' }),
		budgetMin: integer('budget_min').notNull(),
		shape: text('shape', { enum: SESSION_SHAPES }).notNull(),
		itemsDone: integer('items_done').notNull().default(0),
		streakAfter: integer('streak_after')
	},
	(t) => [
		uniqueIndex('sessions_client_session_id_unique').on(t.clientSessionId),
		check('sessions_shape', oneOf(t.shape, SESSION_SHAPES))
	]
);

export const generatedCache = sqliteTable(
	'generated_cache',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		kind: text('kind', { enum: CARD_KINDS }).notNull(),
		paramsHash: text('params_hash').notNull(),
		/** Hash of the normalized item content: the same item is never stored twice. */
		contentHash: text('content_hash').notNull(),
		levelBand: integer('level_band').notNull(),
		payloadJson: text('payload_json', { mode: 'json' }).$type<unknown>().notNull(),
		model: text('model').notNull(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull().default(createdNow),
		validated: integer('validated', { mode: 'boolean' }).notNull().default(false),
		validationNotes: text('validation_notes'),
		/** Set when a session takes the item, so it is never served twice. */
		servedAt: integer('served_at', { mode: 'timestamp_ms' }),
		/** Version string of the prompt module that produced the item. */
		promptVersion: text('prompt_version')
	},
	(t) => [
		uniqueIndex('generated_cache_content_hash_unique').on(t.contentHash),
		index('generated_cache_kind_params_hash').on(t.kind, t.paramsHash),
		index('generated_cache_kind_validated_served_at').on(t.kind, t.validated, t.servedAt),
		check('generated_cache_kind', oneOf(t.kind, CARD_KINDS))
	]
);

/**
 * Login sessions (single user). The cookie holds a random 32-byte id; only its SHA-256 hash is
 * stored here, so a copy of the database cannot be used to log in. Expiry slides forward on use.
 */
export const authSessions = sqliteTable(
	'auth_sessions',
	{
		/** sha256(cookie value), hex. */
		id: text('id').primaryKey(),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		expiresAt: integer('expires_at', { mode: 'timestamp_ms' }).notNull(),
		lastSeenAt: integer('last_seen_at', { mode: 'timestamp_ms' }).notNull()
	},
	(t) => [index('auth_sessions_expires_at').on(t.expiresAt)]
);

/**
 * One row per running job (e.g. 'prefetch'): a run takes the row, finishes by deleting it.
 * A row older than the job's stale limit counts as free (a crashed run never blocks forever).
 */
export const jobLocks = sqliteTable('job_locks', {
	name: text('name').primaryKey(),
	/** Random token of the run holding the lock; only that run releases it. */
	holder: text('holder').notNull(),
	acquiredAt: integer('acquired_at', { mode: 'timestamp_ms' }).notNull()
});

export const writingSubmissions = sqliteTable(
	'writing_submissions',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		sessionId: integer('session_id').references(() => sessions.id, { onDelete: 'set null' }),
		prompt: text('prompt').notNull(),
		userText: text('user_text').notNull(),
		correctedText: text('corrected_text'),
		errorsJson: text('errors_json', { mode: 'json' }).$type<WritingError[]>(),
		cefrEstimate: text('cefr_estimate', { enum: CEFR_LEVELS }),
		status: text('status', { enum: WRITING_STATUSES }).notNull().default('queued'),
		submittedAt: integer('submitted_at', { mode: 'timestamp_ms' }).notNull(),
		scoredAt: integer('scored_at', { mode: 'timestamp_ms' }),
		feedbackSeenAt: integer('feedback_seen_at', { mode: 'timestamp_ms' })
	},
	(t) => [
		index('writing_submissions_status').on(t.status),
		check('writing_submissions_status', oneOf(t.status, WRITING_STATUSES)),
		check('writing_submissions_cefr_estimate', oneOf(t.cefrEstimate, CEFR_LEVELS))
	]
);

// --- LLM call log -------------------------------------------------------------------------------

/**
 * One row per HTTP attempt to an LLM provider: metadata only. Prompt and response text and API
 * keys are never stored. provider_id is deliberately not a foreign key, so the log survives
 * provider deletion.
 */
export const llmCalls = sqliteTable(
	'llm_calls',
	{
		id: integer('id').primaryKey({ autoIncrement: true }),
		createdAt: integer('created_at', { mode: 'timestamp_ms' }).notNull(),
		providerId: integer('provider_id').notNull(),
		model: text('model').notNull(),
		/** What the call was for, e.g. 'cloze' or 'writing_feedback'. */
		purpose: text('purpose').notNull(),
		/** A structured mode, or 'text' for plain text generation. */
		mode: text('mode').notNull(),
		/** 1-based HTTP attempt number within one generate call (retries, repair, fallback). */
		attempt: integer('attempt').notNull(),
		ok: integer('ok', { mode: 'boolean' }).notNull(),
		httpStatus: integer('http_status'),
		errorCode: text('error_code'),
		inputTokens: integer('input_tokens'),
		outputTokens: integer('output_tokens'),
		latencyMs: integer('latency_ms').notNull()
	},
	(t) => [index('llm_calls_created_at').on(t.createdAt)]
);
