<script lang="ts">
	import { page } from '$app/state';
	import TabBar, { type Tab } from '#lib/components/TabBar.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';

	let { data, children } = $props();
	const tabs: Tab[] = [
		{ href: '/', label: t.nav.home, icon: 'home' },
		{ href: '/stats', label: t.nav.stats, icon: 'chart' },
		{ href: '/review', label: t.nav.review, icon: 'book' },
		{ href: '/settings', label: t.nav.settings, icon: 'settings' }
	];
	const profileName = $derived(data.profile ? [data.profile.emoji, data.profile.name].filter(Boolean).join(' ') : '');
</script>

<div class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[calc(5rem+env(safe-area-inset-bottom))]">
	{#if data.profile}
		<header class="mb-3 flex min-h-12 items-center justify-between gap-3" data-testid="profile-header">
			<span class="truncate font-medium" data-testid="profile-current">{fill(t.profiles.current, { name: profileName })}</span>
			<a href="/profiles" class="flex min-h-12 shrink-0 items-center font-semibold text-primary underline">{t.profiles.switch}</a>
		</header>
	{/if}
	<main id="main" class="flex flex-1 flex-col">
		{@render children()}
	</main>
</div>
<TabBar items={tabs} current={page.url.pathname} />
