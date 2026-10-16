/**
 * Embed Mode Store
 *
 * Detects if the playground is running in embed mode (via ?embed=true URL param).
 * In embed mode, certain UI elements are hidden (settings, bytecode, share).
 */

import { readable, writable } from "svelte/store";
import type { ThemeMode } from "$lib/utils/theme.ts";

export type EmbedControls = "text" | "icons";

export function detectEmbedMode(): boolean {
	if (typeof window === "undefined") return false;
	const params = new URLSearchParams(window.location.search);
	return params.get("embed") === "true";
}

function detectEmbedControls(): EmbedControls {
	if (typeof window === "undefined") return "text";
	return new URLSearchParams(window.location.search).get("controls") === "icons" ? "icons" : "text";
}

function detectEmbedExpandId(): string | null {
	if (typeof window === "undefined") return null;
	return new URLSearchParams(window.location.search).get("expandId");
}

function detectEmbedTheme(): ThemeMode {
	if (typeof window === "undefined") return "system";
	const params = new URLSearchParams(window.location.search);
	const theme = params.get("theme");
	if (theme === "dark" || theme === "light") return theme;
	return "system";
}

/**
 * Whether the playground is in embed mode.
 */
export const isEmbed = readable(detectEmbedMode());

/**
 * Theme preference from embed URL param.
 */
export const embedTheme = readable(detectEmbedTheme());

/**
 * Text or icon labels for the embed action row. Defaults to text.
 */
export const embedControls = readable(detectEmbedControls());

/**
 * Id of the host page's expand checkbox. Present only when the code is taller
 * than the collapsed height, so this is also the signal to offer Expand.
 */
export const embedExpandId = readable(detectEmbedExpandId());

/**
 * Whether the host page's snippet script answered. Hosts that strip scripts
 * never answer, so the expand button stays hidden instead of doing nothing.
 */
export const embedHostReady = writable(false);

function listenForHost(): void {
	const id = detectEmbedExpandId();
	if (!id || window.parent === window) return;
		window.addEventListener("message", (event) => {
		if (event.source !== window.parent) return;
		const data = event.data;
		if (data?.type === "luau-embed-host" && data.id === id) embedHostReady.set(true);
	});
	window.parent.postMessage({ type: "luau-embed-init", id }, "*");
}

if (typeof window !== "undefined") listenForHost();
