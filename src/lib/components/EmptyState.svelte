<!--
	EmptyState: nothing to show yet, with an optional action.
	<EmptyState title={t.stats.emptyTitle} body={t.stats.emptyBody} />
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon, { type IconName } from './Icon.svelte';

	let { title, body, icon = 'inbox', action }: { title: string; body?: string; icon?: IconName; action?: Snippet } = $props();
</script>

<div class="flex flex-col items-center gap-3 px-6 py-10 text-center">
	<span class="flex size-14 items-center justify-center rounded-full bg-surface-2 text-muted"><Icon name={icon} size={28} /></span>
	<h2 class="text-lg font-semibold">{title}</h2>
	{#if body}<p class="max-w-xs text-muted">{body}</p>{/if}
	{#if action}<div class="mt-2 w-full max-w-xs">{@render action()}</div>{/if}
</div>
