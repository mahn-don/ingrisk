<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import { fill, formatDate } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { THEMES, type Theme } from '#lib/theme.js';

	let { data } = $props();
	const labels: Record<Theme, string> = { system: t.settings.themeSystem, light: t.settings.themeLight, dark: t.settings.themeDark };
	let loggingOut = $state(false);
</script>

<svelte:head>
	<title>{t.settings.title} · {t.app.name}</title>
</svelte:head>

<h1 class="text-2xl font-bold">{t.settings.title}</h1>

<div class="mt-6 flex flex-col gap-4">
	<Card title={t.settings.theme}>
		<form
			method="POST"
			action="?/theme"
			use:enhance={() =>
				async ({ update }) => {
					await update({ reset: false });
					await invalidateAll();
				}}
		>
			<fieldset class="grid grid-cols-3 gap-2">
				<legend class="sr-only">{t.settings.theme}</legend>
				{#each THEMES as theme (theme)}
					<button
						type="submit"
						name="theme"
						value={theme}
						aria-pressed={data.theme === theme}
						class="min-h-12 rounded-xl border-2 px-2 text-base font-medium {data.theme === theme
							? 'border-primary bg-primary-soft font-semibold'
							: 'border-control bg-surface'}">{labels[theme]}</button
					>
				{/each}
			</fieldset>
		</form>
	</Card>

	<Card title={t.settings.placement}>
		{#if data.placement}
			<p data-testid="settings-placement">
				{fill(t.settings.placementLast, { cefr: data.placement.cefr, date: formatDate(data.placement.takenAt) })}
				<a class="font-semibold text-primary underline" href="/placement/result/{data.placement.id}">{t.settings.placementSeeResult}</a>
			</p>
		{:else}
			<p class="text-muted">{t.settings.placementNone}</p>
		{/if}
		<div class="mt-4">
			<Button variant="secondary" full href="/placement?restart">{data.placement ? t.settings.placementRetake : t.settings.placementTake}</Button>
		</div>
	</Card>

	<Card title={t.settings.account}>
		<form
			method="POST"
			action="?/logout"
			use:enhance={() => {
				loggingOut = true;
				return async ({ update }) => {
					await update();
					loggingOut = false;
				};
			}}
		>
			<Button type="submit" variant="secondary" full loading={loggingOut}>{t.settings.logout}</Button>
		</form>
	</Card>
</div>
