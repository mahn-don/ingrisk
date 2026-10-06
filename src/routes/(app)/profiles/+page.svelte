<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';

	let { data, form } = $props();
	const m = t.profiles;

	let adding = $state(false);
	let editing = $state<number | null>(null);
	let archiving = $state<{ id: number; name: string } | null>(null);
	let dialog = $state<HTMLDialogElement>();

	const label = (p: { name: string; emoji: string | null }) => (p.emoji ? `${p.emoji} ${p.name}` : p.name);
	const errorText = (error: string | undefined) =>
		error === 'invalid' ? m.invalid : error === 'name_taken' ? m.nameTaken : error === 'not_found' ? m.notFound : null;
	const formError = $derived(form && 'error' in form ? errorText(form.error) : null);
	const done = $derived(form && 'done' in form ? (form.done === 'archived' ? m.archived : m.saved) : null);
	const inputClass = 'min-h-12 w-full rounded-xl border-2 border-control bg-surface px-3 text-base';

	function confirmArchive(p: { id: number; name: string }) {
		archiving = p;
		dialog?.showModal();
	}
	function closeDialog() {
		dialog?.close();
		archiving = null;
	}
</script>

<svelte:head>
	<title>{m.pageTitle} · {t.app.name}</title>
</svelte:head>

<div class="mx-auto flex min-h-dvh max-w-md flex-col px-4 pt-[max(1.5rem,env(safe-area-inset-top))] pb-[max(1.5rem,env(safe-area-inset-bottom))]">
	<main id="main" class="flex flex-1 flex-col">
		<h1 class="text-2xl font-bold">{m.title}</h1>
		<p class="mt-1 text-muted">{m.intro}</p>

		{#if formError}
			<p role="alert" class="mt-4 rounded-xl border-2 border-incorrect bg-incorrect-soft p-3" data-testid="profiles-error">{formError}</p>
		{:else if done}
			<p role="status" class="mt-4" data-testid="profiles-status">{done}</p>
		{/if}

		{#if data.profiles.length === 0}
			<p class="mt-6 text-muted">{m.empty}</p>
		{/if}

		<ul class="mt-6 grid grid-cols-2 gap-3" data-testid="profiles-grid">
			{#each data.profiles as profile (profile.id)}
				<li class="flex flex-col gap-1">
					<form method="POST" action="?/select" use:enhance>
						<input type="hidden" name="id" value={profile.id} />
						<input type="hidden" name="next" value={data.next} />
						<button
							type="submit"
							aria-label={fill(m.open, { name: profile.name })}
							aria-current={profile.id === data.currentId ? 'true' : undefined}
							data-testid="profile-{profile.id}"
							class="flex min-h-36 w-full flex-col items-center justify-center gap-1 rounded-2xl border-2 p-3 text-center {profile.id === data.currentId
								? 'border-primary bg-primary-soft'
								: 'border-control bg-surface'}"
						>
							<span class="text-4xl leading-none" aria-hidden="true">{profile.emoji ?? profile.name.slice(0, 1).toUpperCase()}</span>
							<span class="mt-1 font-semibold break-words">{profile.name}</span>
							<span class="text-sm text-muted">{profile.cefr ? fill(m.level, { cefr: profile.cefr }) : m.levelNone}</span>
							<span class="text-sm text-muted">{fill(m.streak, { n: profile.streak })}</span>
						</button>
					</form>
					<Button variant="ghost" full onclick={() => (editing = editing === profile.id ? null : profile.id)} aria-expanded={editing === profile.id}>
						{m.edit}
					</Button>
				</li>
			{/each}
		</ul>

		{#each data.profiles as profile (profile.id)}
			{#if editing === profile.id}
				<Card title={fill(m.editTitle, { name: profile.name })} class="mt-4">
					<form
						method="POST"
						action="?/rename"
						class="flex flex-col gap-3"
						data-testid="profile-edit"
						use:enhance={() =>
							async ({ result, update }) => {
								await update({ reset: false });
								if (result.type === 'success') editing = null;
							}}
					>
						<input type="hidden" name="id" value={profile.id} />
						<label class="flex flex-col gap-1">
							<span>{m.name}</span>
							<input name="name" required maxlength="30" value={profile.name} class={inputClass} />
						</label>
						<label class="flex flex-col gap-1">
							<span>{m.emoji}</span>
							<input name="emoji" maxlength="16" value={profile.emoji ?? ''} class={inputClass} />
						</label>
						<Button type="submit" variant="primary" full>{m.save}</Button>
						<Button variant="secondary" full onclick={() => (editing = null)}>{m.cancel}</Button>
						<Button variant="ghost" full onclick={() => confirmArchive(profile)} data-testid="profile-archive">{m.archive}</Button>
					</form>
				</Card>
			{/if}
		{/each}

		{#if adding}
			<Card title={m.addTitle} class="mt-4">
				<form method="POST" action="?/create" class="flex flex-col gap-3" data-testid="profile-create" use:enhance>
					<label class="flex flex-col gap-1">
						<span>{m.name}</span>
						<!-- svelte-ignore a11y_autofocus -->
						<input name="name" required maxlength="30" autofocus class={inputClass} />
					</label>
					<label class="flex flex-col gap-1">
						<span>{m.emoji}</span>
						<input name="emoji" maxlength="16" class={inputClass} />
					</label>
					<Button type="submit" variant="primary" full>{m.create}</Button>
					<Button variant="secondary" full onclick={() => (adding = false)}>{m.cancel}</Button>
				</form>
			</Card>
		{:else}
			<div class="mt-6">
				<Button variant="secondary" full onclick={() => (adding = true)} data-testid="profile-add">{m.add}</Button>
			</div>
		{/if}

		<form method="POST" action="?/logout" class="mt-auto pt-8">
			<Button type="submit" variant="ghost" full>{m.logout}</Button>
		</form>
	</main>
</div>

<dialog
	bind:this={dialog}
	aria-labelledby="archive-title"
	class="m-auto w-[min(24rem,calc(100vw-2rem))] rounded-2xl border border-border bg-surface p-5 text-text backdrop:bg-black/50"
	onclose={() => (archiving = null)}
	data-testid="archive-dialog"
>
	{#if archiving}
		<h2 id="archive-title" class="text-lg font-semibold">{fill(m.archiveConfirmTitle, { name: archiving.name })}</h2>
		<p class="mt-2">{m.archiveConfirm}</p>
		<form
			method="POST"
			action="?/archive"
			class="mt-4 flex flex-col gap-2"
			use:enhance={() =>
				async ({ update }) => {
					closeDialog();
					editing = null;
					await update();
				}}
		>
			<input type="hidden" name="id" value={archiving.id} />
			<Button type="submit" variant="primary" full>{m.archiveYes}</Button>
			<Button variant="secondary" full onclick={closeDialog}>{m.cancel}</Button>
		</form>
	{/if}
</dialog>
