<script lang="ts">
	import { page } from '$app/state';
	import TabBar, { type Tab } from '#lib/components/TabBar.svelte';
	import { t } from '#lib/messages/vi.js';

	let { children } = $props();
	const tabs: Tab[] = [
		{ href: '/', label: t.nav.home, icon: 'home' },
		{ href: '/stats', label: t.nav.stats, icon: 'chart' },
		{ href: '/review', label: t.nav.review, icon: 'book' },
		{ href: '/settings', label: t.nav.settings, icon: 'settings' }
	];
</script>

<div class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))]">
	<main id="main" class="flex flex-1 flex-col">
		{@render children()}
	</main>
</div>
<TabBar items={tabs} current={page.url.pathname} />
