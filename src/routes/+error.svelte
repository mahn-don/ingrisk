<script lang="ts">
	import { page } from '$app/state';
	import Button from '#lib/components/Button.svelte';
	import ErrorState from '#lib/components/ErrorState.svelte';
	import { t } from '#lib/messages/vi.js';
</script>

<main id="main" class="mx-auto flex min-h-dvh max-w-md flex-col justify-center px-4">
	<ErrorState message={page.status === 404 ? t.errorPage.notFound : t.errorPage.generic} />
	<Button href="/" variant="secondary" full>{t.errorPage.home}</Button>
</main>
