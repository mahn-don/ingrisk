<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { fill, formatDate } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';

	let { data } = $props();
	const r = $derived(data.result);
	const m = t.placement.result;

	type Range = { min: number; max: number | null } | null;
	const decimals = (n: number) => n.toFixed(1);
	const range = (value: Range, format: (n: number) => string = String) =>
		value === null ? m.belowScale : value.max === null ? `${format(value.min)}+` : `${format(value.min)}–${format(value.max)}`;

	const grammarTypes = $derived(
		(['article', 'preposition', 'verb_form'] as const)
			.filter((type) => r.subscores.grammarByType[type] !== undefined)
			.map((type) => `${m[type]} ${r.subscores.grammarByType[type]!.correct}/${r.subscores.grammarByType[type]!.total}`)
			.join(', ')
	);
	const change = $derived(
		r.previous === null ? null : r.abilityBand > r.previous.abilityBand ? m.up : r.abilityBand < r.previous.abilityBand ? m.down : m.same
	);
</script>

<svelte:head>
	<title>{m.title} · {t.app.name}</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-md flex-col gap-4 px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
	<h1 class="text-lg font-semibold">{m.title}</h1>

	<main id="main" class="flex flex-1 flex-col gap-4">
		<section class="flex flex-col items-center gap-2 py-4 text-center">
			<p class="text-muted">{m.level}</p>
			<p
				class="flex size-32 items-center justify-center rounded-full border-4 border-primary bg-primary-soft text-5xl font-bold text-primary"
				data-testid="cefr-badge"
			>
				{r.cefr}
			</p>
		</section>

		<Card title={m.equivalents}>
			<dl class="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2">
				<dt class="text-muted">{m.vstep}</dt>
				<dd class="font-semibold">{fill(m.vstepValue, { n: r.equivalents.vstep })}</dd>
				<dt class="text-muted">{m.ielts}</dt>
				<dd class="font-semibold">{range(r.equivalents.ielts, decimals)}</dd>
				<dt class="text-muted">{m.toeic}</dt>
				<dd class="font-semibold">{range(r.equivalents.toeic)}</dd>
			</dl>
		</Card>

		<Card title={m.details}>
			<ul class="flex flex-col gap-2">
				<li>{fill(m.vocab, { band: r.subscores.vocab })}</li>
				{#if r.subscores.lexical && r.subscores.lexical.total > 0}
					<li>{fill(m.lexical, r.subscores.lexical)}</li>
				{/if}
				{#if r.subscores.grammar && r.subscores.grammar.total > 0}
					<li>{fill(m.grammar, r.subscores.grammar)}{grammarTypes ? ` (${grammarTypes})` : ''}.</li>
				{/if}
				<li data-testid="writing-status">
					{#if r.writingStatus === 'scored' && r.subscores.writing}{fill(m.writingScored, { cefr: r.subscores.writing })}{:else if r.writingStatus === 'queued'}{m.writingQueued}{:else}{m.writingNone}{/if}
				</li>
			</ul>
			{#each r.flags as flag (flag)}
				<p class="mt-3 flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2" data-testid="flag-{flag}">
					<span class="text-warning"><Icon name="alert" size={20} /></span>
					{flag === 'many_false_alarms' ? m.falseAlarms : m.clozeSkipped}
				</p>
			{/each}
		</Card>

		<Card title={m.previous}>
			{#if r.previous}
				<p data-testid="previous-result">
					{fill(m.previousValue, { date: formatDate(r.previous.takenAt), cefr: r.previous.cefr })} → {r.cefr} · <strong>{change}</strong>
				</p>
			{:else}
				<p class="text-muted">{m.first}</p>
			{/if}
		</Card>

		<p class="text-sm text-muted" data-testid="caveat">{m.caveat}</p>

		<div class="mt-auto pt-4"><Button variant="primary" full href="/">{m.home}</Button></div>
	</main>
</div>
