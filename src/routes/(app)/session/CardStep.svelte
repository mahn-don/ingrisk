<!--
	CardStep: one review card (choice or typing) and its feedback panel. Calls `onnext` with the
	result when the learner moves on (with the rating override, if chosen).
-->
<script lang="ts">
	import { tick } from 'svelte';
	import { fly } from 'svelte/transition';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import OptionButton from '#lib/components/OptionButton.svelte';
	import TextAnswer from '#lib/components/TextAnswer.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { type CheckResult, checkChoice, checkTyped, effectiveHintUsed, hintFor } from '#lib/session/check.js';
	import { AGAIN, EASY, GOOD, HARD, ratingFromOutcome } from '#lib/session/rating.js';
	import { NO_WORD, type SessionItem, type SessionResult } from '#lib/session/types.js';
	import type { Grade } from 'ts-fsrs';

	type Props = {
		item: SessionItem;
		last: boolean;
		/** Milliseconds since the session started (for answeredOffsetMs). */
		offsetNow: () => number;
		onnext: (result: SessionResult) => void;
		/** The answered-but-not-yet-committed result (end early keeps it). */
		pending?: SessionResult | null;
	};
	let { item, last, offsetNow, onnext, pending = $bindable(null) }: Props = $props();
	const m = t.session;

	let chosen = $state<number | null>(null);
	let typed = $state('');
	let hintShown = $state(false);
	// Choice mode: the Vietnamese sentence is behind a button, and seeing it counts as a hint (Hard).
	let meaningShown = $state(false);
	let checked = $state<CheckResult | null>(null);
	let override = $state<Grade | null>(null);
	let shownAt = 0;

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
	const cueVisible = $derived(item.viTranslation !== '' && (item.mode === 'typing' || meaningShown));

	// A new item: reset, time it from now, focus the input in typing mode.
	$effect(() => {
		void item.cardId;
		chosen = null;
		typed = '';
		hintShown = false;
		meaningShown = false;
		checked = null;
		override = null;
		pending = null;
		shownAt = performance.now();
		window.scrollTo({ top: 0 });
		if (item.mode === 'typing') tick().then(() => document.getElementById('answer')?.focus());
	});

	function record(result: CheckResult) {
		checked = result;
		pending = {
			cardId: item.cardId,
			correct: result.correct,
			mode: item.mode,
			responseMs: Math.round(performance.now() - shownAt),
			hintUsed: effectiveHintUsed(hintShown || meaningShown, result),
			answeredOffsetMs: offsetNow()
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

	function next() {
		if (pending === null) return;
		const result = override === null ? pending : { ...pending, ratingOverride: override };
		pending = null;
		onnext(result);
	}
</script>

<section class="flex flex-1 flex-col gap-6 pb-72" data-testid="session-item" data-card-id={item.cardId} data-mode={item.mode}>
	<div class="flex items-center gap-2 text-sm text-muted">
		<span>{item.mode === 'choice' ? m.chooseAnswer : m.typeAnswer}</span>
		{#if item.isMined}
			<span class="rounded-full bg-warning-soft px-2 py-0.5 text-xs font-semibold text-warning" data-testid="mined-tag">{m.minedCard}</span>
		{:else if item.isNew}
			<span class="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{m.newCard}</span>
		{/if}
	</div>
	{#if cueVisible}
		<!-- The meaning cue: always in typing mode (recall needs context), on request in choice mode. -->
		<p class="text-muted" data-testid="meaning-cue"><span class="sr-only">{m.meaningCue}: </span>{item.viTranslation}</p>
	{/if}
	<p class="font-reading text-reading" lang="en" data-testid="session-sentence">
		{item.before}<span class="mx-0.5 inline-block min-w-16 border-b-2 border-primary text-center align-baseline" role="img" aria-label={m.gap}
			>{#if hintShown && !checked}{hintFor(item.answer)}…{:else}&nbsp;{/if}</span
		>{item.after}
	</p>
	{#if item.mode === 'choice'}
		{#if item.viTranslation !== '' && !meaningShown && checked === null}
			<div><Button variant="ghost" onclick={() => (meaningShown = true)} data-testid="show-meaning">{m.showMeaning}</Button></div>
		{/if}
		<div class="flex flex-col gap-3">
			{#each item.options ?? [] as option, i (i)}
				<OptionButton
					label={option === NO_WORD ? m.noWord : option}
					state={checked === null ? 'idle' : option === item.answer ? 'correct' : chosen === i ? 'incorrect' : 'idle'}
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
	<div class="fixed inset-x-0 bottom-0 z-10" transition:fly={{ y: 240, duration: reducedMotion ? 0 : 220 }} data-testid="feedback" data-correct={checked.correct}>
		<div
			class="mx-auto flex max-h-[80dvh] max-w-md flex-col gap-3 overflow-y-auto rounded-t-2xl border border-b-0 border-border bg-surface px-4 pt-4 pb-[max(1rem,env(safe-area-inset-bottom))] shadow-[0_-8px_24px_rgb(0_0_0/0.12)]"
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
				{#if item.answer === NO_WORD}{item.filled}{:else}{item.before}<mark class="rounded bg-correct-soft px-1 font-semibold text-text">{item.answer}</mark
					>{item.after}{/if}
			</p>
			{#if item.viTranslation !== ''}<p class="text-muted">{item.viTranslation}</p>{/if}
			{#if item.answerVi}<p class="text-sm">{fill(item.isMined ? m.why : m.meaning, item.isMined ? { why: item.answerVi } : { meaning: item.answerVi })}</p>{/if}
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
							class="min-h-12 rounded-xl border-2 text-sm font-medium {shownRating === rating ? 'border-primary bg-primary-soft font-semibold' : 'border-control bg-surface'}"
							aria-pressed={override === rating}
							onclick={() => (override = rating)}>{label}</button
						>
					{/each}
				</div>
			</details>
			<Button variant="primary" full onclick={next}>{last ? m.finish : m.next}</Button>
		</div>
	</div>
{/if}
