import { build, type Plugin } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";
import { rmSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { compileGrammarPlugin } from "./compile-grammar";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, "..");

/**
 * Prerenders the Svelte app at build time using SSR.
 * Injects the rendered HTML into index.html for faster initial paint.
 */
export function prerenderPlugin(): Plugin {
	let renderedHtml: { body: string; head: string } | null = null;
	const serverOutDir = path.resolve(rootDir, "dist/.ssr");

	return {
		name: "svelte-prerender",
		apply: "build",

		async buildStart() {
			console.log("⏳ Prerendering index.html...");

			// Build SSR version
			await build({
				configFile: false,
				plugins: [compileGrammarPlugin(), svelte(), tailwindcss()],
				resolve: { alias: { $lib: path.resolve(rootDir, "./src/lib") } },
				build: {
					target: ["chrome145", "edge145", "firefox148", "safari26.2", "ios26.2"],
					sourcemap: false,
					cssMinify: "lightningcss",
					reportCompressedSize: false,
					ssr: true,
					outDir: serverOutDir,
					rollupOptions: { input: path.resolve(__dirname, "entry-server.ts") },
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
				logLevel: "warn",
			});

			// Import and render
			const { renderApp } = await import(path.join(serverOutDir, "entry-server.js"));
			renderedHtml = renderApp();

			console.log("✅ Prerender complete!");
		},

		transformIndexHtml(html) {
			if (!renderedHtml) return html;
			return html
				.replace("<!--app-html-->", renderedHtml.body)
				.replace("<!--app-head-->", renderedHtml.head);
		},

		closeBundle() {
			// Cleanup SSR build
			rmSync(serverOutDir, { recursive: true, force: true });
		},
	};
}
