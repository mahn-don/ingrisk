<!--
	TabBar: the bottom navigation, fixed in the thumb zone, clear of the home indicator
	(env(safe-area-inset-bottom)). Tabs are at least 56 px tall; the current one has aria-current.
	<TabBar items={tabs} current={page.url.pathname} />
-->
<script lang="ts">
	import { t } from '#lib/messages/vi.js';
	import Icon, { type IconName } from './Icon.svelte';

	export interface Tab {
		href: string;
		label: string;
		icon: IconName;
	}
	let { items, current }: { items: Tab[]; current: string } = $props();
	const isCurrent = (href: string) => (href === '/' ? current === '/' : current === href || current.startsWith(`${href}/`));
</script>

<nav aria-label={t.nav.label} class="fixed inset-x-0 bottom-0 z-10 border-t border-border bg-surface pb-[env(safe-area-inset-bottom)]">
	<ul class="mx-auto flex max-w-md">
		{#each items as item (item.href)}
			{@const active = isCurrent(item.href)}
			<li class="flex-1">
				<a
					href={item.href}
					aria-current={active ? 'page' : undefined}
					class="flex min-h-14 flex-col items-center justify-center gap-0.5 text-xs font-medium {active ? 'text-primary' : 'text-muted'}"
				>
					<Icon name={item.icon} />
					<span class={active ? 'font-semibold' : ''}>{item.label}</span>
				</a>
			</li>
		{/each}
	</ul>
</nav>
