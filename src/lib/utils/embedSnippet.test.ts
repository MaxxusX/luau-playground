import assert from "node:assert/strict";
import { test } from "node:test";
import { DEFAULT_EMBED_HEIGHT, fullEmbedHeight } from "../editor/metrics.ts";
import { buildEmbedSnippet } from "./embedSnippet.ts";

const url = new URL("https://play.luau.org/?embed=true");
const height = DEFAULT_EMBED_HEIGHT;

const IFRAME_REGEX = /<iframe[\s\S]*?<\/iframe>/;

test("a snippet that fits is a plain sized iframe", () => {
	const html = buildEmbedSnippet(url, height, height / 2);

	assert.match(html, IFRAME_REGEX, "embed snippet does not contain an iframe");
	assert.match(html, /width="100%"/);
	assert.match(html, new RegExp(`height="${height}"`));
	assert.doesNotMatch(html, /<style>/);
	assert.doesNotMatch(html, /luau-embed-toggle/);
});

test("only code taller than the collapsed height gets an expand toggle", () => {
	const short = fullEmbedHeight({ "main.luau": "print(1)\n" });
	const lines = Array.from({ length: 40 }, (_, i) => `print(${i})`).join("\n");
	const long = fullEmbedHeight({ "main.luau": lines, "utils.luau": lines });

	assert.ok(short <= height);
	assert.ok(long > height);

	const nonExpandable = buildEmbedSnippet(url, height, short);
	assert.match(nonExpandable, IFRAME_REGEX, "non-expandable embed snippet does not contain an iframe");
	assert.doesNotMatch(nonExpandable, /luau-embed-toggle/);

	const expandable = buildEmbedSnippet(url, height, long);
	assert.match(expandable, IFRAME_REGEX, "expandable embed snippet does not contain an iframe");
	assert.match(expandable, /luau-embed-toggle/);
	assert.doesNotMatch(expandable, /[?&]expand=true/);
});

test("multi-file embeds add the tab bar height", () => {
	const lines = Array.from({ length: 40 }, (_, i) => `print(${i})`).join("\n");

	const heightWhenMultiFile = fullEmbedHeight({ "main.luau": lines, "utils.luau": lines });
	const heightWhenSingleFile = fullEmbedHeight({ "main.luau": lines });

	assert.ok(heightWhenMultiFile > heightWhenSingleFile);
});

test("the frame tells the host checkbox to resize", () => {
	const html = buildEmbedSnippet(url, height, height * 2);
	const id = /id="(luau-embed-[^"]+)"/.exec(html)?.[1];

	assert.match(html, IFRAME_REGEX, "embed snippet does not contain an iframe");
	assert.ok(id);
	assert.match(html, new RegExp(`[?&]expandId=${id}`));
	assert.doesNotMatch(html, /luau-embed-label/);
});

test("an expandable iframe keeps its size when the stylesheet is stripped", () => {
	const html = buildEmbedSnippet(url, height, height * 2);
	const stripped = html.replace(/<style>[\s\S]*<\/style>/, "");

	assert.ok(IFRAME_REGEX.test(html), "embed snippet does not contain an iframe");
	assert.match(html, /height:\s*var\(--luau-collapsed\)/);
	assert.match(stripped, /width="100%"/);
	assert.match(stripped, new RegExp(`height="${height}"`));
	assert.doesNotMatch(stripped, /<style>/);
});
