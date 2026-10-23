import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	EXT,
	CONFIG,
	ROOT,
	makeJiti,
	theme,
	THEME,
	loadThemeFromPath,
	setThemeInstance,
	renderLayoutFrame,
	stripTerminalSequences,
	visibleWidth,
	sliceByColumn,
} from "./env.mjs";

const HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-prose-history-"));
process.env.ETHER_CHAT_HISTORY_DIR = HISTORY_DIR;

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};

class FakeTUI {
	terminal = { rows: 40, columns: 140 };
	constructor(root) { this.layoutRoot = root; }
	setLayoutRoot(root) { this.layoutRoot = root; }
	setFocus(component) { this.focusedComponent = component; }
	getFocusedComponent() { return this.focusedComponent ?? null; }
	requestRender() {}
}
class AppRoot {
	render(width) { return Array.from({ length: 25 }, (_, i) => `app row ${i + 1} ` + "·".repeat(Math.max(0, width - 11))); }
	invalidate() {}
}

const handlers = new Map();
const pi = { on(e, h) { handlers.set(e, h); }, registerCommand() {} };
const work = fs.mkdtempSync(path.join(os.tmpdir(), "ether-prose-files-"));
fs.writeFileSync(path.join(work, "notes.md"), "line one\nline two\nline three\nline four\nline five\n");
fs.writeFileSync(path.join(work, "code.ts"), "const x = 1;\n");

let widgetFactory;
try {
	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	const ctx = {
		mode: "tui",
		model: { id: "deepseek-flash", contextWindow: 128000, reasoning: true },
		thinkingLevel: "max",
		cwd: work,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
		hasPendingMessages: () => false,
		sessionManager: { getEntries: () => [], getSessionId: () => "s", getEntryCount: () => 0, getLeafId: () => null, getSessionName: () => undefined },
		ui: { theme, setWidget(_n, f) { widgetFactory = f; }, setFooter() {}, setStatus() {} },
	};
	handlers.get("session_start")({}, ctx);
	const tui = new FakeTUI(new AppRoot());
	widgetFactory(tui, theme);
	const findByName = (node, name) => {
		if (!node) return null;
		if (node.constructor?.name === name) return node;
		for (const entry of node.entries ?? []) {
			const found = findByName(entry.component ?? entry, name);
			if (found) return found;
		}
		return null;
	};
	const raw = () => renderLayoutFrame(tui.layoutRoot, 140, 40).lines;
	const plain = () => raw().map((line) => stripTerminalSequences(line));
	const tree = findByName(tui.layoutRoot, "EtherFilesSidebar");
	check(!!tree, "files rail present");
	const clickFile = (name) => {
		const y = plain().findIndex((line) => line.slice(5, 29).includes(name));
		check(y > 0, `${name} row found (${y})`);
		tree.handleMouse({ type: "click", button: "left", x: 2, y, screenX: 2, screenY: y, width: 24, height: 40, shift: false, alt: false });
	};

	const blue = theme.getFgAnsi("toolTitle");
	const dim = theme.getFgAnsi("dim");
	const muted = theme.getFgAnsi("muted");
	clickFile("notes.md");
	const bodyOf = (text) => raw().find((row) => row.includes(text)) ?? "";
	check(
		["one", "two", "three", "four", "five"].every((word) => bodyOf(`${dim}line ${word}`).length > 0),
		"every prose line uses dim white",
	);
	check(["one", "two", "three", "four", "five"].every((word) => bodyOf(`${blue}line ${word}`).length === 0), "no prose line is tool blue");
	check(["one", "two", "three", "four", "five"].every((word) => bodyOf(`${muted}line ${word}`).length === 0), "no prose line keeps the old muted white");

	const preview = findByName(tui.layoutRoot, "EtherPreviewSidebar");
	check(!!preview, "preview mounted");
	preview.load(theme, path.join(work, "code.ts"));
	check(preview.sourceLines.join("\n").includes("\x1b[38;2;255;121;198m"), "code preview still uses Dracula keywords");
	const theme256 = loadThemeFromPath(THEME, "256color");
	setThemeInstance(theme256);
	preview.load(theme256, path.join(work, "code.ts"));
	const code256 = preview.sourceLines.join("\n");
	check(code256.includes("\x1b[38;5;"), "code preview uses 256-color escapes in 256color mode");
	check(!code256.includes("\x1b[38;2;"), "no truecolor escapes in 256color mode");
	setThemeInstance(theme);
	preview.handleMouse({ type: "click", button: "left", x: 45, y: 0, screenX: 45, screenY: 0, width: 47, height: 40, shift: false, alt: false });
} finally {
	handlers.get("session_shutdown")?.();
	fs.rmSync(HISTORY_DIR, { recursive: true, force: true });
	fs.rmSync(work, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
