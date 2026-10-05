<!--
	ProgressBar: an accessible progress bar (role="progressbar").
	<ProgressBar value={3} max={10} label={t.states.progress} />
-->
<script lang="ts">
	import { t } from '#lib/messages/vi.js';

	let { value, max = 100, label = t.states.progress }: { value: number; max?: number; label?: string } = $props();
	const percent = $derived(max <= 0 ? 0 : Math.min(100, Math.max(0, (value / max) * 100)));
</script>

<div
	role="progressbar"
	aria-label={label}
	aria-valuemin={0}
	aria-valuemax={max}
	aria-valuenow={value}
	class="h-2.5 w-full overflow-hidden rounded-full bg-surface-2"
>
	<div class="h-full rounded-full bg-primary transition-[width] duration-300" style="width: {percent}%"></div>
</div>
