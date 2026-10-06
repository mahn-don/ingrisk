<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { defaultShape, shapeOptions } from '#lib/session/shape.js';
	import type { SessionShape } from '#lib/session/types.js';

	let { data } = $props();
	const stats = $derived([
		{ label: t.home.due, value: data.counts.due, testid: 'count-due' },
		{ label: t.home.newToday, value: data.counts.newAvailableToday, testid: 'count-new' },
		{ label: t.home.learning, value: data.counts.learning, testid: 'count-learning' }
	]);
	let skipping = $state(false);
	// Budget chips: 5 / 8 / 10 minutes, plus the settings default if it is another value.
	const budgets = $derived([...new Set([5, 8, 10, data.defaultBudget])].sort((a, b) => a - b));
	// svelte-ignore state_referenced_locally
	let budget = $state(data.defaultBudget);
	// Today's shape follows the budget (5 min is Nhanh); the learner may pick another available one.
	let picked = $state<SessionShape | null>(null);
	const context = $derived({ ...data.shape, budgetMin: budget });
	const options = $derived(shapeOptions(context));
	const shape = $derived(picked !== null && options.some((o) => o.shape === picked && o.available) ? picked : defaultShape(context));
	const shapeName = (s: SessionShape) => t.session.shapes[s];
</script>

<svelte:head>
	<title>{t.home.title} · {t.app.name}</title>
</svelte:head>

<header class="flex flex-col gap-1">
	<p class="text-xs font-semibold tracking-wide text-muted uppercase">{t.app.name}</p>
	<h1 class="text-2xl font-bold">{t.home.title}</h1>
	<p class="text-muted">{t.home.greeting}</p>
	{#if data.placement.cefr}
		<p class="text-sm font-semibold text-primary" data-testid="home-level">{fill(t.home.level, { cefr: data.placement.cefr })}</p>
	{/if}
</header>

{#if data.placement.offer}
	<div class="mt-6" data-testid="placement-onboarding">
		<Card title={t.home.placementTitle}>
			<p class="text-muted">{t.home.placementBody}</p>
			<div class="mt-4 flex flex-col gap-2">
				<Button variant="primary" full class="py-2 text-center" href="/placement">{t.home.placementStart}</Button>
				<form
					method="POST"
					action="?/skipPlacement"
					use:enhance={() => {
						skipping = true;
						return async ({ update }) => {
							await update();
							skipping = false;
						};
					}}
				>
					<Button type="submit" variant="ghost" full loading={skipping}>{t.home.placementSkip}</Button>
				</form>
			</div>
		</Card>
	</div>
{:else if data.placement.inProgress}
	<div class="mt-6" data-testid="placement-resume">
		<Card title={t.home.resumeTitle}>
			<p class="text-muted">{t.home.resumeBody}</p>
			<div class="mt-4"><Button variant="primary" full href="/placement">{t.home.resume}</Button></div>
		</Card>
	</div>
{/if}

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
<div class="mt-auto flex flex-col gap-3 pt-8">
	<p class="text-center text-sm font-semibold text-primary" data-testid="shape-today">{fill(t.home.shapeToday, { shape: shapeName(shape) })}</p>
	<fieldset class="flex items-center justify-center gap-2">
		<legend class="sr-only">{t.home.shapeChoose}</legend>
		{#each options as option (option.shape)}
			<button
				type="button"
				class="min-h-10 rounded-full border-2 px-4 text-sm font-medium disabled:border-dashed disabled:opacity-60 {shape === option.shape
					? 'border-primary bg-primary-soft font-semibold text-primary'
					: 'border-control bg-surface text-text'}"
				aria-pressed={shape === option.shape}
				disabled={!option.available}
				aria-label={option.available ? shapeName(option.shape) : fill(t.home.shapeUnavailable, { shape: shapeName(option.shape) })}
				onclick={() => (picked = option.shape)}>{shapeName(option.shape)}</button
			>
		{/each}
	</fieldset>
	<fieldset class="flex items-center justify-center gap-2">
		<legend class="sr-only">{t.home.budget}</legend>
		{#each budgets as minutes (minutes)}
			<button
				type="button"
				class="min-h-10 rounded-full border-2 px-4 text-sm font-medium {budget === minutes
					? 'border-primary bg-primary-soft font-semibold text-primary'
					: 'border-control bg-surface text-text'}"
				aria-pressed={budget === minutes}
				onclick={() => (budget = minutes)}>{fill(t.home.budgetMinutes, { n: minutes })}</button
			>
		{/each}
	</fieldset>
	<Button variant="primary" full href="/session?budget={budget}&shape={shape}">{t.home.start}</Button>
</div>
