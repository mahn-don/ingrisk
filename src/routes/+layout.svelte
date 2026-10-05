<script lang="ts">
	import './layout.css';
	import { t } from '#lib/messages/vi.js';

	let { data, children } = $props();

	// The server renders data-theme on <html> (no flash); keep it in sync after a client-side change.
	$effect(() => {
		document.documentElement.dataset.theme = data.theme ?? 'system';
	});
</script>

<svelte:head>
	<title>{t.app.name}</title>
</svelte:head>

<a href="#main" class="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-20 focus:rounded-lg focus:bg-surface focus:p-3">{t.app.skipToContent}</a>
{@render children()}
