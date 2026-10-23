import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	EXT,
	CONFIG,
	ROOT,
	makeJiti,
	theme,
	renderLayoutFrame,
	stripTerminalSequences,
	visibleWidth,
	sliceByColumn,
} from "./env.mjs";

const HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-left-history-"));
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

const work = fs.mkdtempSync(path.join(os.tmpdir(), "ether-left-files-"));
fs.writeFileSync(path.join(work, "demo.ts"), "export const demo = true;\n");

let widgetFactory;
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

const findByName = (node, name) => {
	if (!node) return null;
	if (node.constructor?.name === name) return node;
	for (const entry of node.entries ?? []) {
		const found = findByName(entry.component ?? entry, name);
		if (found) return found;
	}
	return null;
};

const plainFrame = (tui, width) => renderLayoutFrame(tui.layoutRoot, width, 40).lines.map((line) => stripTerminalSequences(line));

const extension = await makeJiti().import(EXT, { default: true });
extension(pi);
handlers.get("session_start")({}, ctx);
const tui = new FakeTUI(new AppRoot());
widgetFactory(tui, theme);

const files = findByName(tui.layoutRoot, "EtherFilesSidebar");
check(!!files, "files rail present before opening a file");
const first = plainFrame(tui, 140);
const fileRow = first.findIndex((line) => line.slice(5, 29).includes("demo.ts"));
check(fileRow > 0, `demo.ts in the tree at row ${fileRow}`);
files.handleMouse({ type: "click", button: "left", x: 2, y: fileRow, screenX: 2, screenY: fileRow, width: 24, height: 40, shift: false, alt: false });

const frame140 = plainFrame(tui, 140);
const rows140 = frame140.length;
const widths140 = frame140.every((line) => line.length === 140);
check(rows140 === 40 && widths140, "preview-open frame keeps 40 rows and 140 cells");

// Preview is at columns 5..51 (47 wide), Files gone, transcript 52..99, chat 100..139.
check(frame140[0].slice(5, 52).includes("demo.ts"), "preview header sits in the left slot");
check(!frame140[0].slice(5, 29).includes("Files"), "Files rail is hidden while preview is open");
check(frame140[0].slice(104).startsWith("│ ● ETHER"), "chat rail stays rightmost at 36 cols");
check(frame140[0][4] === "│" && frame140[0][51] === "│" && frame140[0].slice(52).startsWith("┌"), "preview ends with a border at 51, transcript starts at 52");
check(frame140.slice(2).every((line) => line[51] === "│") && frame140[1][51] === "┤", "preview/transcript border runs the full height");
check(frame140[0].slice(52, 104).includes("┌"), "transcript column is 52 wide");

// App rows show the transcript width (48) between preview and chat.
const appRow = frame140.find((line) => line.includes("app row 1 "));
const appStart = appRow.indexOf("app row 1 ");
check(appStart === 52, `transcript starts at column 52 (got ${appStart})`);
const appEnd = appRow.indexOf("│", 104);
check(appRow.length === 140 && appEnd === 104, "frame width intact, chat begins at 104");

// Cutoffs: 131 hides the preview and brings Files back; 132 shows the preview.
const frame131 = plainFrame(tui, 131);
check(!frame131[0].slice(5, 52).includes("demo.ts") && frame131[0].slice(5, 29).includes("Files"), "131 cols: preview hidden, Files back");
const frame132 = plainFrame(tui, 132);
check(frame132[0].slice(5, 52).includes("demo.ts") && !frame132[0].slice(5, 29).includes("Files"), "132 cols: preview visible");
check(frame132.every((line) => line.length === 132), "132-col frame width intact");

// Close preview: Files returns to the left slot.
const preview = findByName(tui.layoutRoot, "EtherPreviewSidebar");
check(!!preview, "preview component present");
preview.handleMouse({ type: "click", button: "left", x: 45, y: 0, screenX: 45, screenY: 0, width: 47, height: 40, shift: false, alt: false });
const frameClosed = plainFrame(tui, 140);
check(frameClosed[0].slice(5, 29).includes("Files"), "closing restores Files on the left");
check(!frameClosed[0].slice(5, 52).includes("demo.ts"), "preview cleared after close");
check(frameClosed[0].slice(100).startsWith("│ ● ETHER"), "chat rail unaffected by close");

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
