<script lang="ts">
	import { enhance } from '$app/forms';
	import Button from '#lib/components/Button.svelte';
	import Card from '#lib/components/Card.svelte';
	import Icon from '#lib/components/Icon.svelte';
	import { fill } from '#lib/format.js';
	import { t } from '#lib/messages/vi.js';

	let { data, form } = $props();
	const m = t.settings.providersPage;
	let confirmDelete = $state<number | null>(null);
	let testing = $state<number | null>(null);
	const formOpen = $derived(data.adding || data.editing !== null);
	const p = $derived(data.editing);
	const saveError = $derived(form && 'save' in form ? (form.save ?? null) : null);
	const invalid = (field: string) => saveError !== null && saveError.fields.includes(field);
	const test = $derived(form && 'test' in form ? form.test : null);
	const done = $derived(form && 'done' in form ? form.done : null);
	const fieldClass = (field: string) =>
		`mt-1 min-h-12 w-full rounded-xl border-2 bg-surface px-3 text-base ${invalid(field) ? 'border-incorrect' : 'border-control'}`;
	const keep = () => async ({ update }: { update: (o?: { reset?: boolean }) => Promise<void> }) => update({ reset: false });
</script>

<svelte:head>
	<title>{m.title} · {t.app.name}</title>
</svelte:head>

<a href="/settings" class="-ml-1 flex min-h-11 w-fit items-center gap-1 font-medium text-primary"
	><Icon name="arrow" size={18} class="rotate-180" />{m.back}</a
>
<h1 class="mt-1 text-2xl font-bold">{m.title}</h1>
<p class="mt-3 rounded-xl bg-warning-soft px-3 py-2 text-sm text-text" data-testid="key-note">{m.keyNote}</p>

{#if data.saved}<p role="status" class="mt-3 rounded-xl bg-correct-soft px-3 py-2 text-sm">{m.saved}</p>{/if}
{#if done === 'deleted'}<p role="status" class="mt-3 rounded-xl bg-correct-soft px-3 py-2 text-sm">{m.deleted}</p>{/if}

{#if formOpen}
	<div class="mt-4">
		<Card title={p ? m.editTitle : m.addTitle}>
			<form method="POST" action={p ? `?edit=${p.id}&/save` : '?add&/save'} class="flex flex-col gap-4" use:enhance={keep} data-testid="provider-form" autocomplete="off">
				{#if p}<input type="hidden" name="id" value={p.id} />{/if}
				<div>
					<label for="pv-name" class="font-medium">{m.name}</label>
					<input id="pv-name" name="name" required maxlength="40" value={p?.name ?? ''} class={fieldClass('name')} aria-invalid={invalid('name') || undefined} />
					{#if invalid('name')}<p class="mt-1 text-sm text-incorrect">{m.fieldErrors.name}</p>{/if}
				</div>
				<div>
					<label for="pv-url" class="font-medium">{m.baseUrlLabel}</label>
					<input
						id="pv-url"
						name="baseUrl"
						required
						inputmode="url"
						autocapitalize="off"
						spellcheck="false"
						value={p?.baseUrl ?? ''}
						class={fieldClass('baseUrl')}
						aria-invalid={invalid('baseUrl') || undefined}
					/>
					{#if invalid('baseUrl')}<p class="mt-1 text-sm text-incorrect">{m.fieldErrors.baseUrl}</p>{/if}
				</div>
				<div>
					<label for="pv-model" class="font-medium">{m.modelLabel}</label>
					<input id="pv-model" name="model" required autocapitalize="off" spellcheck="false" value={p?.model ?? ''} class={fieldClass('model')} aria-invalid={invalid('model') || undefined} />
					{#if invalid('model')}<p class="mt-1 text-sm text-incorrect">{m.fieldErrors.model}</p>{/if}
				</div>
				<div class="flex flex-col gap-4">
					<div>
						<label for="pv-wire" class="font-medium">{m.wireLabel}</label>
						<select id="pv-wire" name="wireFormat" class={fieldClass('wireFormat')}>
							{#each ['openai', 'anthropic'] as wire (wire)}<option value={wire} selected={p?.wireFormat === wire}>{wire}</option>{/each}
						</select>
					</div>
					<div>
						<label for="pv-mode" class="font-medium">{m.modeLabel}</label>
						<select id="pv-mode" name="structuredMode" class={fieldClass('structuredMode')}>
							{#each ['json_schema', 'tool', 'json_prompt'] as mode (mode)}<option value={mode} selected={p?.structuredMode === mode}>{mode}</option>{/each}
						</select>
					</div>
				</div>
				<div>
					<label for="pv-env" class="font-medium">{m.envKeyLabel}</label>
					<input
						id="pv-env"
						name="envKeyName"
						maxlength="64"
						autocapitalize="characters"
						spellcheck="false"
						value={p?.envKeyName ?? ''}
						aria-describedby="pv-env-help"
						class="{fieldClass('envKeyName')} font-mono"
						aria-invalid={invalid('envKeyName') || undefined}
					/>
					<p id="pv-env-help" class="mt-1 text-sm {invalid('envKeyName') ? 'text-incorrect' : 'text-muted'}">{invalid('envKeyName') ? m.fieldErrors.envKeyName : m.envKeyHelp}</p>
				</div>
				{#if saveError?.error === 'name_taken'}<p role="alert" class="text-sm text-incorrect">{m.nameTaken}</p>{/if}
				{#if saveError?.error === 'not_found'}<p role="alert" class="text-sm text-incorrect">{m.notFound}</p>{/if}
				<div class="grid grid-cols-2 gap-2">
					<Button variant="secondary" full href="/settings/providers">{m.cancel}</Button>
					<Button type="submit" variant="primary" full>{m.save}</Button>
				</div>
			</form>
		</Card>
	</div>
{:else}
	<div class="mt-4"><Button variant="primary" full href="/settings/providers?add">{m.add}</Button></div>
{/if}

{#if data.providers.length === 0}
	<p class="mt-6 text-muted">{m.empty}</p>
{:else}
	<ul class="mt-4 flex flex-col gap-3" data-testid="provider-list">
		{#each data.providers as provider (provider.id)}
			<li data-testid="provider" data-name={provider.name}>
				<Card>
					<div class="flex flex-wrap items-center gap-2">
						<h2 class="text-lg font-semibold">{provider.name}</h2>
						{#if provider.active}<span class="rounded-full bg-primary-soft px-2 py-0.5 text-xs font-semibold text-primary">{m.active}</span>{/if}
						{#if provider.isFallback}<span class="rounded-full bg-surface-2 px-2 py-0.5 text-xs font-semibold">{m.fallback}</span>{/if}
						{#if !provider.enabled}<span class="rounded-full bg-surface-2 px-2 py-0.5 text-xs">{m.disabled}</span>{/if}
					</div>
					<dl class="mt-2 flex flex-col gap-0.5 text-sm">
						<dd>{fill(m.model, { model: provider.model })}</dd>
						<dd class="break-all">{fill(m.baseUrl, { url: provider.baseUrl })}</dd>
						<dd>{fill(m.wire, { wire: provider.wireFormat, mode: provider.structuredMode })}</dd>
						<dd data-testid="provider-key">
							{#if provider.envKeyName === null}{m.envKeyNone}{:else}{fill(m.envKey, { name: provider.envKeyName })} —
								<span class="font-semibold {provider.keySet ? 'text-correct' : 'text-warning'}">{provider.keySet ? m.keySet : m.keyMissing}</span>{/if}
						</dd>
					</dl>
					{#if test && test.id === provider.id}
						<p role="status" class="mt-3 rounded-xl px-3 py-2 text-sm break-words {test.ok ? 'bg-correct-soft' : 'bg-incorrect-soft'}" data-testid="provider-test">
							{test.ok ? fill(m.testOk, { ms: test.latencyMs, model: test.model }) : fill(m.testFailed, { code: test.code, ms: test.latencyMs, message: test.message })}
						</p>
					{/if}
					<div class="mt-3 grid grid-cols-2 gap-2">
						<form
							method="POST"
							action="?/test"
							class="col-span-2"
							use:enhance={() => {
								testing = provider.id;
								return async ({ update }) => {
									await update({ reset: false });
									testing = null;
								};
							}}
						>
							<input type="hidden" name="id" value={provider.id} />
							<Button type="submit" variant="secondary" full loading={testing === provider.id}>{testing === provider.id ? m.testing : m.test}</Button>
						</form>
						{#if !provider.active}
							<form method="POST" action="?/active" class="col-span-2" use:enhance={keep}>
								<input type="hidden" name="id" value={provider.id} />
								<Button type="submit" variant="secondary" full>{m.setActive}</Button>
							</form>
						{/if}
						<form method="POST" action="?/fallback" class="col-span-2" use:enhance={keep}>
							<input type="hidden" name="id" value={provider.isFallback ? '' : provider.id} />
							<Button type="submit" variant="ghost" full>{provider.isFallback ? m.clearFallback : m.setFallback}</Button>
						</form>
						<Button variant="ghost" full href="/settings/providers?edit={provider.id}">{m.edit}</Button>
						{#if confirmDelete === provider.id}
							<form method="POST" action="?/delete" use:enhance={keep} class="col-span-2 flex flex-col gap-2 rounded-xl bg-incorrect-soft p-3">
								<p class="text-sm">{fill(m.deleteConfirm, { name: provider.name })}</p>
								<input type="hidden" name="id" value={provider.id} />
								<div class="grid grid-cols-2 gap-2">
									<Button variant="secondary" full onclick={() => (confirmDelete = null)}>{m.cancel}</Button>
									<Button type="submit" variant="primary" full>{m.deleteYes}</Button>
								</div>
							</form>
						{:else}
							<Button variant="ghost" full onclick={() => (confirmDelete = provider.id)}>{m.delete}</Button>
						{/if}
					</div>
				</Card>
			</li>
		{/each}
	</ul>
{/if}
