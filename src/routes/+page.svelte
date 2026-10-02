<script lang="ts">
	import { t } from '#lib/messages/vi.js';
</script>

<svelte:head>
	<title>{t.app.name}</title>
</svelte:head>

<main class="mx-auto flex min-h-dvh max-w-md flex-col justify-center gap-3 p-6">
	<p class="text-sm font-semibold tracking-wide text-slate-500 uppercase">{t.app.name}</p>
	<h1 class="text-2xl font-bold text-slate-900">{t.home.greeting}</h1>
	<p class="text-slate-600">{t.home.tagline}</p>
</main>
