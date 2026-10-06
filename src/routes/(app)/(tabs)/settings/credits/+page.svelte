<script lang="ts">
	import Card from '#lib/components/Card.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';

	let { data } = $props();
	const m = t.settings.creditsPage;
</script>

<svelte:head>
	<title>{m.title} · {t.app.name}</title>
</svelte:head>

<a href="/settings" class="-ml-1 flex min-h-11 w-fit items-center gap-1 font-medium text-primary"
	><Icon name="arrow" size={18} class="rotate-180" />{m.back}</a
>
<h1 class="mt-1 text-2xl font-bold">{m.title}</h1>
<p class="mt-2 text-muted">{m.intro}</p>

<ul class="mt-4 flex flex-col gap-3" data-testid="credits">
	{#each data.credits.sources as source (source.id)}
		<li>
			<Card>
				<p>{m[source.id]}</p>
				<p class="mt-1 text-sm">
					<a class="font-semibold text-primary underline" href={source.url} rel="noopener noreferrer" target="_blank">{source.url.replace('https://', '')}</a>
					· <a class="text-primary underline" href={source.licenseUrl} rel="noopener noreferrer" target="_blank">{fill(m.license, { license: source.license })}</a>
				</p>
			</Card>
		</li>
	{/each}
	{#each data.credits.packages as pkg (pkg.name)}
		<li>
			<Card>
				<p>{fill(m.package, { name: pkg.name, version: pkg.version, license: pkg.license })}</p>
				<p class="mt-1 text-sm"><a class="text-primary underline" href={pkg.url} rel="noopener noreferrer" target="_blank">{pkg.url.replace('https://', '')}</a></p>
			</Card>
		</li>
	{/each}
</ul>
{#if data.credits.other.length > 0}
	<p class="mt-4 text-sm text-muted">{fill(m.other, { tags: data.credits.other.join(', ') })}</p>
{/if}
<p class="mt-4 text-sm text-muted">{m.generated}</p>
