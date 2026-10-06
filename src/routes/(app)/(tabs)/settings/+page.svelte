<script lang="ts">
	import { enhance } from '$app/forms';
	import { invalidateAll } from '$app/navigation';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import { fill, formatDate } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { THEMES, type Theme } from '#lib/theme.js';

	let { data, form } = $props();
	const m = t.settings;
	const labels: Record<Theme, string> = { system: m.themeSystem, light: m.themeLight, dark: m.themeDark };
	let loggingOut = $state(false);
	let savingLearning = $state(false);
	let generating = $state(false);
	// svelte-ignore state_referenced_locally
	let retention = $state(data.learning.desiredRetention);
	const learningResult = $derived(form && 'learning' in form ? (form.learning ?? null) : null);
	const invalid = (field: string) => learningResult !== null && !learningResult.ok && learningResult.fields.includes(field);
	const generateResult = $derived(form && 'generate' in form ? form : null);
	const generateMessage = $derived.by(() => {
		if (generateResult === null) return null;
		switch (generateResult.generate) {
			case 'started':
				return m.generateStarted;
			case 'locked':
				return m.generateLocked;
			case 'capped':
				return fill(m.generateCapped, { used: 'used' in generateResult ? generateResult.used : 0, cap: 'cap' in generateResult ? generateResult.cap : 0 });
			default:
				return m.generateNoProvider;
		}
	});
	const tokens = (n: number) => n.toLocaleString('vi-VN');
	const inputClass = 'min-h-12 w-24 rounded-xl border-2 bg-surface px-3 text-base tabular-nums';
	const chip = (on: boolean) =>
		`flex min-h-12 cursor-pointer items-center justify-center rounded-xl border-2 px-3 text-base font-medium has-[:focus-visible]:outline-3 has-[:focus-visible]:outline-primary ${on ? 'border-primary bg-primary-soft font-semibold' : 'border-control bg-surface'}`;
	// svelte-ignore state_referenced_locally
	let budget = $state(data.learning.defaultSessionBudget);
	// svelte-ignore state_referenced_locally
	let feedbackMode = $state(data.learning.feedbackMode);
</script>

<svelte:head>
	<title>{m.title} · {t.app.name}</title>
</svelte:head>

<h1 class="text-2xl font-bold">{m.title}</h1>

<div class="mt-6 flex flex-col gap-4 pb-2">
	<Card title={m.learning}>
		<form
			method="POST"
			action="?/learning"
			class="flex flex-col gap-5"
			data-testid="settings-learning"
			use:enhance={() => {
				savingLearning = true;
				return async ({ update }) => {
					await update({ reset: false });
					savingLearning = false;
				};
			}}
		>
			<div>
				<label for="retention" class="font-medium">{fill(m.retention, { pct: Math.round(retention * 100) })}</label>
				<input
					id="retention"
					name="desiredRetention"
					type="range"
					min="0.7"
					max="0.97"
					step="0.01"
					bind:value={retention}
					aria-valuetext="{Math.round(retention * 100)}%"
					aria-describedby="retention-help"
					class="mt-2 h-12 w-full accent-[var(--primary)]"
				/>
				<p id="retention-help" class="text-sm text-muted">{m.retentionHelp}</p>
			</div>
			<div class="flex items-center justify-between gap-3">
				<label for="new-per-day" class="font-medium">{m.newPerDay}</label>
				<input
					id="new-per-day"
					name="newCardsPerDay"
					type="number"
					inputmode="numeric"
					min="0"
					max="50"
					step="1"
					required
					value={data.learning.newCardsPerDay}
					aria-invalid={invalid('newCardsPerDay') || undefined}
					class="{inputClass} {invalid('newCardsPerDay') ? 'border-incorrect' : 'border-control'}"
				/>
			</div>
			<fieldset>
				<legend class="font-medium">{m.defaultBudget}</legend>
				<div class="mt-2 grid grid-cols-3 gap-2">
					{#each [5, 8, 10] as minutes (minutes)}
						<label class={chip(budget === minutes)}>
							<input type="radio" name="defaultSessionBudget" value={minutes} bind:group={budget} class="sr-only" />
							{fill(m.budgetMinutes, { n: minutes })}
						</label>
					{/each}
				</div>
			</fieldset>
			<div class="flex items-center justify-between gap-3">
				<label for="weekly-goal" class="font-medium">{m.weeklyGoal}</label>
				<input
					id="weekly-goal"
					name="weeklyGoalDays"
					type="number"
					inputmode="numeric"
					min="1"
					max="7"
					step="1"
					required
					value={data.learning.weeklyGoalDays}
					aria-invalid={invalid('weeklyGoalDays') || undefined}
					class="{inputClass} {invalid('weeklyGoalDays') ? 'border-incorrect' : 'border-control'}"
				/>
			</div>
			<fieldset>
				<legend class="font-medium">{m.feedbackMode}</legend>
				<div class="mt-2 flex flex-col gap-2">
					{#each [['direct', m.feedbackDirect], ['indirect', m.feedbackIndirect]] as const as [mode, label] (mode)}
						<label class="{chip(feedbackMode === mode)} justify-start">
							<input type="radio" name="feedbackMode" value={mode} bind:group={feedbackMode} class="sr-only" />
							{label}
						</label>
					{/each}
				</div>
			</fieldset>
			{#if learningResult}
				<p role="status" class="rounded-xl px-3 py-2 text-sm {learningResult.ok ? 'bg-correct-soft' : 'bg-incorrect-soft'}" data-testid="learning-status">
					{learningResult.ok ? m.saved : m.invalid}
				</p>
			{/if}
			<Button type="submit" variant="primary" full loading={savingLearning}>{m.save}</Button>
		</form>
		<div class="mt-6 border-t border-border pt-4">
			<h3 class="font-medium">{m.placement}</h3>
			{#if data.placement}
				<p class="mt-1" data-testid="settings-placement">
					{fill(m.placementLast, { cefr: data.placement.cefr, date: formatDate(data.placement.takenAt) })}
					<a class="font-semibold text-primary underline" href="/placement/result/{data.placement.id}">{m.placementSeeResult}</a>
				</p>
			{:else}
				<p class="mt-1 text-muted">{m.placementNone}</p>
			{/if}
			<div class="mt-3">
				<Button variant="secondary" full href="/placement?restart">{data.placement ? m.placementRetake : m.placementTake}</Button>
			</div>
		</div>
	</Card>

	<Card title={m.theme}>
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
				<legend class="sr-only">{m.theme}</legend>
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

	<Card title={m.content}>
		<p class="text-sm text-muted">{m.contentHelp}</p>
		<ul class="mt-3 flex flex-col gap-1" data-testid="settings-stock">
			{#each data.stock.bands as band (band.band)}
				<li>
					<span class="font-medium">{fill(m.contentBand, { band: band.band })}:</span>
					{fill(m.contentCloze, { n: band.cloze, target: data.stock.targets.clozePerBand })} ·
					{fill(m.contentReading, { n: band.reading, target: data.stock.targets.readingPerBand })}
				</li>
			{/each}
		</ul>
		<h3 class="mt-3 font-medium">{m.contentDrills}</h3>
		<ul class="mt-1 grid grid-cols-2 gap-x-3 text-sm">
			{#each data.stock.drills as drill (drill.code)}
				<li>{fill(m.contentDrill, { name: drill.nameVi, n: drill.count, target: data.stock.targets.drillsPerTopic })}</li>
			{/each}
		</ul>
		<form
			method="POST"
			action="?/generate"
			class="mt-4"
			use:enhance={() => {
				generating = true;
				return async ({ update }) => {
					await update({ reset: false });
					generating = false;
				};
			}}
		>
			<Button type="submit" variant="secondary" full loading={generating} disabled={!data.canGenerate || data.generating}>
				{data.generating ? m.generateRunning : m.generate}
			</Button>
		</form>
		{#if !data.canGenerate}
			<p class="mt-2 text-sm text-muted">{m.generateNoProvider}</p>
		{/if}
		{#if generateMessage}
			<p role="status" class="mt-2 text-sm" data-testid="generate-status">{generateMessage}</p>
		{/if}
	</Card>

	<Card title={m.providers}>
		<p data-testid="settings-active-provider">{data.activeProvider ? fill(m.providersSummary, { name: data.activeProvider }) : m.providersNone}</p>
		<div class="mt-3"><Button variant="secondary" full href="/settings/providers">{m.providersManage}</Button></div>
	</Card>

	<Card title={m.usage}>
		<table class="w-full text-left text-sm" data-testid="settings-usage">
			<caption class="sr-only">{m.usageTable}</caption>
			<thead class="text-muted">
				<tr>
					<th scope="col" class="py-1 font-medium">{m.usageDate}</th>
					<th scope="col" class="py-1 text-right font-medium">{m.usageCalls}</th>
					<th scope="col" class="py-1 text-right font-medium">{m.usageTokens}</th>
				</tr>
			</thead>
			<tbody>
				{#each data.usage as day (day.day)}
					<tr class="border-t border-border align-top">
						<td class="py-1.5">
							{formatDate(Date.parse(`${day.day}T12:00:00+07:00`))}
							{#each day.purposes as purpose (purpose.purpose)}
								<span class="block text-xs text-muted">{fill(m.usagePurpose, { purpose: purpose.purpose, calls: purpose.calls, input: tokens(purpose.inputTokens), output: tokens(purpose.outputTokens) })}</span>
							{/each}
						</td>
						<td class="py-1.5 text-right tabular-nums">{day.calls}</td>
						<td class="py-1.5 text-right tabular-nums">{tokens(day.inputTokens)} + {tokens(day.outputTokens)}</td>
					</tr>
				{/each}
			</tbody>
		</table>
	</Card>

	<Card title={m.data}>
		<p class="text-sm text-muted">{m.backupHelp}</p>
		<a
			href="/api/backup"
			download
			data-sveltekit-reload
			class="mt-3 inline-flex min-h-12 w-full items-center justify-center rounded-xl border-2 border-control bg-surface px-5 text-base font-semibold text-primary"
			data-testid="backup-link">{m.backup}</a
		>
		<a href="/settings/credits" class="mt-3 flex min-h-12 items-center font-semibold text-primary underline">{m.credits}</a>
	</Card>

	<Card title={m.account}>
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
			<Button type="submit" variant="secondary" full loading={loggingOut}>{m.logout}</Button>
		</form>
	</Card>
</div>
