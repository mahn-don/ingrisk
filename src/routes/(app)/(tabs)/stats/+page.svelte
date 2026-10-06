<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import { fill, formatDate } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import type { TopicWeakness } from '#lib/progress/types.js';
	import { shortDate } from './dates.js';
	import Forecast from './Forecast.svelte';
	import HeatMap from './HeatMap.svelte';

	let { data } = $props();
	const m = t.stats;
	const p = $derived(data.progress);
	const today = $derived(p.forecast[0].date);
	const pct = (correct: number, total: number) => Math.round((correct / total) * 100);
	const weaknessLine = (w: TopicWeakness) =>
		w.clozeTotal > 0
			? fill(m.weaknessErrorsCloze, { name: w.nameVi, n: w.score, pct: pct(w.clozeCorrect, w.clozeTotal) })
			: fill(m.weaknessErrors, { name: w.nameVi, n: w.score });
	const weekLabel = (w: (typeof p.weekly.past)[number]) =>
		w.hit === null
			? fill(m.weekBefore, { date: shortDate(w.weekStart) })
			: fill(w.hit ? m.weekHit : m.weekMiss, { date: shortDate(w.weekStart), n: w.studiedDays, goal: w.goal });
	const totals = $derived([
		{ label: m.wordsLearned, value: p.totals.wordsLearned },
		{ label: m.cardsInLearning, value: p.totals.cardsInLearning },
		{ label: m.minutes, value: p.totals.minutes },
		{ label: m.sessions, value: p.totals.sessions },
		{ label: m.minedAdded, value: p.totals.minedAdded },
		{ label: m.minedInReview, value: p.totals.minedInReview }
	]);
	const forecastTotal = $derived(p.forecast.reduce((n, d) => n + d.due, 0));
</script>

<svelte:head>
	<title>{m.title} · {t.app.name}</title>
</svelte:head>

<h1 class="text-2xl font-bold">{m.title}</h1>

{#if p.totals.sessions === 0}
	<div class="flex flex-1 items-center justify-center" data-testid="stats-empty">
		<EmptyState icon="chart" title={m.emptyTitle} body={m.emptyBody} />
	</div>
{:else}
	<div class="mt-6 flex flex-col gap-4">
		<Card>
			<div class="flex items-baseline gap-2" data-testid="stats-streak">
				<span class="text-5xl font-bold tabular-nums">{p.streak.current}</span>
				<span class="text-lg font-medium">{m.streakDays}</span>
			</div>
			<p class="mt-1 text-sm text-muted">{fill(m.streakLongest, { n: p.streak.longest })}</p>
			<p class="mt-2 text-sm">{p.streak.studiedToday ? m.streakTodayDone : m.streakTodayPending}</p>
			<div class="mt-4 rounded-xl bg-surface-2 px-3 py-2">
				<p class="font-semibold" data-testid="stats-freezes">{fill(m.freezes, { n: p.streak.freezesBanked })}</p>
				<p class="text-sm text-muted">{m.freezesHelp}</p>
				{#if p.streak.freezesUsedDates.length > 0}
					<p class="mt-1 text-sm text-muted">{fill(m.freezesUsed, { dates: p.streak.freezesUsedDates.map(shortDate).join(', ') })}</p>
				{/if}
			</div>
		</Card>

		<Card title={m.weekTitle}>
			<p class="mb-2" data-testid="stats-week">{fill(m.weekProgress, { n: p.weekly.thisWeek.studiedDays, goal: p.weekly.goal })}</p>
			<ProgressBar value={Math.min(p.weekly.thisWeek.studiedDays, p.weekly.goal)} max={p.weekly.goal} label={m.weekTitle} />
			{#if p.weekly.thisWeek.hit}<p class="mt-2 text-sm font-semibold text-correct">{m.weekDone}</p>{/if}
			<h3 class="mt-4 text-sm font-medium text-muted">{m.weekPast}</h3>
			<ol class="mt-2 grid grid-cols-8 gap-1">
				{#each p.weekly.past as week (week.weekStart)}
					<li class="flex flex-col items-center gap-1 text-xs text-muted">
						<span
							class="flex size-8 items-center justify-center rounded-full border-2 {week.hit
								? 'border-correct bg-correct-soft text-correct'
								: week.hit === false
									? 'border-control text-muted'
									: 'border-dashed border-border text-muted'}"
						>
							{#if week.hit}<Icon name="check" size={16} />{:else if week.hit === false}<span aria-hidden="true">{week.studiedDays}</span>{/if}
						</span>
						<span class="sr-only">{weekLabel(week)}</span>
						<span aria-hidden="true">{shortDate(week.weekStart)}</span>
					</li>
				{/each}
			</ol>
		</Card>

		<Card title={m.heatTitle}>
			<p class="mb-3 text-sm text-muted">{m.heatHelp}</p>
			<HeatMap weeks={p.heatMap} {today} />
		</Card>

		<Card title={m.forecastTitle}>
			<Forecast days={p.forecast} />
			<p class="mt-2 text-sm text-muted">{fill(m.forecastSummary, { n: forecastTotal })}</p>
		</Card>

		<Card title={m.weaknessTitle}>
			<p class="text-sm text-muted">{m.weaknessHelp}</p>
			{#if p.weakness.length === 0}
				<p class="mt-3 text-muted">{m.weaknessEmpty}</p>
			{:else}
				<ul class="mt-3 flex flex-col gap-3" data-testid="weakness-list">
					{#each p.weakness as w (w.code)}
						<li class="rounded-xl border border-border p-3" data-testid="weakness-{w.code}">
							<p class="font-medium">{weaknessLine(w)}</p>
							{#if w.drillsTotal > 0}<p class="text-sm text-muted">{fill(m.weaknessDrills, { correct: w.drillsCorrect, total: w.drillsTotal })}</p>{/if}
							{#if w.byGapType.length > 1}
								<p class="text-sm text-muted">
									{w.byGapType.map((g) => fill(m.weaknessGap, { gap: t.review.gapTypes[g.gapType as keyof typeof t.review.gapTypes] ?? g.gapType, correct: g.correct, total: g.total })).join(' · ')}
								</p>
							{/if}
							{#if w.practicable}
								<div class="mt-2">
									<Button variant="secondary" full href="/session?focus=topic:{w.code}" aria-label={fill(m.practiceTopicNamed, { name: w.nameVi })}>{m.practiceTopic}</Button>
								</div>
							{/if}
						</li>
					{/each}
				</ul>
			{/if}
		</Card>

		<Card title={m.totalsTitle}>
			<dl class="grid grid-cols-2 gap-3" data-testid="stats-totals">
				{#each totals as total (total.label)}
					<div class="rounded-xl bg-surface-2 px-3 py-2">
						<dt class="text-xs text-muted">{total.label}</dt>
						<dd class="text-2xl font-bold tabular-nums">{total.value}</dd>
					</div>
				{/each}
			</dl>
		</Card>
	</div>
{/if}

<div class="mt-4 mb-2">
	<Card title={m.levelsTitle}>
		{#if data.progress.levels.length === 0}
			<p class="text-muted">{m.levelsEmpty}</p>
		{:else}
			<ol class="flex flex-col gap-1" data-testid="stats-levels">
				{#each [...data.progress.levels].reverse() as level (level.takenAt)}
					<li>{fill(m.levelEntry, { date: formatDate(level.takenAt), cefr: level.cefr, band: level.abilityBand })}</li>
				{/each}
			</ol>
		{/if}
	</Card>
</div>
