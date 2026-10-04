/**
 * Vite plugin to compile Oniguruma regex patterns from the Luau TextMate grammar
 * to native JavaScript RegExp patterns at build time.
 *
 * This eliminates the need for oniguruma-to-es at runtime.
 *
 * Usage:
 *   import { compiledPatterns } from 'virtual:compiled-patterns';
 */

import type { Plugin } from "vite";
import { toRegExp } from "oniguruma-to-es";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

const VIRTUAL_MODULE_ID = "virtual:compiled-patterns";
const RESOLVED_VIRTUAL_MODULE_ID = "\0" + VIRTUAL_MODULE_ID;

interface GrammarNode {
	match?: string;
	begin?: string;
	end?: string;
	while?: string;
	patterns?: GrammarNode[];
	repository?: Record<string, GrammarNode>;
	captures?: Record<string, GrammarNode>;
	beginCaptures?: Record<string, GrammarNode>;
	endCaptures?: Record<string, GrammarNode>;
	whileCaptures?: Record<string, GrammarNode>;
	[key: string]: unknown;
}

/**
 * Extract all unique regex patterns from the grammar.
 * Also generates vscode-textmate's internal transformations for anchored patterns.
 */
function extractPatterns(obj: unknown, patterns = new Set<string>()): Set<string> {
	if (!obj || typeof obj !== "object") return patterns;

	if (Array.isArray(obj)) {
		for (const item of obj) {
			extractPatterns(item, patterns);
		}
	} else {
		const node = obj as GrammarNode;
		// Check for pattern properties
		for (const key of ["match", "begin", "end", "while"] as const) {
			if (typeof node[key] === "string") {
				const pattern = node[key];
				patterns.add(pattern);

				// vscode-textmate transforms \A anchors in patterns when isFirstLine=false
				// It replaces the 'A' in '\A' with \xFFFF, so \A becomes \  (backslash + U+FFFF)
				// We need to also compile these transformed versions
				if (pattern.includes("\\A")) {
					// Replace \A with \  (backslash followed by U+FFFF)
					patterns.add(pattern.replace(/\\A/g, "\\\uFFFF"));
				}
			}
		}
		// Recurse into nested objects
		for (const value of Object.values(node)) {
			extractPatterns(value, patterns);
		}
	}

	return patterns;
}

/**
 * Compile all patterns to JavaScript RegExp.
 */
function compilePatterns(patterns: string[]): Record<string, [string, string] | null> {
	const compiled: Record<string, [string, string] | null> = {};

	for (const pattern of patterns) {
		try {
			// Handle vscode-textmate's anchor transformation
			// vscode-textmate replaces \A with \  (backslash + U+FFFF) when isFirstLine=false
			// We need to convert it back to \A for oniguruma-to-es compilation
			const patternToCompile =
				pattern.includes("\\\uFFFF") ? pattern.replace(/\\\uFFFF/g, "\\A") : pattern;

			const regex = toRegExp(patternToCompile, {
				global: true,
				hasIndices: true,
				rules: {
					allowOrphanBackrefs: true,
					asciiWordBoundaries: true,
					captureGroup: true,
					recursionLimit: 5,
					singleline: true,
				},
				target: "ES2024",
			});

			// Store as [source, flags] tuple
			compiled[pattern] = [regex.source, regex.flags];
		} catch {
			// Store null for patterns that couldn't be compiled
			compiled[pattern] = null;
			console.warn("[compile-grammar] Failed to compile pattern: `"+pattern+"`");
		}
	}

	return compiled;
}

/**
 * Generate the virtual module code.
 */
function generateModule(compiledPatterns: Record<string, [string, string] | null>): string {
	const total = Object.keys(compiledPatterns).length;
	const failed = Object.values(compiledPatterns).filter(function(v) { return v === null }).length;

	console.log("[compile-grammar] Total Patterns: "+total);
	console.log("[compile-grammar] Successfully Compiled: "+(total - failed));
	console.log("[compile-grammar] Failed: "+failed);

	return "export const compiledPatterns = "+JSON.stringify(compiledPatterns)+";\n";
}

export function compileGrammarPlugin(): Plugin {
	let grammarPath: string;
	let cachedModule: string | null = null;

	return {
		name: "compile-grammar",

		configResolved(config) {
			grammarPath = resolve(config.root, "src/lib/editor/Luau.tmLanguage.json");
		},

		resolveId(id) {
			if (id === VIRTUAL_MODULE_ID) {
				return RESOLVED_VIRTUAL_MODULE_ID;
			}
		},

		load(id) {
			if (id === RESOLVED_VIRTUAL_MODULE_ID) {
				// Return cached module if available (for HMR performance)
				if (cachedModule) {
					return cachedModule;
				}

				// Read and parse grammar
				const grammarJson = readFileSync(grammarPath, "utf-8");
				const grammar = JSON.parse(grammarJson);

				// Extract and compile patterns
				const patterns = [...extractPatterns(grammar)];
				const compiled = compilePatterns(patterns);

				// Generate and cache module
				cachedModule = generateModule(compiled);

				console.log(`[compile-grammar] Compiled ${patterns.length} patterns`);

				return cachedModule;
			}
		},

		handleHotUpdate({ file }) {
			// Invalidate cache when grammar file changes
			if (file.endsWith("Luau.tmLanguage.json")) {
				cachedModule = null;
				console.log("[compile-grammar] Grammar changed, will recompile patterns");
			}
		},
	};
}
