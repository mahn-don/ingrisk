<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import { t } from '#lib/messages/vi.js';

	let { data } = $props();
	const stats = $derived([
		{ label: t.home.due, value: data.counts.due, testid: 'count-due' },
		{ label: t.home.newToday, value: data.counts.newAvailableToday, testid: 'count-new' },
		{ label: t.home.learning, value: data.counts.learning, testid: 'count-learning' }
	]);
</script>

<svelte:head>
	<title>{t.home.title} · {t.app.name}</title>
</svelte:head>

<header class="flex flex-col gap-1">
	<p class="text-xs font-semibold tracking-wide text-muted uppercase">{t.app.name}</p>
	<h1 class="text-2xl font-bold">{t.home.title}</h1>
	<p class="text-muted">{t.home.greeting}</p>
</header>

<ul class="mt-6 grid grid-cols-3 gap-3">
	{#each stats as stat (stat.testid)}
		<li>
			<Card class="flex h-full flex-col gap-1 px-3 py-4 text-center">
				<span class="text-3xl font-bold tabular-nums" data-testid={stat.testid}>{stat.value}</span>
				<span class="text-xs text-muted">{stat.label}</span>
			</Card>
		</li>
	{/each}
</ul>

<p class="mt-6 text-muted">{t.home.tagline}</p>

<!-- The primary action sits low, in the thumb zone. -->
<div class="mt-auto flex flex-col gap-2 pt-8">
	<Button variant="primary" full disabled aria-describedby="start-hint">{t.home.start}</Button>
	<p id="start-hint" class="text-center text-xs text-muted">{t.home.startHint}</p>
</div>
