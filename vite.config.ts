import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import path from "node:path";

import { preloadDynamicChunks } from "./vite/preload-chunks.ts";
import { prerenderPlugin } from "./vite/prerender.ts";
import { inlineCss } from "./vite/inline-css.ts";
import { compileGrammarPlugin } from "./vite/compile-grammar.ts";

// https://vite.dev/config/
export default defineConfig({
	plugins: [
		compileGrammarPlugin(),
		svelte(),
		tailwindcss(),
		preloadDynamicChunks(),
		prerenderPlugin(),
		inlineCss(),
	],
	resolve: { alias: { $lib: path.resolve(import.meta.dirname, "./src/lib") } },
	build: {
		target: ["chrome156", "edge156", "firefox158", "safari27.2", "ios27.2"],
		sourcemap: false,
		minify: "oxc",
		cssMinify: "lightningcss",
		reportCompressedSize: false,
		rolldownOptions: {
			optimization: {
				inlineConst: { mode: "all", pass: 10 },
			},
			output: {
				minify: {
					compress: {
						target: ["chrome156", "edge156", "firefox158", "safari27.2", "ios27.2"],
						dropConsole: true,
						unused: true,
						treeshake: {
							propertyReadSideEffects: false,
							propertyWriteSideEffects: false,
							unknownGlobalSideEffects: false,
						},
					},
					mangle: {
						toplevel: true,
					},
				},
			},
		},
	},
	oxc: {
		target: ["chrome156", "edge156", "firefox158", "safari27.2", "ios27.2"],
		assumptions: {
			noDocumentAll: true,
			pureGetters: true,
		},
		typescript: {
			optimizeConstEnums: true,
			optimizeEnums: true,
		},
	},
	css: {
		transformer: "lightningcss",
		devSourcemap: false,
		lightningcss: {
			errorRecovery: false,
			targets: {
				chrome: 156 << 16,
				edge: 156 << 16,
				firefox: 158 << 16,
				safari: (27 << 16) | (2 << 8),
				ios_saf: (27 << 16) | (2 << 8),
			},
		},
	},
});
