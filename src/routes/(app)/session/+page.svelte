<script lang="ts">
	import EmptyState from '#lib/components/EmptyState.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { t } from '#lib/messages/vi.js';
</script>

<svelte:head>
	<title>{t.session.title} · {t.app.name}</title>
</svelte:head>

<!-- Full screen: no tab bar, one exit. -->
<div class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]">
	<header class="flex items-center justify-between">
		<h1 class="text-lg font-semibold">{t.session.title}</h1>
		<a href="/" class="-mr-2 flex size-12 items-center justify-center rounded-full text-muted" aria-label={t.session.exit}>
			<Icon name="close" />
		</a>
	</header>
	<main id="main" class="flex flex-1 items-center justify-center">
		<EmptyState title={t.session.placeholderTitle} body={t.session.placeholderBody} />
	</main>
</div>
