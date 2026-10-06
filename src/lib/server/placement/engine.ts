// The placement test flow: the server holds the whole state of an attempt (placement_attempts),
// serves one item at a time and checks every answer against the item it served. Scoring lives in
// the pure modules (staircase.ts, elo.ts, combine.ts); see plans/phase-08.md.
import { type PlacementView, countWords } from '../../placement.ts';
import type { DbOrTx } from '../db/client.ts';
import { type PlacementAttempt, type PoolItem, placementRepo } from '../db/repositories/placement.ts';
import { writingRepo } from '../db/repositories/writing.ts';
import type { PlacementLogEntry } from '../db/schema.ts';
import { hashString, seededPick, seededShuffle } from '../generation/random.ts';
import { tokenize } from '../generation/tokens.ts';
import type { WritingPrompt } from '../generation/writing-prompts.ts';
import { combine } from './combine.ts';
import { PART_B_ITEMS, nextBand, updateTheta } from './elo.ts';
import { applyWritingGrade } from '../grading/apply.ts';
import { type GradedWriting, applyResultToProfile, buildResult } from './results.ts';
import {
	BLOCK_SIZE,
	type Block,
	MAX_BLOCKS,
	PSEUDO_PER_BLOCK,
	REAL_PER_BLOCK,
	type Staircase,
	scorePartA,
	startStaircase,
	stepStaircase
} from './staircase.ts';

/** Part B is skipped when the bands around vocab_band hold fewer validated items than this. */
export const MIN_CLOZE_POOL = 30;
/** "The needed bands": vocab_band ± 2. */
export const POOL_BAND_RADIUS = 2;
export const WRITING_TIMEOUT_MS = 30_000;
export const MAX_WRITING_CHARS = 4000;
const MAX_RESPONSE_MS = 10 * 60_000;
const GRAMMAR_ROTATION = ['article', 'preposition', 'verb_form'] as const;

export interface PlacementContent {
	/** Part A real words per NGSL band. */
	realWords: ReadonlyMap<number, readonly string[]>;
	pseudoWords: readonly string[];
	prompts: readonly WritingPrompt[];
}

export interface WritingGradeRequest {
	prompt_vi: string;
	user_text: string;
	level_band: number;
}

export interface EngineDeps {
	db: DbOrTx;
	now: () => Date;
	content: PlacementContent;
	/** Grades the writing sample; null when no LLM provider is configured. */
	grade: ((request: WritingGradeRequest) => Promise<GradedWriting>) | null;
	gradeTimeoutMs?: number;
	/** Where a failed grading is reported (never with the learner's text). */
	logError?: (message: string, error: unknown) => void;
}

type GapType = PoolItem['gapType'];

interface State {
	v: 1;
	seed: string;
	part: 'A' | 'B' | 'C';
	/** The item being shown: only an answer to this ref is accepted. */
	current: { ref: string; servedAt: number };
	/** The ref answered last: a repeated submit of it is answered with the current state. */
	lastRef: string | null;
	a: { staircase: Staircase; blocks: Block[]; score: { vocabBand: number; falseAlarmRate: number; unreliable: boolean } | null };
	b: { skipped: boolean; theta: number; items: { id: number; band: number; type: GapType }[] } | null;
	c: { promptId: string; band: number } | null;
	log: PlacementLogEntry[];
}

export class PlacementError extends Error {
	readonly status: 400 | 404 | 409;
	readonly code: 'invalid' | 'not_found' | 'stale' | 'finished';
	constructor(status: PlacementError['status'], code: PlacementError['code'], message: string) {
		super(message);
		this.name = 'PlacementError';
		this.status = status;
		this.code = code;
	}
}

// --- Part A -------------------------------------------------------------------------------------

function newBlock(state: State, content: PlacementContent): Block {
	const band = state.a.staircase.band;
	const used = new Set(state.a.blocks.flatMap((b) => b.items.map((i) => i.word)));
	const index = state.a.blocks.length;
	const real = seededShuffle(
		(content.realWords.get(band) ?? []).filter((w) => !used.has(w)),
		`${state.seed}|A|${index}|real`
	).slice(0, REAL_PER_BLOCK);
	const pseudo = seededShuffle(
		content.pseudoWords.filter((w) => !used.has(w)),
		`${state.seed}|A|${index}|pseudo`
	).slice(0, PSEUDO_PER_BLOCK);
	const items = seededShuffle(
		[...real.map((word) => ({ word, real: true })), ...pseudo.map((word) => ({ word, real: false }))],
		`${state.seed}|A|${index}|order`
	);
	return { band, items };
}

function serveA(state: State, deps: EngineDeps): void {
	let block = state.a.blocks.at(-1);
	if (block === undefined || block.items.every((i) => i.known !== undefined)) {
		block = newBlock(state, deps.content);
		state.a.blocks.push(block);
	}
	const index = block.items.findIndex((i) => i.known === undefined);
	state.current = { ref: `A${state.a.blocks.length - 1}.${index}`, servedAt: deps.now().getTime() };
}

// --- Part B -------------------------------------------------------------------------------------

/** The next cloze item: the band nearest round(θ), then the wanted gap type, then a seeded order. */
export function pickClozeItem(pool: readonly PoolItem[], usedIds: ReadonlySet<number>, theta: number, n: number, seed: string): PoolItem | undefined {
	const target = nextBand(theta);
	const wanted: GapType = n % 2 === 0 ? 'lexical' : GRAMMAR_ROTATION[((n - 1) / 2) % GRAMMAR_ROTATION.length];
	const typeCost = (t: GapType) => (t === wanted ? 0 : (t === 'lexical') === (wanted === 'lexical') ? 1 : 2);
	let best: { item: PoolItem; key: [number, number, number] } | undefined;
	for (const item of pool) {
		if (usedIds.has(item.id)) continue;
		const key: [number, number, number] = [Math.abs(item.levelBand - target), typeCost(item.gapType), hashString(`${seed}|B|${n}|${item.id}`)];
		if (best === undefined || key[0] < best.key[0] || (key[0] === best.key[0] && (key[1] < best.key[1] || (key[1] === best.key[1] && key[2] < best.key[2])))) {
			best = { item, key };
		}
	}
	return best?.item;
}

/** Whether Part B can run: at least MIN_CLOZE_POOL validated items in vocab_band ± 2. */
export function clozePoolSufficient(pool: readonly PoolItem[], vocabBand: number): boolean {
	return pool.filter((i) => Math.abs(i.levelBand - vocabBand) <= POOL_BAND_RADIUS).length >= MIN_CLOZE_POOL;
}

function serveB(state: State, deps: EngineDeps, pool: readonly PoolItem[]): void {
	const b = state.b!;
	const item = pickClozeItem(pool, new Set(b.items.map((i) => i.id)), b.theta, b.items.length, state.seed);
	if (item === undefined) return enterC(state, deps);
	b.items.push({ id: item.id, band: item.levelBand, type: item.gapType });
	state.current = { ref: `B${b.items.length - 1}`, servedAt: deps.now().getTime() };
}

function enterB(state: State, deps: EngineDeps): void {
	const score = scorePartA(state.a.blocks);
	state.a.score = { vocabBand: score.vocabBand, falseAlarmRate: score.falseAlarmRate, unreliable: score.unreliable };
	const pool = placementRepo(deps.db).clozePool();
	if (!clozePoolSufficient(pool, score.vocabBand)) {
		state.b = { skipped: true, theta: score.vocabBand, items: [] };
		return enterC(state, deps);
	}
	state.part = 'B';
	state.b = { skipped: false, theta: score.vocabBand, items: [] };
	serveB(state, deps, pool);
}

// --- Part C -------------------------------------------------------------------------------------

/** A writing prompt for `band`: one whose range contains it, else the nearest range. */
export function pickPrompt(prompts: readonly WritingPrompt[], band: number, seed: string): WritingPrompt {
	const distance = (p: WritingPrompt) => (band < p.band_min ? p.band_min - band : band > p.band_max ? band - p.band_max : 0);
	const nearest = Math.min(...prompts.map(distance));
	const prompt = seededPick(
		prompts.filter((p) => distance(p) === nearest),
		`${seed}|C`
	);
	if (prompt === undefined) throw new Error('no writing prompts');
	return prompt;
}

function enterC(state: State, deps: EngineDeps): void {
	state.part = 'C';
	const band = combine({ vocabBand: state.a.score!.vocabBand, clozeTheta: clozeTheta(state), writing: null }).abilityBand;
	state.c = { promptId: pickPrompt(deps.content.prompts, band, state.seed).id, band };
	state.current = { ref: 'C', servedAt: deps.now().getTime() };
}

const clozeTheta = (state: State) => (state.b === null || state.b.skipped ? null : state.b.theta);

// --- Views --------------------------------------------------------------------------------------

function view(attempt: PlacementAttempt, state: State, deps: EngineDeps): PlacementView {
	const attemptId = attempt.id;
	if (attempt.status === 'completed') return { attemptId, part: 'done', resultId: attempt.resultId! };
	if (state.part === 'A') {
		const [blockIndex, itemIndex] = state.current.ref.slice(1).split('.').map(Number);
		const answered = state.a.blocks.reduce((n, b) => n + b.items.filter((i) => i.known !== undefined).length, 0);
		return {
			attemptId,
			part: 'A',
			ref: state.current.ref,
			word: state.a.blocks[blockIndex].items[itemIndex].word,
			progress: { part: 1, answered, total: MAX_BLOCKS * BLOCK_SIZE }
		};
	}
	if (state.part === 'B') {
		const b = state.b!;
		const current = b.items.at(-1)!;
		const [item] = placementRepo(deps.db).clozeItems([current.id]);
		if (item === undefined) throw new Error(`cloze item ${current.id} disappeared`);
		const token = tokenize(item.enText)[item.tokenIndex];
		return {
			attemptId,
			part: 'B',
			ref: state.current.ref,
			before: item.enText.slice(0, token.start),
			after: item.enText.slice(token.end),
			options: item.options,
			progress: { part: 2, answered: b.items.length - 1, total: PART_B_ITEMS }
		};
	}
	const prompt = deps.content.prompts.find((p) => p.id === state.c!.promptId)!;
	return {
		attemptId,
		part: 'C',
		ref: state.current.ref,
		prompt: { text: prompt.prompt_vi, hint: prompt.hint_en, minWords: prompt.min_words, maxWords: prompt.max_words },
		clozeSkipped: state.b?.skipped ?? false,
		progress: { part: 3, answered: 0, total: 1 }
	};
}

// --- Flow ---------------------------------------------------------------------------------------

const stateOf = (attempt: PlacementAttempt) => attempt.stateJson as State;

/** The attempt in progress, ready to resume; null when there is none. */
export function currentPlacement(deps: EngineDeps): PlacementView | null {
	const attempt = placementRepo(deps.db).inProgress();
	return attempt === undefined ? null : view(attempt, stateOf(attempt), deps);
}

/** Resume the attempt in progress, or start one. `restart` abandons the one in progress first. */
export function startPlacement(deps: EngineDeps, options: { restart?: boolean } = {}): PlacementView {
	const repo = placementRepo(deps.db);
	const existing = repo.inProgress();
	if (existing !== undefined && options.restart !== true) return view(existing, stateOf(existing), deps);
	const now = deps.now();
	const state: State = {
		v: 1,
		seed: '',
		part: 'A',
		current: { ref: '', servedAt: 0 },
		lastRef: null,
		a: { staircase: startStaircase(), blocks: [], score: null },
		b: null,
		c: null,
		log: []
	};
	const attempt = repo.startAttempt(now, state);
	// The seed needs the id, so every attempt sees different words and items.
	state.seed = `placement|${attempt.id}|${now.getTime()}`;
	serveA(state, deps);
	repo.saveAttempt(attempt.id, { stateJson: state });
	return view({ ...attempt, stateJson: state }, state, deps);
}

function loadForAnswer(deps: EngineDeps, attemptId: number): { attempt: PlacementAttempt; state: State } {
	const attempt = placementRepo(deps.db).attempt(attemptId);
	if (attempt === undefined) throw new PlacementError(404, 'not_found', 'no such attempt');
	return { attempt, state: stateOf(attempt) };
}

export interface AnswerInput {
	attemptId: number;
	itemRef: string;
	/** Part A: true = "Biết"; Part B: the index of the chosen option. */
	answer: boolean | number;
	responseMs: number;
}

/**
 * Record one answer and serve the next item. Only the item served last is accepted; repeating the
 * previous answer (a double tap, a retried request) returns the current state unchanged.
 */
export function answerPlacement(deps: EngineDeps, input: AnswerInput): PlacementView {
	const { attempt, state } = loadForAnswer(deps, input.attemptId);
	if (attempt.status !== 'in_progress') throw new PlacementError(409, 'finished', 'this attempt is finished');
	if (input.itemRef === state.lastRef) return view(attempt, state, deps);
	if (input.itemRef !== state.current.ref || state.part === 'C') throw new PlacementError(409, 'stale', 'not the item being shown');

	const now = deps.now().getTime();
	const timing = {
		shownAt: state.current.servedAt,
		answeredAt: now,
		responseMs: Math.round(Math.min(MAX_RESPONSE_MS, Math.max(0, input.responseMs)))
	};
	if (state.part === 'A') {
		if (typeof input.answer !== 'boolean') throw new PlacementError(400, 'invalid', 'Part A answers are true or false');
		const [blockIndex, itemIndex] = state.current.ref.slice(1).split('.').map(Number);
		const block = state.a.blocks[blockIndex];
		const item = block.items[itemIndex];
		item.known = input.answer;
		state.log.push({ part: 'A', item: item.word, band: block.band, ...timing, answer: input.answer, correct: input.answer === item.real, real: item.real });
		state.lastRef = state.current.ref;
		if (block.items.every((i) => i.known !== undefined)) {
			state.a.staircase = stepStaircase(state.a.staircase, block);
			if (state.a.staircase.done) enterB(state, deps);
			else serveA(state, deps);
		} else serveA(state, deps);
	} else {
		const b = state.b!;
		const current = b.items.at(-1)!;
		const [item] = placementRepo(deps.db).clozeItems([current.id]);
		const index = input.answer;
		if (typeof index !== 'number' || !Number.isInteger(index) || item === undefined || index < 0 || index >= item.options.length) {
			throw new PlacementError(400, 'invalid', 'Part B answers are an option index');
		}
		const chosen = item.options[index];
		const correct = chosen === item.answer;
		state.log.push({ part: 'B', item: current.id, band: current.band, ...timing, answer: chosen, correct });
		b.theta = updateTheta(b.theta, current.band, correct, b.items.length - 1);
		state.lastRef = state.current.ref;
		if (b.items.length >= PART_B_ITEMS) enterC(state, deps);
		else serveB(state, deps, placementRepo(deps.db).clozePool());
	}
	placementRepo(deps.db).saveAttempt(attempt.id, { part: state.part, stateJson: state });
	return view(attempt, state, deps);
}

/** Finish the attempt: the result row, the attempt completed, the profile updated. */
function finish(deps: EngineDeps, attempt: PlacementAttempt, state: State, writingSubmissionId: number | null): number {
	const repo = placementRepo(deps.db);
	const now = deps.now();
	const score = state.a.score!;
	const result = repo.insertResult(
		buildResult(
			{
				vocabBand: score.vocabBand,
				falseAlarmRate: score.falseAlarmRate,
				unreliable: score.unreliable,
				clozeTheta: clozeTheta(state),
				log: state.log,
				clozeTypes: new Map((state.b?.items ?? []).map((i) => [i.id, i.type])),
				writingSubmissionId
			},
			now
		)
	);
	state.lastRef = state.current.ref;
	repo.completeAttempt(attempt.id, result.id, now, state);
	applyResultToProfile(deps.db, result, now);
	return result.id;
}

export type WritingInput = { attemptId: number; text: string } | { attemptId: number; skip: true };

/**
 * Part C. Skipping finishes without writing. Otherwise the text is always stored (queued) and the
 * attempt completed first; then grading runs for at most 30 s. A grade that arrives in time (or
 * later) refines the result; a failure leaves it queued for gradeQueuedWritings.
 */
export async function submitPlacementWriting(deps: EngineDeps, input: WritingInput): Promise<{ resultId: number }> {
	const { attempt, state } = loadForAnswer(deps, input.attemptId);
	if (attempt.status === 'completed') return { resultId: attempt.resultId! };
	if (attempt.status !== 'in_progress') throw new PlacementError(409, 'finished', 'this attempt is finished');
	if (state.part !== 'C') throw new PlacementError(409, 'stale', 'the writing part has not started');
	if ('skip' in input) return { resultId: finish(deps, attempt, state, null) };

	const text = input.text.trim();
	if (countWords(text) === 0 || text.length > MAX_WRITING_CHARS) throw new PlacementError(400, 'invalid', 'empty or too long');
	const prompt = deps.content.prompts.find((p) => p.id === state.c!.promptId)!;
	const submission = writingRepo(deps.db).queue({ sessionId: null, prompt: prompt.prompt_vi, userText: text, submittedAt: deps.now() });
	const resultId = finish(deps, attempt, state, submission.id);
	if (deps.grade !== null) await gradeWithin(deps, submission.id, { prompt_vi: prompt.prompt_vi, user_text: text, level_band: state.c!.band });
	return { resultId };
}

async function gradeWithin(deps: EngineDeps, submissionId: number, request: WritingGradeRequest): Promise<void> {
	const graded = deps.grade!(request).then(
		(grade) => {
			applyWritingGrade(deps.db, submissionId, grade, deps.now());
		},
		(error: unknown) => deps.logError?.('placement writing not graded; it stays queued', error)
	);
	let timer: ReturnType<typeof setTimeout> | undefined;
	const timeout = new Promise<void>((resolve) => {
		timer = setTimeout(resolve, deps.gradeTimeoutMs ?? WRITING_TIMEOUT_MS);
	});
	await Promise.race([graded, timeout]);
	clearTimeout(timer);
}

/** For Home: whether to offer the test, resume it, or nothing. */
export function placementOverview(db: DbOrTx): { completed: boolean; inProgress: boolean } {
	const repo = placementRepo(db);
	return { completed: repo.resultCount() > 0, inProgress: repo.inProgress() !== undefined };
}
