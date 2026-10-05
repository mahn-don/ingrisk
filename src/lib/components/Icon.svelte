<!--
	Icon: small stroke icons drawn for this app (24×24, currentColor). Decorative by default
	(aria-hidden); pass `label` to make the icon itself announce something.
	<Icon name="check" />  <Icon name="alert" label={t.states.errorTitle} />
-->
<script lang="ts" module>
	export type IconName = 'home' | 'chart' | 'settings' | 'close' | 'check' | 'cross' | 'dot' | 'alert' | 'inbox' | 'arrow';

	const PATHS: Record<IconName, string> = {
		home: 'M4 10.5 12 4l8 6.5V20a1 1 0 0 1-1 1h-5v-6h-4v6H5a1 1 0 0 1-1-1z',
		chart: 'M5 20V11M12 20V5M19 20v-6',
		settings: 'M12 15.5a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7ZM19.4 13a7.6 7.6 0 0 0 0-2l2-1.6-2-3.4-2.4 1a7.7 7.7 0 0 0-1.7-1L15 3.5h-4l-.4 2.5a7.7 7.7 0 0 0-1.7 1l-2.4-1-2 3.4 2 1.6a7.6 7.6 0 0 0 0 2l-2 1.6 2 3.4 2.4-1a7.7 7.7 0 0 0 1.7 1l.4 2.5h4l.4-2.5a7.7 7.7 0 0 0 1.7-1l2.4 1 2-3.4z',
		close: 'M6 6l12 12M18 6 6 18',
		check: 'M5 12.5 10 17.5 19 7',
		cross: 'M7 7l10 10M17 7 7 17',
		dot: 'M12 12m-4 0a4 4 0 1 0 8 0 4 4 0 1 0-8 0',
		alert: 'M12 4 2.8 19.5h18.4zM12 10v4.5M12 17.2v.3',
		inbox: 'M3.5 13.5 6 5h12l2.5 8.5V19a1 1 0 0 1-1 1h-15a1 1 0 0 1-1-1zM3.5 13.5H9l1 2h4l1-2h5.5',
		arrow: 'M5 12h14M13 6l6 6-6 6'
	};
</script>

<script lang="ts">
	let { name, label, size = 24, class: className = '' }: { name: IconName; label?: string; size?: number; class?: string } = $props();
</script>

<svg
	class={className}
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill={name === 'dot' ? 'currentColor' : 'none'}
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	role={label ? 'img' : undefined}
	aria-label={label}
	aria-hidden={label ? undefined : 'true'}
	focusable="false"
>
	<path d={PATHS[name]} />
</svg>
