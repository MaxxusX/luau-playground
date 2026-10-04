export {
	createEditor,
	destroyEditor,
	updateEditorContent,
	getEditorContent,
	getEditorView,
	focusEditor,
} from "./setup.ts";
export { luauTextMate, initLuauTextMate } from "./textmate.ts";
export { darkTheme, lightTheme } from "./themes.ts";
export {
	luauLspExtensions,
	createLuauLinter,
	createLuauAutocomplete,
	createLuauHover,
} from "./lspExtensions.ts";
