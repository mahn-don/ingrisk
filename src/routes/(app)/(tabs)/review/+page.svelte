<script lang="ts">
	import { enhance } from '$app/forms';
	import { goto } from '$app/navigation';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { fill, formatDate } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { nextReviewText } from './next-review.js';

	let { data, form } = $props();
	const m = t.review;

	const listHref = $derived(data.tab === 'learned' ? `/review?tab=learned${data.q ? `&q=${encodeURIComponent(data.q)}` : ''}` : '/review');
	const cardHref = (id: number) => `${listHref}${listHref.includes('?') ? '&' : '?'}card=${id}`;
	const sheetOpen = $derived(data.cardRequested);
	let heading = $state<HTMLHeadingElement | null>(null);
	let busy = $state(false);

	$effect(() => {
		if (sheetOpen && heading) heading.focus();
	});

	function close() {
		void goto(listHref, { reset: false });
	}

	const doneText = $derived(
		form && 'done' in form && form.done
			? { reviewNow: m.reviewNowDone, suspended: m.suspendedDone, unsuspended: m.unsuspendedDone }[form.done]
			: null
	);
	const unit = (value: number, u: keyof typeof t.session.units) => fill(t.session.units[u], { n: String(value).replace('.', ',') });
</script>

<svelte:head>
	<title>{m.title} · {t.app.name}</title>
</svelte:head>

<svelte:window onkeydown={(e) => sheetOpen && e.key === 'Escape' && close()} />

<h1 class="text-2xl font-bold">{m.title}</h1>

<nav aria-label={m.tabs} class="mt-4 grid grid-cols-2 gap-2 rounded-xl bg-surface-2 p-1">
	<a
		href="/review"
		aria-current={data.tab === 'hard' ? 'page' : undefined}
		class="flex min-h-11 items-center justify-center rounded-lg text-base font-medium {data.tab === 'hard' ? 'bg-surface font-semibold text-primary shadow-sm' : 'text-muted'}"
		data-testid="tab-hard">{m.tabHard}</a
	>
	<a
		href="/review?tab=learned"
		aria-current={data.tab === 'learned' ? 'page' : undefined}
		class="flex min-h-11 items-center justify-center rounded-lg text-base font-medium {data.tab === 'learned' ? 'bg-surface font-semibold text-primary shadow-sm' : 'text-muted'}"
		data-testid="tab-learned">{m.tabLearned}</a
	>
</nav>

{#if data.tab === 'hard'}
	<p class="mt-4 text-muted">{m.hardIntro}</p>
	{#if data.rows.some((r) => !r.suspended)}
		<div class="mt-3"><Button variant="primary" full href="/session?focus=hard">{m.practiceHard}</Button></div>
	{/if}
{:else}
	<form method="GET" action="/review" class="mt-4 flex gap-2" role="search" data-sveltekit-keepfocus>
		<input type="hidden" name="tab" value="learned" />
		<label class="sr-only" for="review-search">{m.search}</label>
		<input
			id="review-search"
			name="q"
			type="search"
			value={data.q}
			placeholder={m.searchPlaceholder}
			autocomplete="off"
			autocapitalize="off"
			spellcheck="false"
			class="min-h-12 min-w-0 flex-1 rounded-xl border-2 border-control bg-surface px-3 text-base"
		/>
		<Button type="submit" variant="secondary">{m.searchSubmit}</Button>
	</form>
	<p class="mt-2 text-sm text-muted" aria-live="polite" data-testid="review-count">{fill(m.results, { n: data.rows.length })}</p>
{/if}

{#if data.rows.length === 0}
	<div class="flex flex-1 items-center justify-center py-8">
		<EmptyState
			icon="inbox"
			title={data.tab === 'hard' ? m.emptyHard : data.q ? fill(m.emptySearch, { q: data.q }) : m.emptyLearned}
		/>
	</div>
{:else}
	<ul class="mt-4 flex flex-col gap-2" data-testid="review-list">
		{#each data.rows as row (row.cardId)}
			<li>
				<a
					href={cardHref(row.cardId)}
					class="flex flex-col gap-1 rounded-xl border border-border bg-surface px-4 py-3"
					aria-label={fill(m.openDetail, { answer: row.answer })}
					data-testid="review-row"
					data-card-id={row.cardId}
					data-sveltekit-noscroll
				>
					<span class="flex flex-wrap items-baseline gap-x-2">
						<span class="text-lg font-semibold">{row.answer}</span>
						{#if row.answerVi}<span class="text-muted">{row.answerVi}</span>{/if}
					</span>
					<span class="text-sm text-muted">{row.sentenceWithGap}</span>
					<span class="flex flex-wrap items-center gap-2 text-xs">
						{#if row.mined}<span class="rounded-full bg-warning-soft px-2 py-0.5 font-semibold text-warning">{m.mined}</span>{/if}
						{#if row.lapses > 0}<span class="text-muted">{fill(m.lapses, { n: row.lapses })}</span>{/if}
						<span class="font-medium {row.suspended ? 'text-muted' : 'text-primary'}" data-testid="review-next">{nextReviewText(row.next)}</span>
					</span>
				</a>
			</li>
		{/each}
	</ul>
{/if}

{#if sheetOpen}
	<div class="fixed inset-0 z-20 bg-black/40" aria-hidden="true" onclick={close}></div>
	<div
		role="dialog"
		aria-modal="true"
		aria-labelledby="card-detail-title"
		class="fixed inset-x-0 bottom-0 z-30 mx-auto max-h-[85dvh] max-w-md overflow-y-auto rounded-t-2xl border border-border bg-surface px-4 pt-4 pb-[calc(1.5rem+env(safe-area-inset-bottom))]"
		data-testid="card-detail"
	>
		<div class="flex items-center justify-between">
			<h2 id="card-detail-title" class="text-lg font-semibold" tabindex="-1" bind:this={heading}>{m.detailTitle}</h2>
			<a href={listHref} class="flex size-12 items-center justify-center rounded-full text-muted" data-sveltekit-noscroll>
				<Icon name="close" label={m.close} />
			</a>
		</div>
		{#if data.detail}
			{@const d = data.detail}
			<p class="mt-3 font-reading text-reading" data-testid="detail-sentence">
				{d.before}<mark class="rounded bg-primary-soft px-1 font-semibold text-primary">{d.answer}</mark>{d.after}
			</p>
			{#if d.viText}<p class="mt-2 text-muted" lang="vi"><span class="sr-only">{m.translation}: </span>{d.viText}</p>{/if}
			<dl class="mt-4 grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
				{#if d.answerVi}
					<dt class="text-muted">{m.meaning}</dt>
					<dd>{d.answerVi}</dd>
				{/if}
				<dt class="text-muted">{m.kind}</dt>
				<dd>{m.gapTypes[d.gapType]}{#if d.topicNameVi} · {d.topicNameVi}{/if}</dd>
				<dt class="text-muted">{m.source}</dt>
				<dd data-testid="detail-source">{m.sources[d.source]}</dd>
				<dt class="text-muted">{m.nextLabel}</dt>
				<dd>{nextReviewText(d.next)}</dd>
			</dl>

			<h3 class="mt-5 text-base font-semibold">{m.history}</h3>
			{#if d.history.length === 0}
				<p class="mt-1 text-sm text-muted">{m.historyEmpty}</p>
			{:else}
				<table class="mt-2 w-full text-left text-sm" data-testid="detail-history">
					<thead class="text-muted">
						<tr><th scope="col" class="py-1 font-medium">{m.historyDate}</th><th scope="col" class="py-1 font-medium">{m.historyRating}</th><th scope="col" class="py-1 font-medium">{m.historyInterval}</th></tr>
					</thead>
					<tbody>
						{#each d.history as h (h.review)}
							<tr class="border-t border-border">
								<td class="py-1.5">{formatDate(h.review)}</td>
								<td class="py-1.5">{m.ratings[h.rating]}</td>
								<td class="py-1.5">{unit(h.interval.value, h.interval.unit)}</td>
							</tr>
						{/each}
					</tbody>
				</table>
			{/if}

			{#if doneText && form && 'cardId' in form && form.cardId === d.cardId}
				<p class="mt-4 rounded-xl bg-correct-soft px-3 py-2 text-sm text-text" role="status" data-testid="detail-done">{doneText}</p>
			{/if}
			<div class="mt-5 grid grid-cols-2 gap-2">
				<form
					method="POST"
					action="{cardHref(d.cardId)}&/reviewNow"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update({ reset: false, invalidateAll: true });
							busy = false;
						};
					}}
				>
					<input type="hidden" name="cardId" value={d.cardId} />
					<Button type="submit" variant="primary" full disabled={busy}>{m.reviewNow}</Button>
				</form>
				<form
					method="POST"
					action="{cardHref(d.cardId)}&/{d.suspended ? 'unsuspend' : 'suspend'}"
					use:enhance={() => {
						busy = true;
						return async ({ update }) => {
							await update({ reset: false, invalidateAll: true });
							busy = false;
						};
					}}
				>
					<input type="hidden" name="cardId" value={d.cardId} />
					<Button type="submit" variant="secondary" full disabled={busy}>{d.suspended ? m.unsuspend : m.suspend}</Button>
				</form>
			</div>
			<p class="mt-2 text-xs text-muted">{m.suspendHelp}</p>
		{:else}
			<p class="mt-3 text-muted">{m.notFound}</p>
		{/if}
	</div>
{/if}
