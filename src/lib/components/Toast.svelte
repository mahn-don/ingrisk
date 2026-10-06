<!--
	Toast: a short message over the tab bar (role="alert"), hidden after a few seconds or on close.
	A new message object shows again even with the same text.
	<Toast message={form?.toast ?? null} />
-->
<script lang="ts">
	import { t } from '#lib/messages/vi.js';
	import Icon from './Icon.svelte';

	let { message, duration = 6000 }: { message: string | null; duration?: number } = $props();
	let visible = $state(false);

	$effect(() => {
		if (message === null) return;
		visible = true;
		const timer = setTimeout(() => (visible = false), duration);
		return () => clearTimeout(timer);
	});
</script>

{#if visible && message}
	<div class="fixed inset-x-0 bottom-[calc(4.5rem+env(safe-area-inset-bottom))] z-40 mx-auto flex max-w-md justify-center px-4">
		<div role="alert" class="flex w-full items-start gap-2 rounded-xl border border-border bg-incorrect-soft px-4 py-3 text-sm text-text shadow-lg" data-testid="toast">
			<span class="mt-0.5 text-incorrect"><Icon name="alert" size={18} /></span>
			<p class="flex-1">{message}</p>
			<button type="button" class="-m-2 flex size-10 items-center justify-center text-muted" onclick={() => (visible = false)}>
				<Icon name="close" size={18} label={t.review.close} />
			</button>
		</div>
	</div>
{/if}
