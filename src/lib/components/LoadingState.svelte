<!--
	LoadingState: a quiet spinner with a text label, announced politely (role="status").
	<LoadingState />
-->
<script lang="ts">
	import { t } from '#lib/messages/vi.js';

	let { label = t.states.loading }: { label?: string } = $props();
</script>

<div role="status" class="flex flex-col items-center gap-3 px-6 py-10 text-center text-muted">
	<span class="size-8 animate-spin rounded-full border-[3px] border-surface-2 border-t-primary" aria-hidden="true"></span>
	<p>{label}</p>
</div>
