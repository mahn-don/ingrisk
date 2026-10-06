<!--
	Button: primary / secondary / ghost, at least 48 px tall. `loading` shows a spinner, disables the
	button and sets aria-busy. With `href` it renders a link styled as a button.
	<Button variant="primary" full loading={saving} onclick={save}>{t.settings.logout}</Button>
-->
<script lang="ts">
	import type { Snippet } from 'svelte';
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { t } from '#lib/messages/vi.js';

	type Props = HTMLButtonAttributes & {
		variant?: 'primary' | 'secondary' | 'ghost';
		loading?: boolean;
		full?: boolean;
		href?: string;
		children: Snippet;
	};
	let { variant = 'primary', loading = false, full = false, href, disabled = false, type = 'button', class: className = '', children, ...rest }: Props = $props();

	const variants = {
		primary: 'bg-primary text-primary-contrast border-primary',
		secondary: 'bg-surface text-primary border-control',
		ghost: 'bg-transparent text-primary border-transparent'
	};
	const classes = $derived(
		[
			'inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border-2 px-5 text-base font-semibold',
			'transition-[opacity,transform] duration-150 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-50',
			'aria-disabled:pointer-events-none aria-disabled:opacity-50',
			variants[variant],
			full ? 'w-full' : '',
			className
		].join(' ')
	);
</script>

{#snippet content()}
	{#if loading}
		<span class="size-5 animate-spin rounded-full border-2 border-current border-t-transparent" aria-hidden="true"></span>
		<span class="sr-only">{t.states.loading}</span>
	{/if}
	{@render children()}
{/snippet}

{#if href !== undefined}
	<a {href} class={classes} aria-label={rest['aria-label']} aria-disabled={disabled || loading ? 'true' : undefined}>{@render content()}</a>
{:else}
	<button {type} class={classes} disabled={disabled || loading} aria-busy={loading || undefined} {...rest}>{@render content()}</button>
{/if}
