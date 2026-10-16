<script lang="ts">
	import Button from "$lib/components/Button.svelte";
	import Icon from "$lib/icons/Icon.svelte";
	import { generateEmbedCode } from "$lib/utils/share.ts";
	import { DEFAULT_EMBED_HEIGHT } from "$lib/editor/metrics.ts";
	import { copyText } from "$lib/utils/clipboard.ts";
	import { files, activeFile } from "$lib/stores/playground.ts";
	import { settings, showBytecode } from "$lib/stores/settings.ts";
	import { CURRENT_VERSION } from "$lib/constants.ts";
	import type { ThemeMode } from "$lib/utils/theme.ts";
	import type { EmbedControls } from "$lib/stores/embed.ts";

	const themeOptions: { value: ThemeMode; label: string }[] = [
		{ value: "system", label: "Auto" },
		{ value: "light", label: "Light" },
		{ value: "dark", label: "Dark" },
	];

	const controlOptions: { value: EmbedControls; label: string }[] = [
		{ value: "text", label: "Text" },
		{ value: "icons", label: "Icons" },
	];

	let selectedTheme = $state<ThemeMode>("system");
	let selectedControls = $state<EmbedControls>("text");
	let copySuccess = $state(false);

	let embedCode = $derived(generateEmbedCode(selectedTheme, selectedControls, DEFAULT_EMBED_HEIGHT, {
		files: $files,
		active: $activeFile,
		v: CURRENT_VERSION,
		settings: $settings,
		showBytecode: $showBytecode,
	}));

	async function handleCopy() {
		copySuccess = await copyText(embedCode);
		if (!copySuccess) return;
		setTimeout(() => { copySuccess = false; }, 2000);
	}
</script>

<Button
	size="sm"
	variant="secondary"
	class="embed-trigger px-2 sm:px-3"
	title="Get embed code"
	popovertarget="embed-popover"
>
	<span class="hidden sm:inline">Embed</span>
	<span class="sm:hidden"><Icon name="code" size="16px" /></span>
</Button>

<div
	popover="auto"
	id="embed-popover"
	class="embed-popover m-0 w-96 max-w-[calc(100vw-1.5rem)] max-h-[80vh] overflow-y-auto rounded-lg border border-(--border-color) bg-(--bg-secondary) p-4 shadow-xl"
>
	<div class="space-y-4">
		<div>
			<h3 class="text-sm font-semibold text-(--text-primary) mb-1">Embed Playground</h3>
			<p class="text-xs text-(--text-muted)">
				Copy the code below to embed this playground on your site.
			</p>
		</div>

		<!-- Theme selector -->
		<div class="space-y-1.5">
			<span class="text-xs text-(--text-muted)">Theme</span>
			<div class="flex gap-1">
				{#each themeOptions as option (option.value)}
					{const isSelected = $derived(selectedTheme === option.value)}
					<button
						type="button"
						class="flex-1 px-2 py-1.5 text-xs rounded-md transition-colors border {isSelected
							? 'bg-(--bg-tertiary) border-(--accent) text-(--text-primary)'
							: 'hover:bg-(--bg-tertiary) border-transparent text-(--text-secondary)'}"
						onclick={() => { selectedTheme = option.value; }}
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>

		<!-- Control style -->
		<div class="space-y-1.5">
			<span class="text-xs text-(--text-muted)">Controls</span>
			<div class="flex gap-1">
				{#each controlOptions as option (option.value)}
					{const isSelected = $derived(selectedControls === option.value)}
					<button
						type="button"
						class="flex-1 px-2 py-1.5 text-xs rounded-md transition-colors border {isSelected
							? 'bg-(--bg-tertiary) border-(--accent) text-(--text-primary)'
							: 'hover:bg-(--bg-tertiary) border-transparent text-(--text-secondary)'}"
						onclick={() => { selectedControls = option.value; }}
					>
						{option.label}
					</button>
				{/each}
			</div>
		</div>

		<div class="border-t border-(--border-color)"></div>

		<!-- Embed code -->
		<div class="space-y-2">
			<span class="text-xs text-(--text-muted)">HTML</span>
			<pre
				class="max-h-64 w-full overflow-auto rounded-md border border-(--border-color) bg-(--bg-editor) p-3 text-xs text-(--text-secondary) font-mono whitespace-pre leading-relaxed"
			>{embedCode}</pre>
			<Button
				size="sm"
				variant={copySuccess ? "default" : "secondary"}
				onclick={handleCopy}
				class="w-full"
			>
				{#if copySuccess}
					<Icon name="check" size="14px" />
					<span class="ml-1.5">Copied!</span>
				{:else}
					Copy Code
				{/if}
			</Button>
		</div>
	</div>
</div>

<style>
	:global(.embed-trigger) {
		anchor-name: --embed-trigger;
	}

	.embed-popover {
		position-anchor: --embed-trigger;
		position-area: bottom span-left;
		position-try-fallbacks: flip-block;
		margin-top: 8px;
	}

	.embed-popover::backdrop {
		background: transparent;
	}
</style>
