import { writable } from "svelte/store";

export type ThemeMode = "system" | "light" | "dark";

export const themeMode = writable<ThemeMode>("system");

function getSystemTheme(): "light" | "dark" {
	if (typeof window === "undefined") return "dark";
	return window.matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark";
}

function applyTheme(mode: ThemeMode) {
	const resolvedTheme = mode === "system" ? getSystemTheme() : mode;

	if (resolvedTheme === "light") {
		document.documentElement.classList.add("light");
	} else {
		document.documentElement.classList.remove("light");
	}
}

export function initTheme() {
	// Load saved preference
	const saved = localStorage.getItem("theme") as ThemeMode | null;
	if (saved && ["system", "light", "dark"].includes(saved)) {
		themeMode.set(saved);
	}

	// Subscribe to changes
	themeMode.subscribe((mode) => {
		applyTheme(mode);
		localStorage.setItem("theme", mode);
	});

	// Listen for system theme changes
	const mediaQuery = window.matchMedia("(prefers-color-scheme: light)");
	mediaQuery.addEventListener("change", () => {
		themeMode.update((mode) => {
			if (mode === "system") {
				applyTheme("system");
			}
			return mode;
		});
	});
}

export function toggleTheme() {
	themeMode.update((current) => {
		if (current === "system") return "dark";
		if (current === "dark") return "light";
		return "system";
	});
}

/**
 * Set a specific theme (used by embed mode).
 */
export function setTheme(mode: ThemeMode) {
	themeMode.set(mode);
	applyTheme(mode);
}
