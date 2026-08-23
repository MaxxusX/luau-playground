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
		target: ["chrome145", "edge145", "firefox148", "safari26.2", "ios26.2"],
		sourcemap: false,
		cssMinify: "lightningcss",
		reportCompressedSize: false,
	},
	css: {
		transformer: "lightningcss",
		devSourcemap: false,
		lightningcss: {
			minify: true,
			sourceMap: false,
			errorRecovery: false,
			targets: {
				chrome: 145 << 16,
				edge: 145 << 16,
				firefox: 148 << 16,
				safari: (26 << 16) | (2 << 8),
				ios_saf: (26 << 16) | (2 << 8),
			},
		},
	},
});
