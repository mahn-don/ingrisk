<!--
	The 12-week heat-map: one column per week (Monday on top), one cell per learning day. The fill
	size grows with the minutes (not colour alone); the SVG is decorative and a table carries the
	same data for screen readers.
-->
<script lang="ts">
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import type { HeatCell, HeatMap } from '#lib/progress/types.js';
	import { dayLabel, shortDate, weekdayShort } from './dates.js';

	let { weeks, today }: { weeks: HeatMap; today: string } = $props();
	const m = t.stats;
	const CELL = 22;
	const GAP = 4;
	const LEFT = 26;
	const TOP = 4;
	/** Side of the filled square per bucket (0: none). */
	const SIZE = [0, 9, 15, CELL];
	const width = $derived(LEFT + weeks.length * (CELL + GAP));
	const height = TOP + 7 * (CELL + GAP);
	const describe = (c: HeatCell) =>
		c.future ? fill(m.heatCellFuture, { date: dayLabel(c.date) }) : c.bucket === 0 ? fill(m.heatCellNone, { date: dayLabel(c.date) }) : fill(m.heatCell, { date: dayLabel(c.date), minutes: c.minutes });
	const legend = [m.heat0, m.heat1, m.heat2, m.heat3];
</script>

<svg viewBox="0 0 {width} {height}" class="w-full" aria-hidden="true" data-testid="heatmap">
	{#each weeks[0] as cell, row (cell.date)}
		{#if row % 2 === 0}
			<text x="0" y={TOP + row * (CELL + GAP) + CELL * 0.72} class="fill-muted text-[13px]">{weekdayShort(cell.date)}</text>
		{/if}
	{/each}
	{#each weeks as week, col (week[0].date)}
		{#each week as cell, row (cell.date)}
			{@const x = LEFT + col * (CELL + GAP)}
			{@const y = TOP + row * (CELL + GAP)}
			{#if cell.future}
				<rect {x} {y} width={CELL} height={CELL} rx="4" class="fill-none stroke-border" stroke-dasharray="3 3" />
			{:else}
				<rect {x} {y} width={CELL} height={CELL} rx="4" class="fill-surface-2" data-bucket={cell.bucket} />
				{#if cell.bucket > 0}
					{@const s = SIZE[cell.bucket]}
					<rect x={x + (CELL - s) / 2} y={y + (CELL - s) / 2} width={s} height={s} rx={cell.bucket === 3 ? 4 : 2} class="fill-primary" />
				{/if}
				{#if cell.date === today}
					<rect x={x - 1.5} y={y - 1.5} width={CELL + 3} height={CELL + 3} rx="5" class="fill-none stroke-text" stroke-width="1.5" />
				{/if}
			{/if}
		{/each}
	{/each}
</svg>

<ul class="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted" aria-label={m.heatLegend}>
	{#each legend as label, bucket (bucket)}
		<li class="flex items-center gap-1.5">
			<svg width="16" height="16" viewBox="0 0 22 22" aria-hidden="true">
				<rect width="22" height="22" rx="4" class="fill-surface-2" />
				{#if bucket > 0}<rect x={(22 - SIZE[bucket]) / 2} y={(22 - SIZE[bucket]) / 2} width={SIZE[bucket]} height={SIZE[bucket]} rx="2" class="fill-primary" />{/if}
			</svg>
			{label}
		</li>
	{/each}
</ul>

<!-- A table ignores width: 1px, so the wrapper (not the table) is visually hidden. -->
<div class="sr-only">
	<table>
		<caption>{m.heatTable}</caption>
		<tbody>
			{#each weeks as week (week[0].date)}
				<tr>
					<th scope="row">{shortDate(week[0].date)}</th>
					{#each week as cell (cell.date)}<td>{describe(cell)}</td>{/each}
				</tr>
			{/each}
		</tbody>
	</table>
</div>
