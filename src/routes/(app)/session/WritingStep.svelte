<!--
	WritingStep: the write anchor, a writing task or a VI→EN translation. Submitting stores it and
	grades it for up to 30 s: the feedback inline, or "graded later" (the session goes on).
-->
<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { countWords } from '#lib/placement.js';
	import type { Anchor, AnchorResponse } from '#lib/session/types.js';
	import FeedbackView from './FeedbackView.svelte';

	type Task = Extract<Anchor, { type: 'writing' | 'translation' }>;
	type Props = { anchor: Task; sessionId: number; last: boolean; submitted?: boolean; ondone: () => void };
	let { anchor, sessionId, last, submitted = $bindable(false), ondone }: Props = $props();
	const m = t.session.writing;

	let text = $state('');
	let busy = $state(false);
	let error = $state<string | null>(null);
	let result = $state<AnchorResponse | null>(null);
	const words = $derived(countWords(text));

	async function submit(event: Event) {
		event.preventDefault();
		if (busy || words === 0) return;
		busy = true;
		error = null;
		try {
			const response = await fetch('/api/session/anchor', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ sessionId, text })
			});
			if (response.status === 429) {
				error = ((await response.json()) as { message: string }).message;
				return;
			}
			if (!response.ok) throw new Error(String(response.status));
			result = (await response.json()) as AnchorResponse;
			submitted = true;
		} catch {
			error = m.error;
		} finally {
			busy = false;
		}
	}
</script>

<section class="flex flex-1 flex-col gap-4" data-testid="writing" data-task={anchor.type}>
	<p class="text-sm text-muted">{anchor.type === 'writing' ? m.writingLabel : m.translationLabel}</p>
	{#if anchor.type === 'writing'}
		<p class="text-lg font-semibold">{anchor.promptVi}</p>
		<p class="text-sm text-muted"><span class="font-semibold">{m.hint}:</span> <span lang="en">{anchor.hint}</span></p>
	{:else}
		<p class="text-lg font-semibold" data-testid="translation-source">{anchor.vi}</p>
	{/if}
	{#if result === null}
		<form class="flex flex-1 flex-col gap-3" onsubmit={submit}>
			<label class="flex flex-col gap-2" for="anchor-text">
				<span class="text-xs font-semibold text-muted">{anchor.type === 'writing' ? m.text : m.translation}</span>
				<textarea
					id="anchor-text"
					lang="en"
					rows={anchor.type === 'writing' ? 7 : 3}
					spellcheck="false"
					maxlength="4000"
					class="w-full rounded-xl border-2 border-control bg-surface px-4 py-3 font-reading text-reading text-text"
					bind:value={text}
					disabled={busy}
				></textarea>
			</label>
			{#if anchor.type === 'writing'}
				<p class="text-sm text-muted" aria-live="polite" data-testid="anchor-word-count">
					<span class={words >= anchor.minWords && words <= anchor.maxWords ? 'font-semibold text-correct' : ''}>{fill(m.words, { n: words })}</span>
					· {fill(m.target, { min: anchor.minWords, max: anchor.maxWords })}
				</p>
			{/if}
			{#if error}<p role="alert" class="text-sm text-incorrect" data-testid="writing-error">{error}</p>{/if}
			<div class="mt-auto flex flex-col gap-2 pt-4">
				{#if busy}<p class="text-center text-sm text-muted" aria-live="polite">{m.grading}</p>{/if}
				<Button type="submit" variant="primary" full loading={busy} disabled={words === 0}>{m.submit}</Button>
				<Button variant="ghost" full disabled={busy} onclick={ondone}>{m.skip}</Button>
			</div>
		</form>
	{:else}
		{#if result.queued}
			<p class="rounded-xl bg-surface-2 px-3 py-2" data-testid="anchor-queued" data-reason={result.reason}>
				{result.reason === 'no_provider' ? t.errors.noProvider : result.reason === 'llm_error' ? t.errors.llmDown : m.queued}
			</p>
		{:else}
			<FeedbackView card={result.feedback} />
		{/if}
		<div class="mt-auto pt-4"><Button variant="primary" full onclick={ondone}>{last ? t.session.finish : t.session.next}</Button></div>
	{/if}
</section>
