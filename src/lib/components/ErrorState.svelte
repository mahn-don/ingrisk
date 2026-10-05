<!--
	ErrorState: something went wrong; an icon and text (not colour alone), with an optional retry.
	<ErrorState message={t.errorPage.generic} onretry={reload} />
-->
<script lang="ts">
	import { t } from '#lib/messages/vi.js';
	import Button from './Button.svelte';
	import Icon from './Icon.svelte';

	let { title = t.states.errorTitle, message, onretry }: { title?: string; message?: string; onretry?: () => void } = $props();
</script>

<div role="alert" class="flex flex-col items-center gap-3 px-6 py-10 text-center">
	<span class="flex size-14 items-center justify-center rounded-full bg-incorrect-soft text-incorrect"><Icon name="alert" size={28} /></span>
	<h2 class="text-lg font-semibold">{title}</h2>
	{#if message}<p class="max-w-xs text-muted">{message}</p>{/if}
	{#if onretry}<div class="mt-2 w-full max-w-xs"><Button variant="secondary" full onclick={onretry}>{t.states.retry}</Button></div>{/if}
</div>
