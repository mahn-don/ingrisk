<script lang="ts">
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import EmptyState from '#lib/components/EmptyState.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import LoadingState from '#lib/components/LoadingState.svelte';
	import OptionButton from '#lib/components/OptionButton.svelte';
	import ProgressBar from '#lib/components/ProgressBar.svelte';
	import TextAnswer from '#lib/components/TextAnswer.svelte';
	import { t } from '#lib/messages/vi.js';

	let answer = $state('');
	let wrong = $state('She go to work');
</script>

<svelte:head>
	<title>{t.dev.title}</title>
</svelte:head>

<main id="main">
	{#each [['light', t.dev.light], ['dark', t.dev.dark]] as [theme, label] (theme)}
		<section data-theme={theme} class="bg-bg px-4 py-6 text-text" data-testid="gallery-{theme}">
			<div class="mx-auto flex max-w-md flex-col gap-6">
				<h1 class="text-xl font-bold">{t.dev.title} · {label}</h1>

				<div class="flex flex-col gap-3">
					<h2 class="font-semibold">{t.dev.buttons}</h2>
					<Button variant="primary" full>{t.dev.primary}</Button>
					<Button variant="secondary" full>{t.dev.secondary}</Button>
					<Button variant="ghost" full>{t.dev.ghost}</Button>
					<Button variant="primary" full disabled>{t.dev.disabled}</Button>
					<Button variant="primary" full loading>{t.dev.loading}</Button>
				</div>

				<Card title={t.dev.card}><p>{t.dev.cardBody}</p></Card>

				<div class="flex flex-col gap-3">
					<h2 class="font-semibold">{t.dev.progress}</h2>
					<ProgressBar value={0} max={10} />
					<ProgressBar value={4} max={10} />
					<ProgressBar value={10} max={10} />
				</div>

				<div class="flex flex-col gap-3">
					<h2 class="font-semibold">{t.dev.options}</h2>
					<OptionButton label={t.dev.optionIdle} />
					<OptionButton label={t.dev.optionSelected} state="selected" />
					<OptionButton label={t.dev.optionCorrect} state="correct" />
					<OptionButton label={t.dev.optionIncorrect} state="incorrect" />
					<OptionButton label={t.dev.optionIdle} disabled />
				</div>

				<div class="flex flex-col gap-3">
					<h2 class="font-semibold">{t.dev.textAnswer}</h2>
					<TextAnswer id="answer-{theme}" label={t.dev.textAnswerLabel} placeholder={t.dev.textAnswerPlaceholder} bind:value={answer} />
					<TextAnswer id="wrong-{theme}" label={t.dev.textAnswerLabel} invalid bind:value={wrong} />
				</div>

				<div class="flex flex-col gap-1">
					<h2 class="font-semibold">{t.dev.states}</h2>
					<Card><EmptyState title={t.stats.emptyTitle} body={t.stats.emptyBody} /></Card>
					<Card><ErrorState message={t.errorPage.generic} onretry={() => {}} /></Card>
					<Card><LoadingState /></Card>
				</div>

				<div class="flex flex-col gap-2">
					<h2 class="font-semibold">{t.dev.reading}</h2>
					<p lang="en" class="font-reading text-reading">{t.dev.readingSample}</p>
					<!-- Diacritics at the smallest size used (13 px), in both fonts. -->
					<p class="text-xs">{t.dev.diacritics}</p>
					<p class="font-reading text-xs">{t.dev.diacritics}</p>
					<p class="text-base">{t.dev.diacritics}</p>
				</div>
			</div>
		</section>
	{/each}
</main>
