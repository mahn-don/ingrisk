<!--
	TextAnswer: the typing input for English answers, friendly to Vietnamese keyboards (no
	autocapitalize, autocorrect or spellcheck; Enter means "done"). Bind `value`.
	<TextAnswer label={t.dev.textAnswerLabel} bind:value={answer} onsubmit={check} />
-->
<script lang="ts">
	import type { HTMLInputAttributes } from 'svelte/elements';

	type Props = Omit<HTMLInputAttributes, 'value'> & { label: string; value?: string; invalid?: boolean };
	let { label, value = $bindable(''), invalid = false, id = 'answer', ...rest }: Props = $props();
</script>

<label class="flex flex-col gap-2" for={id}>
	<span class="text-xs font-semibold text-muted">{label}</span>
	<input
		{id}
		type="text"
		lang="en"
		autocomplete="off"
		autocapitalize="off"
		autocorrect="off"
		spellcheck="false"
		enterkeyhint="done"
		class="min-h-12 w-full rounded-xl border-2 bg-surface px-4 font-reading text-reading text-text placeholder:text-muted {invalid
			? 'border-incorrect'
			: 'border-control'}"
		aria-invalid={invalid || undefined}
		bind:value
		{...rest}
	/>
</label>
