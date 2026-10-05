<script lang="ts">
	import { goto, invalidateAll } from '$app/navigation';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import OptionButton from '#lib/components/OptionButton.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';
	import { NO_WORD_OPTION, type PlacementView, countWords } from '#lib/placement.js';

	let { data } = $props();

	// The server holds the attempt; this page only shows its current item.
	// Seeded from the load (server-rendered); then updated from each API response.
	// svelte-ignore state_referenced_locally
	let view = $state<PlacementView | null>(data.view);
	// svelte-ignore state_referenced_locally
	let restart = $state(data.restart);

	let busy = $state(false);
	let error = $state<string | null>(null);
	let confirmExit = $state(false);
	let introSeen = $state<Record<number, boolean>>({});
	let chosen = $state<number | null>(null);
	let text = $state('');
	let shownAt = 0;

	const names = [t.placement.partA.name, t.placement.partB.name, t.placement.partC.name];
	const intros = [
		{ title: t.placement.partA.introTitle, body: t.placement.partA.introBody },
		{ title: t.placement.partB.introTitle, body: t.placement.partB.introBody },
		{ title: t.placement.partC.introTitle, body: t.placement.partC.introBody }
	];
	const active = $derived(view !== null && view.part !== 'done' ? view : null);
	const showIntro = $derived(active !== null && active.progress.answered === 0 && !introSeen[active.progress.part]);
	const words = $derived(countWords(text));

	// Time each item from when it is on screen.
	$effect(() => {
		if (active !== null && !showIntro) {
			void active.ref;
			shownAt = performance.now();
			chosen = null;
		}
	});

	async function post(path: string, body: unknown): Promise<unknown> {
		busy = true;
		error = null;
		try {
			const response = await fetch(path, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
			if (response.status === 401) {
				window.location.href = `/login?next=${encodeURIComponent('/placement')}`;
				return null;
			}
			if (response.status === 409) {
				// Answered elsewhere (another tab) or finished: show what the server has now.
				await invalidateAll();
				view = data.view;
				error = t.placement.stale;
				return null;
			}
			if (!response.ok) throw new Error(String(response.status));
			return await response.json();
		} catch {
			error = t.placement.error;
			return null;
		} finally {
			busy = false;
		}
	}

	async function show(next: unknown) {
		if (next === null) return;
		const v = next as PlacementView;
		if (v.part === 'done') return goto(`/placement/result/${v.resultId}`);
		view = v;
	}

	async function start() {
		await show(await post('/api/placement/start', { restart }));
		restart = false;
	}

	async function answer(value: boolean | number) {
		if (active === null || busy) return;
		const responseMs = Math.round(performance.now() - shownAt);
		await show(await post('/api/placement/answer', { attemptId: active.attemptId, itemRef: active.ref, answer: value, responseMs }));
	}

	async function choose(index: number) {
		chosen = index;
		await answer(index);
	}

	async function submitWriting(skip: boolean) {
		if (active === null || busy) return;
		const result = (await post('/api/placement/writing', skip ? { attemptId: active.attemptId, skip: true } : { attemptId: active.attemptId, text })) as {
			resultId: number;
		} | null;
		if (result !== null) await goto(`/placement/result/${result.resultId}`);
	}
</script>

<svelte:head>
	<title>{t.placement.title} · {t.app.name}</title>
</svelte:head>

<!-- Full screen: no tab bar; the exit asks first and keeps the attempt. -->
<div class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
	<header class="flex flex-col gap-3">
		<div class="flex items-center justify-between">
			<h1 class="text-lg font-semibold">
				{#if active}{fill(t.placement.part, { n: active.progress.part })} · {names[active.progress.part - 1]}{:else}{t.placement.title}{/if}
			</h1>
			<button
				type="button"
				class="-mr-2 flex size-12 items-center justify-center rounded-full text-muted"
				aria-label={t.placement.exit}
				aria-expanded={confirmExit}
				aria-controls="exit-confirm"
				onclick={() => (confirmExit = true)}
				data-testid="placement-exit"
			>
				<Icon name="close" />
			</button>
		</div>
		{#if active && active.part !== 'C'}
			<ProgressBar value={active.progress.answered} max={active.progress.total} label={fill(t.placement.partProgress, { n: active.progress.part })} />
		{/if}
	</header>

	{#if confirmExit}
		<div id="exit-confirm" role="alertdialog" aria-labelledby="exit-title" aria-describedby="exit-body" class="mt-4">
			<Card>
				<h2 id="exit-title" class="text-base font-semibold">{t.placement.exitTitle}</h2>
				<p id="exit-body" class="mt-1 text-muted">{t.placement.exitBody}</p>
				<div class="mt-4 grid grid-cols-2 gap-2">
					<Button variant="secondary" onclick={() => (confirmExit = false)}>{t.placement.exitCancel}</Button>
					<Button variant="primary" href="/">{t.placement.exitConfirm}</Button>
				</div>
			</Card>
		</div>
	{/if}

	<main id="main" class="flex flex-1 flex-col pt-6">
		{#if error}
			<p role="alert" class="mb-4 flex items-start gap-2 rounded-xl bg-incorrect-soft px-3 py-2 text-sm text-text">
				<span class="text-incorrect"><Icon name="alert" size={20} /></span>{error}
			</p>
		{/if}

		{#if active === null}
			<section class="flex flex-1 flex-col gap-4" data-testid="placement-welcome">
				<h2 class="text-2xl font-bold">{t.placement.title}</h2>
				<p>{t.placement.welcomeBody}</p>
				<p class="text-muted">{t.placement.welcomeNote}</p>
				<div class="mt-auto pt-8"><Button variant="primary" full loading={busy} onclick={start}>{t.placement.begin}</Button></div>
			</section>
		{:else if showIntro}
			<section class="flex flex-1 flex-col gap-4" data-testid="placement-intro">
				<h2 class="text-2xl font-bold">{intros[active.progress.part - 1].title}</h2>
				<p>{intros[active.progress.part - 1].body}</p>
				{#if active.part === 'A'}
					<p class="flex items-start gap-2 rounded-xl bg-warning-soft px-3 py-2">
						<span class="text-warning"><Icon name="alert" size={20} /></span>{t.placement.partA.introWarning}
					</p>
				{/if}
				{#if active.part === 'C' && active.clozeSkipped}
					<p class="text-muted" data-testid="cloze-skipped">{t.placement.partC.clozeSkipped}</p>
				{/if}
				<div class="mt-auto pt-8">
					<Button variant="primary" full onclick={() => (introSeen[active.progress.part] = true)}>{t.placement.beginPart}</Button>
				</div>
			</section>
		{:else if active.part === 'A'}
			<section class="flex flex-1 flex-col" data-testid="part-a" data-ref={active.ref}>
				<p class="text-center text-muted">{t.placement.partA.question}</p>
				<p class="flex flex-1 items-center justify-center py-10 text-center font-reading text-4xl font-semibold break-words" lang="en" data-testid="part-a-word">
					{active.word}
				</p>
				<!-- Big buttons in the thumb zone. -->
				<div class="grid grid-cols-2 gap-3">
					<button
						type="button"
						class="min-h-20 rounded-2xl border-2 border-control bg-surface text-lg font-semibold disabled:opacity-50"
						disabled={busy}
						onclick={() => answer(false)}>{t.placement.partA.unknown}</button
					>
					<button
						type="button"
						class="min-h-20 rounded-2xl border-2 border-primary bg-primary text-lg font-semibold text-primary-contrast disabled:opacity-50"
						disabled={busy}
						onclick={() => answer(true)}>{t.placement.partA.known}</button
					>
				</div>
			</section>
		{:else if active.part === 'B'}
			<section class="flex flex-1 flex-col gap-6" data-testid="part-b" data-ref={active.ref}>
				<p class="text-muted">{t.placement.partB.question}</p>
				<p class="font-reading text-reading" lang="en">
					{active.before}<span class="mx-0.5 inline-block min-w-16 border-b-2 border-primary align-baseline" role="img" aria-label={t.placement.partB.gap}
						>&nbsp;</span
					>{active.after}
				</p>
				<div class="mt-auto flex flex-col gap-3">
					{#each active.options as option, i (i)}
						<OptionButton
							label={option === NO_WORD_OPTION ? t.placement.partB.noWord : option}
							state={chosen === i ? 'selected' : 'idle'}
							disabled={busy}
							onclick={() => choose(i)}
						/>
					{/each}
				</div>
			</section>
		{:else}
			<section class="flex flex-1 flex-col gap-4" data-testid="part-c">
				<p class="text-lg font-semibold">{active.prompt.text}</p>
				<p class="text-sm text-muted"><span class="font-semibold">{t.placement.partC.hint}:</span> <span lang="en">{active.prompt.hint}</span></p>
				<label class="flex flex-col gap-2" for="writing">
					<span class="text-xs font-semibold text-muted">{t.placement.partC.label}</span>
					<textarea
						id="writing"
						lang="en"
						rows="7"
						spellcheck="false"
						maxlength="4000"
						class="w-full rounded-xl border-2 border-control bg-surface px-4 py-3 font-reading text-reading text-text"
						bind:value={text}
						aria-describedby="word-count"
						disabled={busy}
					></textarea>
				</label>
				<p id="word-count" class="text-sm text-muted" aria-live="polite" data-testid="word-count">
					<span class={words >= active.prompt.minWords && words <= active.prompt.maxWords ? 'font-semibold text-correct' : ''}
						>{fill(t.placement.partC.words, { n: words })}</span
					>
					· {fill(t.placement.partC.target, { min: active.prompt.minWords, max: active.prompt.maxWords })}
				</p>
				<div class="mt-auto flex flex-col gap-2 pt-4">
					{#if busy}<p class="text-center text-sm text-muted" aria-live="polite">{t.placement.partC.grading}</p>{/if}
					<Button variant="primary" full loading={busy} disabled={words === 0} onclick={() => submitWriting(false)}>{t.placement.partC.submit}</Button>
					<Button variant="ghost" full disabled={busy} onclick={() => submitWriting(true)}>{t.placement.partC.skip}</Button>
				</div>
			</section>
		{/if}
	</main>
</div>
