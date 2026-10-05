<!--
	Card: a surface with a soft border. Optional `title` renders a heading.
	<Card title={t.dev.card}><p>…</p></Card>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';

	let { title, class: className = '', children }: { title?: string; class?: string; children: Snippet } = $props();
</script>

<section class="rounded-2xl border border-border bg-surface p-4 {className}">
	{#if title}
		<h2 class="mb-2 text-base font-semibold">{title}</h2>
	{/if}
	{@render children()}
</section>
