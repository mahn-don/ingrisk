<!--
	The review forecast: one bar per learning day with its count written on it. The SVG is
	decorative; the list after it carries the same numbers for screen readers.
-->
<script lang="ts">
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import type { ForecastDay } from '#lib/progress/types.js';
	import { dayLabel, weekdayShort } from './dates.js';

	let { days }: { days: ForecastDay[] } = $props();
	const m = t.stats;
	const BAR = 30;
	const GAP = 16;
	const CHART = 110;
	const TOP = 20;
	const max = $derived(Math.max(1, ...days.map((d) => d.due)));
	const width = $derived(days.length * (BAR + GAP) - GAP);
	/** Room on each side for the labels wider than a bar (today's). */
	const PAD = 14;
	const label = (i: number) => (i === 0 ? m.forecastToday : weekdayShort(days[i].date));
</script>

<svg viewBox="{-PAD} 0 {width + 2 * PAD} {TOP + CHART + 22}" class="w-full" aria-hidden="true" data-testid="forecast">
	<line x1={-PAD} x2={width + PAD} y1={TOP + CHART} y2={TOP + CHART} class="stroke-border" />
	{#each days as day, i (day.date)}
		{@const h = day.due === 0 ? 0 : Math.max(3, (day.due / max) * CHART)}
		{@const x = i * (BAR + GAP)}
		<rect {x} y={TOP + CHART - h} width={BAR} height={h} rx="4" class="fill-primary" />
		<text x={x + BAR / 2} y={TOP + CHART - h - 5} text-anchor="middle" class="fill-text text-[12px] font-semibold tabular-nums">{day.due}</text>
		<text x={x + BAR / 2} y={TOP + CHART + 16} text-anchor="middle" class="fill-muted text-[12px]">{label(i)}</text>
	{/each}
</svg>

<ul class="sr-only">
	{#each days as day, i (day.date)}
		<li>{fill(m.forecastDay, { day: i === 0 ? m.forecastToday : dayLabel(day.date), n: day.due })}</li>
	{/each}
</ul>
