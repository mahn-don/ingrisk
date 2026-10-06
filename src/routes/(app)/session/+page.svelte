<script lang="ts">
	import { onMount, tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import Button from '#lib/components/Button.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import LoadingState from '#lib/components/LoadingState.svelte';
	import OptionButton from '#lib/components/OptionButton.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import TextAnswer from '#lib/components/TextAnswer.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { type CheckResult, checkChoice, checkTyped, effectiveHintUsed, hintFor } from '#lib/session/check.js';
	import { newClientSessionId } from '#lib/session/client-id.js';
	import { describeInterval } from '#lib/session/interval.js';
	import { AGAIN, EASY, GOOD, HARD, ratingFromOutcome } from '#lib/session/rating.js';
	import { type EmptyReason, type FinishSummary, NO_WORD, type SessionItem, type SessionResult, type StartResponse } from '#lib/session/types.js';
	import type { Grade } from 'ts-fsrs';

	let { data } = $props();
	const m = t.session;

	type Phase = 'loading' | 'startError' | 'empty' | 'item' | 'saving' | 'saveError' | 'done';
	let phase = $state<Phase>('loading');
	let reason = $state<EmptyReason>('all_done');
	let sessionId = 0;
	let items = $state<SessionItem[]>([]);
	let index = $state(0);
	const results: SessionResult[] = [];
	let summary = $state<FinishSummary | null>(null);
	const clientSessionId = newClientSessionId();
	// Offsets count from the start response's arrival (never the device's wall clock).
	let t0 = 0;
	let shownAt = 0;

	// The current item's state.
	let chosen = $state<number | null>(null);
	let typed = $state('');
	let hintShown = $state(false);
	let checked = $state<CheckResult | null>(null);
	let pending = $state<SessionResult | null>(null);
	let override = $state<Grade | null>(null);
	let confirmExit = $state(false);

	const item = $derived(items[index]);
	const reducedMotion = typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
	const ratingLabels: [Grade, string][] = [
		[AGAIN, m.again],
		[HARD, m.hard],
		[GOOD, m.good],
		[EASY, m.easy]
	];
	const autoRating = $derived(pending === null ? null : ratingFromOutcome(pending));
	const shownRating = $derived(override ?? autoRating);
	const interval = (value: number, unit: keyof typeof m.units) => fill(m.units[unit], { n: String(value).replace('.', ',') });

	async function start() {
		phase = 'loading';
		try {
			const response = await fetch('/api/session/start', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify(data.budgetMin === null ? {} : { budgetMin: data.budgetMin })
			});
			if (response.status === 401) return void (window.location.href = `/login?next=${encodeURIComponent('/session')}`);
			if (!response.ok) throw new Error(String(response.status));
			const body = (await response.json()) as StartResponse;
			t0 = performance.now();
			if (body.sessionId === null) {
				reason = body.reason;
				phase = 'empty';
				return;
			}
			sessionId = body.sessionId;
			items = body.items;
			showItem(0);
		} catch {
			phase = 'startError';
		}
	}

	async function showItem(i: number) {
		index = i;
		chosen = null;
		typed = '';
		hintShown = false;
		checked = null;
		pending = null;
		override = null;
		phase = 'item';
		window.scrollTo({ top: 0 });
		await tick();
		shownAt = performance.now();
		if (items[i].mode === 'typing') document.getElementById('answer')?.focus();
	}

	function record(result: CheckResult) {
		const now = performance.now();
		checked = result;
		pending = {
			cardId: item.cardId,
			correct: result.correct,
			mode: item.mode,
			responseMs: Math.round(now - shownAt),
			hintUsed: effectiveHintUsed(hintShown, result),
			answeredOffsetMs: Math.max(results.at(-1)?.answeredOffsetMs ?? 0, Math.round(now - t0))
		};
	}

	function choose(i: number) {
		if (checked !== null) return;
		chosen = i;
		record(checkChoice(item.options![i], item.answer));
	}

	function checkTyping(event?: Event) {
		event?.preventDefault();
		if (checked !== null || typed.trim() === '') return;
		record(checkTyped(typed, item.answer));
	}

	/** Keep the answered item (with the rating override, if any). */
	function commit() {
		if (pending === null) return;
		results.push(override === null ? pending : { ...pending, ratingOverride: override });
		pending = null;
	}

	async function next() {
		commit();
		if (index + 1 < items.length) await showItem(index + 1);
		else await finish();
	}

	async function finish() {
		commit();
		confirmExit = false;
		phase = 'saving';
		try {
			const response = await fetch('/api/session/finish', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, clientSessionId, results })
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
				{#if phase === 'item' || phase === 'saving' || phase === 'saveError'}{fill(m.progress, { n: index + 1, total: items.length })}{:else}{m.title}{/if}
			</h1>
			{#if phase === 'item'}
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
				<a href="/" class="-mr-2 flex size-12 items-center justify-center rounded-full text-muted" aria-label={m.exit}>
					<Icon name="close" />
				</a>
			{/if}
		</div>
		{#if phase === 'item'}
			<!-- Progress by items, never a countdown. -->
			<ProgressBar value={index + (checked ? 1 : 0)} max={items.length} label={t.states.progress} />
		{/if}
	</header>

	<main id="main" class="flex flex-1 flex-col pt-6">
		{#if phase === 'loading'}
			<div class="flex flex-1 items-center justify-center"><LoadingState label={m.starting} /></div>
		{:else if phase === 'startError'}
			<ErrorState message={m.startError} onretry={start} />
		{:else if phase === 'empty'}
			<div class="flex flex-1 items-center justify-center" data-testid="session-empty">
				<EmptyState
					title={reason === 'no_content' ? m.emptyNoContentTitle : m.emptyDoneTitle}
					body={reason === 'no_content' ? m.emptyNoContent : m.emptyDone}
				>
					{#snippet action()}<Button variant="secondary" full href="/">{m.backHome}</Button>{/snippet}
				</EmptyState>
			</div>
		{:else if phase === 'item' && item}
			<section class="flex flex-1 flex-col gap-6 pb-72" data-testid="session-item" data-card-id={item.cardId} data-mode={item.mode}>
				<div class="flex items-center gap-2 text-sm text-muted">
					<span>{item.mode === 'choice' ? m.chooseAnswer : m.typeAnswer}</span>
					{#if item.isNew}<span class="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{m.newCard}</span>{/if}
				</div>
				<p class="font-reading text-reading" lang="en" data-testid="session-sentence">
					{item.before}<span class="mx-0.5 inline-block min-w-16 border-b-2 border-primary text-center align-baseline" role="img" aria-label={m.gap}
						>{#if hintShown && !checked}{hintFor(item.answer)}…{:else}&nbsp;{/if}</span
					>{item.after}
				</p>
				{#if item.mode === 'choice'}
					<div class="flex flex-col gap-3">
						{#each item.options ?? [] as option, i (i)}
							<OptionButton
								label={option === NO_WORD ? m.noWord : option}
								state={checked === null
									? 'idle'
									: option === item.answer
										? 'correct'
										: chosen === i
											? 'incorrect'
											: 'idle'}
								disabled={checked !== null}
								onclick={() => choose(i)}
							/>
						{/each}
					</div>
				{:else}
					<form class="flex flex-col gap-3" onsubmit={checkTyping}>
						<TextAnswer label={m.yourAnswer} bind:value={typed} invalid={checked !== null && !checked.correct} readonly={checked !== null} />
						{#if hintShown}<p class="text-sm text-muted" data-testid="hint">{fill(m.hintText, { letter: hintFor(item.answer) })}</p>{/if}
						<div class="grid grid-cols-2 gap-2">
							<Button variant="secondary" disabled={hintShown || checked !== null} onclick={() => (hintShown = true)}>{m.hint}</Button>
							<Button type="submit" variant="primary" disabled={typed.trim() === '' || checked !== null}>{m.check}</Button>
						</div>
					</form>
				{/if}
			</section>

			{#if checked && pending}
				<!-- The feedback slides up from the bottom (no motion when reduced motion is asked for). -->
				<div
					class="fixed inset-x-0 bottom-0 z-10"
					transition:fly={{ y: 240, duration: reducedMotion ? 0 : 220 }}
					data-testid="feedback"
					data-correct={checked.correct}
				>
					<div
						class="mx-auto flex max-w-md flex-col gap-3 rounded-t-2xl border border-b-0 border-border bg-surface px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.12)]"
						role="status"
						aria-live="polite"
					>
						<p class="flex items-center gap-2 text-lg font-semibold {checked.correct ? 'text-correct' : 'text-incorrect'}">
							<Icon name={checked.correct ? 'check' : 'cross'} />
							{checked.correct ? m.correct : m.incorrect}
						</p>
						{#if checked.typo}
							<p class="text-sm" data-testid="typo">{fill(m.typo, { answer: item.answer })}</p>
						{:else if !checked.correct}
							<p class="text-sm">{fill(m.rightAnswer, { answer: item.answer === NO_WORD ? m.noWord : item.answer })}</p>
						{/if}
						<p class="font-reading text-reading" lang="en">
							{#if item.answer === NO_WORD}{item.filled}{:else}{item.before}<mark class="rounded bg-correct-soft px-1 font-semibold text-text"
									>{item.answer}</mark
								>{item.after}{/if}
						</p>
						<p class="text-muted">{item.viTranslation}</p>
						{#if item.answerVi}<p class="text-sm">{fill(m.meaning, { meaning: item.answerVi })}</p>{/if}
						{#if shownRating !== null}
							<p class="text-xs text-muted" data-testid="next-review">
								{fill(m.nextReview, { interval: interval(item.intervals[shownRating].value, item.intervals[shownRating].unit) })}
							</p>
						{/if}
						<details class="text-sm">
							<summary class="cursor-pointer text-muted">{m.regrade}</summary>
							<p class="mt-2 text-xs text-muted">{m.regradeHint}</p>
							<div class="mt-2 grid grid-cols-4 gap-2" role="group" aria-label={m.regrade}>
								{#each ratingLabels as [rating, label] (rating)}
									<button
										type="button"
										class="min-h-12 rounded-xl border-2 text-sm font-medium {shownRating === rating
											? 'border-primary bg-primary-soft font-semibold'
											: 'border-control bg-surface'}"
										aria-pressed={override === rating}
										onclick={() => (override = rating)}>{label}</button
									>
								{/each}
							</div>
						</details>
						<Button variant="primary" full onclick={next}>{index + 1 < items.length ? m.next : m.finish}</Button>
					</div>
				</div>
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
				{#if nextDue(summary)}<p class="text-muted">{nextDue(summary)}</p>{/if}
				<div class="mt-auto pt-6"><Button variant="primary" full href="/">{m.backHome}</Button></div>
			</section>
		{/if}
	</main>
</div>
