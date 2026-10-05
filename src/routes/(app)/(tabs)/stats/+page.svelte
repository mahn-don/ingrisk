<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import { t } from '#lib/messages/vi.js';
</script>

<svelte:head>
	<title>{t.stats.title} · {t.app.name}</title>
</svelte:head>

<h1 class="text-2xl font-bold">{t.stats.title}</h1>
<div class="flex flex-1 items-center justify-center">
	<EmptyState icon="chart" title={t.stats.emptyTitle} body={t.stats.emptyBody} />
</div>
