<!--
	DrillStep: a one-off error drill. The sentence with the error is prefilled for editing; the
	answer is right when it normalizes to the correction (final punctuation ignored).
-->
<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { checkDrill } from '#lib/session/check.js';
	import type { DrillItem, DrillResult } from '#lib/session/types.js';

	let { drill, last, ondone }: { drill: DrillItem; last: boolean; ondone: (result: DrillResult) => void } = $props();
	const m = t.session.drill;

	// svelte-ignore state_referenced_locally
	let text = $state(drill.sentenceWithError);
	let correct = $state<boolean | null>(null);
	let responseMs = 0;
	const shownAt = performance.now();

	function check(event: Event) {
		event.preventDefault();
		if (correct !== null) return;
		responseMs = Math.round(performance.now() - shownAt);
		correct = checkDrill(text, drill.corrected);
	}
</script>

<section class="flex flex-1 flex-col gap-5" data-testid="drill" data-cache-id={drill.cacheId}>
	<p class="flex items-center gap-2 text-sm text-muted">
		<span>{m.label}</span><span class="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{drill.topicNameVi}</span>
	</p>
	<p class="font-reading text-reading" lang="en">{drill.sentenceWithError}</p>
	<form class="flex flex-col gap-3" onsubmit={check}>
		<label class="flex flex-col gap-2" for="drill-text">
			<span class="text-sm font-semibold">{m.question}</span>
			<textarea
				id="drill-text"
				lang="en"
				rows="3"
				spellcheck="false"
				autocapitalize="off"
				class="w-full rounded-xl border-2 border-control bg-surface px-4 py-3 font-reading text-reading text-text"
				bind:value={text}
				readonly={correct !== null}
				aria-label={m.input}
			></textarea>
		</label>
		{#if correct === null}<Button type="submit" variant="primary" full disabled={text.trim() === ''}>{m.check}</Button>{/if}
	</form>
	{#if correct !== null}
		<div class="flex flex-col gap-2 rounded-2xl border border-border bg-surface p-4" role="status" data-testid="drill-feedback" data-correct={correct}>
			<p class="flex items-center gap-2 font-semibold {correct ? 'text-correct' : 'text-incorrect'}">
				<Icon name={correct ? 'check' : 'cross'} />{correct ? m.correct : m.incorrect}
			</p>
			<p class="font-reading" lang="en"><span class="text-xs font-semibold text-muted">{m.answer}: </span>{drill.corrected}</p>
			<p class="font-reading" lang="en">{fill(m.fix, { from: drill.originalSpan, to: drill.correctedSpan })}</p>
			<p class="text-sm">{drill.explanationVi}</p>
			<Button variant="primary" full onclick={() => ondone({ cacheId: drill.cacheId, correct: correct === true, responseMs })}
				>{last ? t.session.finish : t.session.next}</Button
			>
		</div>
	{/if}
</section>
