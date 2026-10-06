// Placement results: building the row from a finished attempt, refining it when the writing is
// graded later, the profile update, and the view the result page shows.
import type { DbOrTx } from '../db/client.ts';
import { type NewPlacementResult, type PlacementResult, placementRepo } from '../db/repositories/placement.ts';
import { profileRepo } from '../db/repositories/profile.ts';
import type { PartScore, PlacementLogEntry, PlacementSubscores, ReliabilityFlag, WritingError } from '../db/schema.ts';
import { combine } from './combine.ts';
import { type Cefr, type Equivalents, cefrRank, equivalents } from './scales.ts';

/** A graded writing sample, as the placement needs it. */
export interface GradedWriting {
	cefr: Cefr;
	correctedText: string;
	errors: WritingError[];
	/** Writing: answered the task. False keeps the CEFR out of every estimate. */
	onTopic?: boolean | null;
	taskNoteVi?: string | null;
	/** Translation: the meaning came across. */
	meaningOk?: boolean | null;
}

export interface FinishedParts {
	vocabBand: number;
	falseAlarmRate: number;
	unreliable: boolean;
	/** Null when Part B was skipped. */
	clozeTheta: number | null;
	log: PlacementLogEntry[];
	/** Part B items by id: their gap type. */
	clozeTypes: ReadonlyMap<number, string>;
	writingSubmissionId: number | null;
}

const tally = (entries: readonly PlacementLogEntry[]): PartScore | null =>
	entries.length === 0 ? null : { correct: entries.filter((e) => e.correct).length, total: entries.length };

/** The result row for a finished attempt (writing not graded yet). */
export function buildResult(parts: FinishedParts, takenAt: Date): NewPlacementResult {
	const combined = combine({ vocabBand: parts.vocabBand, clozeTheta: parts.clozeTheta, writing: null });
	const b = parts.log.filter((e) => e.part === 'B');
	const typeOf = (e: PlacementLogEntry) => parts.clozeTypes.get(Number(e.item));
	const grammarByType: PlacementSubscores['grammarByType'] = {};
	for (const type of ['article', 'preposition', 'verb_form'] as const) {
		const score = tally(b.filter((e) => typeOf(e) === type));
		if (score !== null) grammarByType[type] = score;
	}
	const skipped = parts.clozeTheta === null;
	const flags: ReliabilityFlag[] = [];
	if (parts.unreliable) flags.push('many_false_alarms');
	if (skipped) flags.push('cloze_skipped');
	return {
		takenAt,
		theta: combined.theta,
		cefr: combined.cefr,
		subscoresJson: {
			vocab: parts.vocabBand,
			falseAlarmRate: parts.falseAlarmRate,
			lexical: skipped ? null : (tally(b.filter((e) => typeOf(e) === 'lexical')) ?? { correct: 0, total: 0 }),
			grammar: skipped ? null : (tally(b.filter((e) => typeOf(e) !== 'lexical')) ?? { correct: 0, total: 0 }),
			grammarByType,
			writing: null
		},
		itemLogJson: parts.log,
		writingStatus: parts.writingSubmissionId === null ? 'none' : 'queued',
		vocabBand: parts.vocabBand,
		clozeTheta: parts.clozeTheta,
		abilityBand: combined.abilityBand,
		writingSubmissionId: parts.writingSubmissionId,
		reliabilityFlags: flags
	};
}

/** The result with its writing graded: the combination re-run with the writing's CEFR. */
/** The result once its writing turned out to be off topic: scored, but the CEFR is not used. */
export function offTopicResult(result: PlacementResult): Partial<PlacementResult> {
	return {
		writingStatus: 'scored',
		reliabilityFlags: [...new Set([...result.reliabilityFlags, 'writing_off_topic' as const])]
	};
}

export function refineResult(result: PlacementResult, writing: Cefr): Partial<PlacementResult> {
	const combined = combine({ vocabBand: result.vocabBand, clozeTheta: result.clozeTheta, writing });
	return {
		writingStatus: 'scored',
		theta: combined.theta,
		cefr: combined.cefr,
		abilityBand: combined.abilityBand,
		subscoresJson: { ...result.subscoresJson, writing }
	};
}

/**
 * Copy a result into user_profile. Only the latest result counts: refining an older one (a
 * retake happened meanwhile) leaves the profile alone.
 */
export function applyResultToProfile(db: DbOrTx, profileId: number, result: PlacementResult, now: Date): boolean {
	if (placementRepo(db, profileId).latestResult()?.id !== result.id) return false;
	const eq: Equivalents = equivalents(result.cefr);
	profileRepo(db, profileId).update(
		{
			theta: result.theta,
			cefrEstimate: result.cefr,
			vstepEstimate: eq.vstep,
			// The lower end of each range: the profile holds one number per scale.
			ieltsEstimate: eq.ielts?.min ?? null,
			toeicEstimate: eq.toeic?.min ?? null,
			vocabTheta: result.vocabBand,
			grammarTheta: result.clozeTheta,
			writingTheta: result.subscoresJson.writing === null ? null : cefrRank(result.subscoresJson.writing),
			knownBandCeiling: result.vocabBand
		},
		now
	);
	return true;
}

export interface PlacementResultView {
	id: number;
	takenAt: number;
	cefr: Cefr;
	equivalents: Equivalents;
	abilityBand: number;
	vocabBand: number;
	clozeTheta: number | null;
	subscores: PlacementSubscores;
	flags: ReliabilityFlag[];
	writingStatus: PlacementResult['writingStatus'];
	previous: { id: number; takenAt: number; cefr: Cefr; abilityBand: number } | null;
}

export function resultView(db: DbOrTx, profileId: number, id: number): PlacementResultView | null {
	const repo = placementRepo(db, profileId);
	const result = repo.result(id);
	if (result === undefined) return null;
	const previous = repo.previousResult(id);
	return {
		id: result.id,
		takenAt: result.takenAt.getTime(),
		cefr: result.cefr,
		equivalents: equivalents(result.cefr),
		abilityBand: result.abilityBand,
		vocabBand: result.vocabBand,
		clozeTheta: result.clozeTheta,
		subscores: result.subscoresJson,
		flags: result.reliabilityFlags,
		writingStatus: result.writingStatus,
		previous:
			previous === undefined
				? null
				: { id: previous.id, takenAt: previous.takenAt.getTime(), cefr: previous.cefr, abilityBand: previous.abilityBand }
	};
}
