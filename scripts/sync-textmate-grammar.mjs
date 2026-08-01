import { createHash } from "node:crypto";
import { readFile, rename, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const grammarUrl =
	process.env.LUAU_TEXTMATE_GRAMMAR_URL ??
	"https://raw.githubusercontent.com/JohnnyMorganz/Luau.tmLanguage/main/Luau.tmLanguage.json";
const grammarPath = fileURLToPath(
	new URL("../src/lib/editor/Luau.tmLanguage.json", import.meta.url)
);
const temporaryPath = grammarPath+".tmp";

const response = await fetch(grammarUrl, {
	headers: { "User-Agent": "luau-playground-grammar-sync" },
});

if (!response.ok) {
	throw new Error(
		`Unable to download Luau TextMate grammar: ${response.status} ${response.statusText}`
	);
}

let grammar = JSON.parse(await response.text());

if (grammar.name !== "Luau" || grammar.scopeName !== "source.luau") {
	throw new Error("Downloaded file is not the expected Luau TextMate grammar");
}

const grammarSource = JSON.stringify(grammar);
grammar = null;

let currentHash;
try {
	const currentSource = await readFile(grammarPath, "utf8");
	currentHash = createHash("sha256").update(currentSource).digest("hex");
} catch (error) {
	if (error.code !== "ENOENT") throw error;
}

const grammarHash = createHash("sha256").update(grammarSource).digest("hex");
const digest = grammarHash.slice(0, 12);

if (currentHash === grammarHash) {
	console.log(`TextMate grammar is already current (${digest})`);
} else {
	await writeFile(temporaryPath, grammarSource);
	await rename(temporaryPath, grammarPath);
	console.log(`Updated TextMate grammar from upstream (${digest})`);
}
