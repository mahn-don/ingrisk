<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { t } from '#lib/messages/vi.js';

	let { data, form } = $props();
	let submitting = $state(false);
	const messages = { wrong: t.login.wrong, tooMany: t.login.tooMany, notConfigured: t.login.notConfigured };
	const error = $derived(form?.error ? messages[form.error] : null);
</script>

<svelte:head>
	<title>{t.login.title} · {t.app.name}</title>
</svelte:head>

<main id="main" class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(2rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
	<header class="flex flex-col gap-2">
		<img src="/favicon.svg" alt="" width="56" height="56" class="rounded-2xl" />
		<p class="text-xs font-semibold tracking-wide text-muted uppercase">{t.app.name}</p>
		<h1 class="text-2xl font-bold">{t.login.title}</h1>
	</header>

	{#if data.insecure}
		<!-- Non-blocking: plain HTTP is the owner's choice; this only makes it visible. -->
		<p class="mt-4 flex items-start gap-2 rounded-xl border border-warning bg-warning-soft px-3 py-2 text-xs text-warning" data-testid="insecure-notice">
			<Icon name="alert" size={18} class="mt-px shrink-0" />
			<span><strong class="font-semibold">{t.login.insecure}.</strong> {t.login.insecureDetail}</span>
		</p>
	{/if}

	{#if !data.configured}
		<div role="alert" class="mt-8 flex gap-3 rounded-2xl border-2 border-warning bg-warning-soft p-4">
			<Icon name="alert" class="mt-0.5 shrink-0 text-warning" />
			<div>
				<h2 class="font-semibold">{t.login.notConfiguredTitle}</h2>
				<p class="mt-1 text-text">{t.login.notConfigured}</p>
			</div>
		</div>
	{:else}
		<p class="mt-2 text-muted">{t.login.intro}</p>
		<!-- The form sits low on the screen, in the thumb zone. -->
		<form
			method="POST"
			class="mt-auto flex flex-col gap-4 pt-10"
			use:enhance={() => {
				submitting = true;
				return async ({ update }) => {
					await update();
					submitting = false;
				};
			}}
		>
			<input type="hidden" name="next" value={data.next} />
			<label class="flex flex-col gap-2" for="password">
				<span class="text-xs font-semibold text-muted">{t.login.password}</span>
				<input
					id="password"
					name="password"
					type="password"
					autocomplete="current-password"
					required
					class="min-h-12 w-full rounded-xl border-2 bg-surface px-4 text-base {error ? 'border-incorrect' : 'border-control'}"
					aria-invalid={error ? 'true' : undefined}
					aria-describedby={error ? 'login-error' : undefined}
				/>
			</label>
			{#if error}
				<p id="login-error" role="alert" class="flex items-start gap-2 rounded-xl bg-incorrect-soft p-3 text-incorrect">
					<Icon name="alert" class="mt-0.5 shrink-0" size={20} />
					<span>{error}</span>
				</p>
			{/if}
			<Button type="submit" variant="primary" full loading={submitting}>{submitting ? t.login.submitting : t.login.submit}</Button>
		</form>
	{/if}
</main>
