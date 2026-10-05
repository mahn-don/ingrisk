<!--
	OptionButton: a large multiple-choice answer. States idle / selected / correct / incorrect are
	told apart by colour AND by an icon with a text tag (t.states.selected / correct / incorrect) and border weight,
	so they work without colour. The option text is English (lang="en").
	<OptionButton label="went" state={state} onclick={() => choose(0)} />
-->
<script lang="ts">
	import type { HTMLButtonAttributes } from 'svelte/elements';
	import { t } from '#lib/messages/vi.js';
	import Icon, { type IconName } from './Icon.svelte';

	type State = 'idle' | 'selected' | 'correct' | 'incorrect';
	type Props = HTMLButtonAttributes & { label: string; state?: State };
	let { label, state = 'idle', disabled = false, ...rest }: Props = $props();

	const styles: Record<State, string> = {
		idle: 'border-control bg-surface text-text',
		selected: 'border-primary bg-primary-soft text-text border-[3px]',
		correct: 'border-correct bg-correct-soft text-text border-[3px]',
		incorrect: 'border-incorrect bg-incorrect-soft text-text border-[3px] border-dashed'
	};
	const tags: Record<Exclude<State, 'idle'>, { icon: IconName; text: string; tone: string }> = {
		selected: { icon: 'dot', text: t.states.selected, tone: 'text-primary' },
		correct: { icon: 'check', text: t.states.correct, tone: 'text-correct' },
		incorrect: { icon: 'cross', text: t.states.incorrect, tone: 'text-incorrect' }
	};
	const tag = $derived(state === 'idle' ? null : tags[state]);
</script>

<button
	type="button"
	class="flex min-h-14 w-full items-center justify-between gap-3 rounded-xl border-2 px-4 py-3 text-left text-base transition-colors duration-150 disabled:cursor-default {styles[state]}"
	aria-pressed={state === 'selected' ? 'true' : undefined}
	{disabled}
	{...rest}
>
	<span lang="en" class="font-reading text-reading font-medium">{label}</span>
	{#if tag}
		<span class="flex shrink-0 items-center gap-1 text-xs font-semibold {tag.tone}">
			<Icon name={tag.icon} size={20} />
			<span>{tag.text}</span>
		</span>
	{/if}
</button>
