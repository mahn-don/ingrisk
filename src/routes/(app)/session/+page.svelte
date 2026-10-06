<script lang="ts">
	import { onMount } from 'svelte';
	import { fly } from 'svelte/transition';
	import Button from '#lib/components/Button.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LoadingState from '#lib/components/LoadingState.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { newClientSessionId } from '#lib/session/client-id.js';
	import { describeInterval } from '#lib/session/interval.js';
	import type {
		Anchor,
		AnchorResult,
		DrillItem,
		DrillResult,
		EmptyReason,
		FeedbackCard,
		FinishSummary,
		SessionItem,
		SessionResult,
		SessionShape,
		StartResponse
	} from '#lib/session/types.js';
	import CardStep from './CardStep.svelte';
	import DrillStep from './DrillStep.svelte';
	import FeedbackView from './FeedbackView.svelte';
	import ReadingStep from './ReadingStep.svelte';
	import WritingStep from './WritingStep.svelte';

	let { data } = $props();
	const m = t.session;

	type Step = { kind: 'card'; item: SessionItem } | { kind: 'drill'; drill: DrillItem } | { kind: 'anchor'; anchor: Anchor };
	type Phase = 'loading' | 'startError' | 'feedback' | 'empty' | 'step' | 'saving' | 'saveError' | 'done';
	let phase = $state<Phase>('loading');
	let reason = $state<EmptyReason>('all_done');
	let shape = $state<SessionShape>('quick');
	let sessionId = $state(0);
	let feedback = $state<FeedbackCard[]>([]);
	let feedbackIndex = $state(0);
	let steps = $state<Step[]>([]);
	let index = $state(0);
	let summary = $state<FinishSummary | null>(null);
	let confirmExit = $state(false);
	// What the finish request sends.
	const results: SessionResult[] = [];
	const drillResults: DrillResult[] = [];
	let readingAnswers = $state<number[]>([]);
	let writingSubmitted = $state(false);
	let pendingCard = $state<SessionResult | null>(null);
	const clientSessionId = newClientSessionId();
	// Offsets count from the start response's arrival (never the device's wall clock).
	let t0 = 0;
	const offsetNow = () => Math.max(results.at(-1)?.answeredOffsetMs ?? 0, Math.round(performance.now() - t0));

	const step = $derived(steps[index]);
	const isLast = $derived(index === steps.length - 1);
	const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const interval = (value: number, unit: keyof typeof m.units) => fill(m.units[unit], { n: String(value).replace('.', ',') });

	async function start() {
		phase = 'loading';
		try {
			const body: Record<string, unknown> = {};
			if (data.budgetMin !== null) body.budgetMin = data.budgetMin;
			if (data.shape !== null) body.shape = data.shape;
			if (data.focus !== null) body.focus = data.focus;
			const response = await fetch('/api/session/start', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (response.status === 401) return void (window.location.href = `/login?next=${encodeURIComponent('/session')}`);
			if (!response.ok) throw new Error(String(response.status));
			const started = (await response.json()) as StartResponse;
			t0 = performance.now();
			shape = started.shape;
			feedback = started.feedback;
			if (started.sessionId === null) reason = started.reason;
			else {
				sessionId = started.sessionId;
				steps = [
					...started.items.map((item) => ({ kind: 'card' as const, item })),
					...started.drills.map((drill) => ({ kind: 'drill' as const, drill })),
					...(started.anchor === null ? [] : [{ kind: 'anchor' as const, anchor: started.anchor }])
				];
			}
			phase = feedback.length > 0 ? 'feedback' : started.sessionId === null ? 'empty' : 'step';
		} catch {
			phase = 'startError';
		}
	}

	/** Unseen feedback: dismissed one by one (marked seen), then the session. */
	async function dismissFeedback() {
		const card = feedback[feedbackIndex];
		void fetch('/api/session/feedback', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ submissionId: card.submissionId }) }).catch(() => {});
		if (feedbackIndex + 1 < feedback.length) feedbackIndex++;
		else phase = steps.length > 0 ? 'step' : 'empty';
		window.scrollTo({ top: 0 });
	}

	async function advance() {
		if (index + 1 < steps.length) {
			index++;
			window.scrollTo({ top: 0 });
		} else await finish();
	}

	function onCard(result: SessionResult) {
		results.push(result);
		advance();
	}

	function onDrill(result: DrillResult) {
		drillResults.push(result);
		advance();
	}

	function anchorResult(): AnchorResult | undefined {
		const anchor = steps.find((s) => s.kind === 'anchor');
		if (anchor === undefined || anchor.kind !== 'anchor') return undefined;
		if (anchor.anchor.type === 'reading') return { type: 'reading', cacheId: anchor.anchor.cacheId, answers: readingAnswers.filter((a) => a !== undefined) };
		return writingSubmitted ? { type: anchor.anchor.type } : undefined;
	}

	async function finish() {
		// Ending early keeps an answered card the learner has not moved past yet.
		if (pendingCard !== null) {
			results.push(pendingCard);
			pendingCard = null;
		}
		confirmExit = false;
		phase = 'saving';
		try {
			const anchor = anchorResult();
			const response = await fetch('/api/session/finish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, clientSessionId, results, drills: drillResults, ...(anchor === undefined ? {} : { anchor }) })
			});
			if (!response.ok) throw new Error(String(response.status));
			summary = (await response.json()) as FinishSummary;
			phase = 'done';
		} catch {
			phase = 'saveError';
		}
	}

	const nextDue = (s: FinishSummary) => {
		if (s.nextDueAt === null) return null;
		const ms = s.nextDueAt - Date.now();
		if (ms <= 60_000) return m.doneNextNow;
		const i = describeInterval(ms);
		return fill(m.doneNext, { when: interval(i.value, i.unit) });
	};
	const anchorLine = (s: FinishSummary) => {
		const a = s.anchor;
		if (a === undefined || a === null) return null;
		if (a.type === 'reading') return fill(m.doneReading, { correct: a.correct, total: a.total });
		return a.status === 'scored' ? m.doneWritingScored : a.status === 'queued' ? m.doneWritingQueued : m.doneWritingSkipped;
	};

	onMount(start);
</script>

<svelte:head>
	<title>{m.title} · {t.app.name}</title>
</svelte:head>

<!-- Full screen: no tab bar, one exit. -->
<div class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
	<header class="flex flex-col gap-3">
		<div class="flex items-center justify-between gap-3">
			<h1 class="text-lg font-semibold">
				{#if phase === 'step' || phase === 'saving' || phase === 'saveError'}{fill(m.progress, { n: index + 1, total: steps.length })}
					<span class="ml-1 text-sm font-normal text-muted" data-testid="session-shape">· {m.shapes[shape]}</span>{:else}{m.title}{/if}
			</h1>
			{#if phase === 'step'}
				<button
					type="button"
					class="-mr-2 flex size-12 items-center justify-center rounded-full text-muted"
					aria-label={m.exit}
					aria-expanded={confirmExit}
					aria-controls="exit-sheet"
					onclick={() => (confirmExit = true)}
					data-testid="session-exit"
				>
					<Icon name="close" />
				</button>
			{:else}
				<a href="/" class="-mr-2 flex size-12 items-center justify-center rounded-full text-muted" aria-label={m.exit}><Icon name="close" /></a>
			{/if}
		</div>
		{#if phase === 'step'}
			<!-- Progress by steps, never a countdown. -->
			<ProgressBar value={index} max={steps.length} label={t.states.progress} />
		{/if}
	</header>

	<main id="main" class="flex flex-1 flex-col pt-6">
		{#if phase === 'loading'}
			<div class="flex flex-1 items-center justify-center"><LoadingState label={m.starting} /></div>
		{:else if phase === 'startError'}
			<ErrorState message={m.startError} onretry={start} />
		{:else if phase === 'feedback'}
			<section class="flex flex-1 flex-col gap-4" data-testid="session-feedback">
				<p class="text-muted">{m.feedback.intro}</p>
				{#key feedbackIndex}<FeedbackView card={feedback[feedbackIndex]} />{/key}
				<div class="mt-auto pt-4"><Button variant="primary" full onclick={dismissFeedback}>{m.feedback.dismiss}</Button></div>
			</section>
		{:else if phase === 'empty'}
			<div class="flex flex-1 items-center justify-center" data-testid="session-empty">
				<EmptyState title={m.empty[reason].title} body={m.empty[reason].body}>
					{#snippet action()}<Button variant="secondary" full href="/">{m.backHome}</Button>{/snippet}
				</EmptyState>
			</div>
		{:else if phase === 'step' && step}
			{#if step.kind === 'card'}
				<CardStep item={step.item} last={isLast} {offsetNow} onnext={onCard} bind:pending={pendingCard} />
			{:else if step.kind === 'drill'}
				{#key step.drill.cacheId}<DrillStep drill={step.drill} last={isLast} ondone={onDrill} />{/key}
			{:else if step.anchor.type === 'reading'}
				<ReadingStep anchor={step.anchor} {sessionId} last={isLast} bind:answers={readingAnswers} ondone={advance} />
			{:else}
				<WritingStep anchor={step.anchor} {sessionId} last={isLast} bind:submitted={writingSubmitted} ondone={advance} />
			{/if}

			{#if confirmExit}
				<div class="fixed inset-0 z-20 flex items-end bg-black/40">
					<div
						id="exit-sheet"
						role="alertdialog"
						aria-modal="true"
						aria-labelledby="exit-title"
						aria-describedby="exit-body"
						class="mx-auto flex w-full max-w-md flex-col gap-3 rounded-t-2xl bg-surface px-4 pt-5 pb-[max(1rem,env(safe-area-inset-bottom))]"
						transition:fly={{ y: 240, duration: reducedMotion ? 0 : 200 }}
					>
						<h2 id="exit-title" class="text-lg font-semibold">{m.exitTitle}</h2>
						<p id="exit-body" class="text-muted">{m.exitBody}</p>
						<Button variant="primary" full onclick={finish}>{m.endEarly}</Button>
						<Button variant="secondary" full onclick={() => (confirmExit = false)}>{m.keepGoing}</Button>
						<Button variant="ghost" full href="/">{m.discard}</Button>
					</div>
				</div>
			{/if}
		{:else if phase === 'saving'}
			<div class="flex flex-1 items-center justify-center"><LoadingState label={m.saving} /></div>
		{:else if phase === 'saveError'}
			<ErrorState message={m.saveError} onretry={finish} />
		{:else if phase === 'done' && summary}
			<section class="flex flex-1 flex-col gap-5" data-testid="session-done">
				<h2 class="text-2xl font-bold">{m.doneTitle}</h2>
				<p data-testid="done-answered">
					{summary.answered === 0
						? m.doneNone
						: fill(m.doneAnswered, { answered: summary.answered, correct: summary.correct, percent: Math.round(summary.accuracy * 100) })}
				</p>
				<ul class="grid grid-cols-3 gap-3">
					{#each [[summary.strengthened, m.doneStrengthened, 'done-strengthened'], [summary.newIntroduced, m.doneNew, 'done-new'], [summary.todayMinutes, m.doneToday, 'done-minutes']] as [value, label, testid] (testid)}
						<li class="flex flex-col items-center gap-1 rounded-2xl border border-border bg-surface px-2 py-4 text-center">
							<span class="text-3xl font-bold tabular-nums" data-testid={testid}>{value}</span>
							<span class="text-xs text-muted">{label}</span>
						</li>
					{/each}
				</ul>
				<ul class="flex flex-col gap-1">
					{#if anchorLine(summary)}<li data-testid="done-anchor">{anchorLine(summary)}</li>{/if}
					{#if summary.drillsTotal}<li data-testid="done-drills">{fill(m.doneDrills, { correct: summary.drillsCorrect ?? 0, total: summary.drillsTotal })}</li>{/if}
					{#if summary.minedErrors}<li class="font-semibold text-primary" data-testid="done-mined">{fill(m.doneMined, { n: summary.minedErrors })}</li>{/if}
				</ul>
				{#if nextDue(summary)}<p class="text-muted">{nextDue(summary)}</p>{/if}
				<div class="mt-auto pt-6"><Button variant="primary" full href="/">{m.backHome}</Button></div>
			</section>
		{/if}
	</main>
</div>
