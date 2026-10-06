<!--
	ReadingStep: the read anchor. The passage with its glossary words underlined (tap: the meaning,
	and the add-to-reviews button when a review item exists), then the 2 questions one by one, each with
	feedback and its explanation.
-->
<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import OptionButton from '#lib/components/OptionButton.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { glossarySegments } from '#lib/session/glossary.js';
	import type { Anchor } from '#lib/session/types.js';

	type Reading = Extract<Anchor, { type: 'reading' }>;
	type Props = { anchor: Reading; sessionId: number; last: boolean; answers: number[]; ondone: () => void };
	let { anchor, sessionId, last, answers = $bindable([]), ondone }: Props = $props();
	const m = t.session.reading;

	const segments = $derived(glossarySegments(anchor.passage, anchor.glossary.map((g) => g.word)));
	let open = $state<string | null>(null);
	let added = $state<Record<string, 'added' | 'failed'>>({});
	let phase = $state<'passage' | 'questions'>('passage');
	let index = $state(0);
	const entry = $derived(anchor.glossary.find((g) => g.word === open));
	const question = $derived(anchor.questions[index]);
	const answered = $derived(answers[index] !== undefined);

	async function add(word: string) {
		try {
			const response = await fetch('/api/session/glossary', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, word })
			});
			added[word] = response.ok ? 'added' : 'failed';
		} catch {
			added[word] = 'failed';
		}
	}

	function answer(i: number) {
		if (answered) return;
		answers[index] = i;
	}

	function next() {
		if (index + 1 < anchor.questions.length) index++;
		else ondone();
	}
</script>

<section class="flex flex-1 flex-col gap-5" data-testid="reading">
	<p class="text-sm text-muted">{m.label}</p>
	{#if phase === 'passage'}
		<h2 class="font-reading text-xl font-semibold" lang="en">{anchor.title}</h2>
		<p class="font-reading text-reading" lang="en" data-testid="passage">
			{#each segments as segment, i (i)}{#if 'word' in segment}<button
						type="button"
						class="cursor-pointer underline decoration-primary decoration-2 underline-offset-4"
						aria-expanded={open === segment.word}
						aria-controls="glossary-popover"
						onclick={() => (open = open === segment.word ? null : segment.word)}>{segment.text}</button
					>{:else}{segment.text}{/if}{/each}
		</p>
		{#if anchor.glossary.length > 0}<p class="text-xs text-muted">{m.glossaryHint}</p>{/if}
		{#if entry}
			<div id="glossary-popover" role="dialog" aria-label={entry.word} class="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4 shadow-md" data-testid="glossary-popover">
				<div class="flex items-start justify-between gap-2">
					<p><strong class="font-reading" lang="en">{entry.word}</strong>: {entry.vi}</p>
					<button type="button" class="-m-2 flex size-10 shrink-0 items-center justify-center rounded-full text-muted" aria-label={m.close} onclick={() => (open = null)}>
						<Icon name="close" size={20} />
					</button>
				</div>
				{#if entry.addable}
					{#if added[entry.word] === 'added'}
						<p class="flex items-center gap-1 text-sm font-semibold text-correct"><Icon name="check" size={18} />{m.added}</p>
					{:else}
						<Button variant="secondary" onclick={() => add(entry.word)}>{m.add}</Button>
						{#if added[entry.word] === 'failed'}<p class="text-sm text-incorrect">{m.addFailed}</p>{/if}
					{/if}
				{/if}
			</div>
		{/if}
		<div class="mt-auto pt-4"><Button variant="primary" full onclick={() => ((phase = 'questions'), (open = null), window.scrollTo({ top: 0 }))}>{m.toQuestions}</Button></div>
	{:else}
		<p class="text-sm font-semibold text-muted">{fill(m.question, { n: index + 1, total: anchor.questions.length })}</p>
		<p class="font-reading text-reading" lang="en" data-testid="reading-question">{question.question}</p>
		<div class="flex flex-col gap-3">
			{#each question.options as option, i (i)}
				<OptionButton
					label={option}
					state={!answered ? 'idle' : i === question.answerIndex ? 'correct' : answers[index] === i ? 'incorrect' : 'idle'}
					disabled={answered}
					onclick={() => answer(i)}
				/>
			{/each}
		</div>
		{#if answered}
			<div class="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4" role="status" data-testid="reading-feedback">
				<p class="flex items-center gap-2 font-semibold {answers[index] === question.answerIndex ? 'text-correct' : 'text-incorrect'}">
					<Icon name={answers[index] === question.answerIndex ? 'check' : 'cross'} />{answers[index] === question.answerIndex ? m.correct : m.incorrect}
				</p>
				<p class="text-sm">{question.explanationVi}</p>
				<Button variant="primary" full onclick={next}>{index + 1 === anchor.questions.length && last ? t.session.finish : t.session.next}</Button>
			</div>
		{/if}
	{/if}
</section>
