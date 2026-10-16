function iframeTag(url: URL, sizing: string[] = [], indent = ""): string {
	return [
		"<iframe",
		`	src="${url.toString()}"`,
		...Object.entries(sizing).map(([key, value]) => `\t${key}="${value}"`)
		'	loading="lazy"',
		'	allow="clipboard-write"',
		'	title="Luau Playground"',
		"></iframe>",
	]
		.map((line) => indent + line)
		.join("\n");
}

/**
 * HTML for an embed of `url`.
 *
 * `collapsed` is the height the host asked for. When `expanded` is taller, the
 * snippet adds a checkbox and a stylesheet that grows the frame. The expand
 * button itself is inside the frame, with the other actions, and posts a
 * message here; the script flips the checkbox. No layout is shared across the
 * frame, so the button can be text or an icon with the rest of the row.
 *
 * The iframe still carries width and height attributes: hosts that strip
 * `<style>` (common in CMS and markdown sanitizers) would otherwise fall back to
 * the browser default of 300×150. `height: var(--luau-collapsed)` wins when the
 * stylesheet survives.
 */
export function buildEmbedSnippet(url: URL, collapsed: number, expanded: number): string {
	if (expanded <= collapsed) {
		return iframeTag(url, {
			width: "100%",
			height: collapsed.toString(),
			style: "border: 1px solid #e2e8f0; border-radius: 8px;",
		});
	}

	const id = `luau-embed-${Math.random().toString(36).slice(2, 8)}`;
	const expandableUrl = new URL(url);
	expandableUrl.searchParams.set("expandId", id);
	return `\
<div class="luau-embed" style="--luau-collapsed: ${collapsed}px; --luau-expanded: ${expanded}px;">
	<input class="luau-embed-toggle" id="${id}" type="checkbox">
${iframeTag(expandableUrl, { width: "100%", height: collapsed.toString() }, "\t")}
	<script>
		(function (toggle, frame) {
			const origin = new URL(frame.src).origin;
			function ready() {
				if (frame.contentWindow) {
					frame.contentWindow.postMessage({ type: "luau-embed-host", id: toggle.id }, origin);
				}
			}
			frame.addEventListener("load", ready);
			window.addEventListener("message", function (event) {
				if (event.source !== frame.contentWindow) return;
				const data = event.data;
				if (!data || data.id !== toggle.id) return;
				if (data.type === "luau-embed-init") ready();
				if (data.type === "luau-embed-expand") toggle.checked = !!data.expanded;
			});
		})(document.currentScript.previousElementSibling.previousElementSibling, document.currentScript.previousElementSibling);
	</script>
</div>
<style>
	.luau-embed { position: relative; }
	.luau-embed iframe {
		display: block;
		width: 100%;
		height: var(--luau-collapsed);
		border: 1px solid #e2e8f0;
		border-radius: 8px;
		transition: height 150ms ease;
	}
	.luau-embed-toggle { position: absolute; opacity: 0; pointer-events: none; }
	.luau-embed-toggle:checked ~ iframe { height: min(var(--luau-expanded), 80vh); }
</style>`;
}
