import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { fileURLToPath } from "url";
import path from "path";

import { preloadDynamicChunks } from "./vite/preload-chunks";
import { prerenderPlugin } from "./vite/prerender";
import { inlineCss } from "./vite/inline-css";
import { compileGrammarPlugin } from "./vite/compile-grammar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

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
	resolve: { alias: { $lib: path.resolve(__dirname, "./src/lib") } },
	build: {
		target: ["chrome151", "edge151", "firefox153", "safari26.5", "ios26.5"],
		sourcemap: false,
		minify: "oxc",
		cssMinify: "lightningcss",
		reportCompressedSize: false,
		rolldownOptions: {
			optimization: {
				inlineConst: { mode: "all", pass: 5 },
			},
			output: {
				minify: {
					compress: {
						target: ["chrome151", "edge151", "firefox153", "safari26.5", "ios26.5"],
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
		target: ["chrome151", "edge151", "firefox153", "safari26.5", "ios26.5"],
		assumptions: {
			noDocumentAll: true,
			pureGetters: true,
		},
		typescript: {
			useDefineForClassFields: true,
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
				chrome: 151 << 16,
				edge: 151 << 16,
				firefox: 153 << 16,
				safari: (26 << 16) | (5 << 8),
				ios_saf: (26 << 16) | (5 << 8),
			},
		},
	},
});
