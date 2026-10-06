<!--
	FeedbackView: graded writing or translation (unseen feedback at session start, or the anchor's
	own feedback). The corrected text, with what changed highlighted, only in direct feedback mode.
-->
<script lang="ts">
	import Card from '#lib/components/Card.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { changedWords } from '#lib/session/diff.js';
	import type { FeedbackCard } from '#lib/session/types.js';

	let { card }: { card: FeedbackCard } = $props();
	const m = t.session.feedback;
	const title = $derived(card.taskKind === 'translation' ? m.translationTitle : card.placement ? m.placementTitle : m.title);
	const segments = $derived(card.correctedText === null ? [] : changedWords(card.userText, card.correctedText));
</script>

<Card title={title}>
	<div class="flex flex-col gap-3" data-testid="feedback-card" data-submission={card.submissionId}>
		{#if card.onTopic === false}
			<p class="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2" data-testid="off-topic">
				<span class="text-warning"><Icon name="alert" size={20} /></span>
				<span><strong>{m.offTopic}.</strong> {card.taskNoteVi ?? ''}</span>
			</p>
		{/if}
		<div>
			<p class="text-xs font-semibold text-muted">{card.taskKind === 'translation' ? m.source : m.task}</p>
			<p>{card.prompt}</p>
		</div>
		<div>
			<p class="text-xs font-semibold text-muted">{m.yours}</p>
			<p class="font-reading" lang="en">{card.userText}</p>
		</div>
		{#if card.correctedText !== null && card.correctedText.trim() !== card.userText.trim()}
			<div>
				<p class="text-xs font-semibold text-muted">{m.corrected}</p>
				<p class="font-reading" lang="en" data-testid="corrected">
					{#each segments as segment, i (i)}{#if segment.changed}<mark class="rounded bg-correct-soft px-0.5 font-semibold text-text">{segment.text}</mark
							>{:else}{segment.text}{/if}{/each}
				</p>
			</div>
		{/if}
		<div>
			<p class="text-xs font-semibold text-muted">{m.errors}</p>
			{#if card.errors.length === 0}
				<p>{m.noErrors}</p>
			{:else}
				<ul class="flex flex-col gap-2">
					{#each card.errors as error, i (i)}
						<li class="rounded-xl bg-surface-2 px-3 py-2">
							<p class="text-sm font-semibold">
								{error.topicNameVi}{#if error.repeats > 1}<span class="font-normal text-muted" data-testid="error-repeats"> · {fill(m.repeated, { n: error.repeats })}</span>{/if}
							</p>
							<p class="font-reading" lang="en"><s>{error.original}</s> → <strong>{error.correction}</strong></p>
							<p class="text-sm">{error.explanationVi}</p>
						</li>
					{/each}
				</ul>
				{#if card.totalErrors > card.errors.length}<p class="mt-1 text-xs text-muted">{fill(m.moreErrors, { n: card.totalErrors - card.errors.length })}</p>{/if}
			{/if}
		</div>
		{#if card.taskKind === 'translation'}
			<p data-testid="meaning-ok">{card.meaningOk === false ? m.meaningNotOk : m.meaningOk}</p>
			{#if card.referenceEn}
				<p class="text-sm" data-testid="reference">{m.reference} <span class="font-reading" lang="en">{card.referenceEn}</span></p>
				<p class="text-xs text-muted">{m.referenceNote}</p>
			{/if}
		{/if}
		{#if card.cefr && card.onTopic !== false}<p class="text-sm text-muted">{fill(m.level, { cefr: card.cefr })}</p>{/if}
		{#if card.mined > 0}<p class="text-sm font-semibold text-primary" data-testid="mined-count">{fill(m.mined, { n: card.mined })}</p>{/if}
	</div>
</Card>
