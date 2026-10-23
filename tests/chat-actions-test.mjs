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

const HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-actions-"));
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
	setFocus(component) {
		if (this.focusedComponent && this.focusedComponent !== component) this.focusedComponent.focused = false;
		this.focusedComponent = component;
		if (component) component.focused = true;
	}
	getFocusedComponent() { return this.focusedComponent ?? null; }
	requestRender() {}
}
class AppRoot {
	render(width) { return Array.from({ length: 25 }, (_, i) => `app row ${i + 1} ` + "·".repeat(Math.max(0, width - 11))); }
	invalidate() {}
}

const handlers = new Map();
const pi = { on(event, handler) { handlers.set(event, handler); }, registerCommand() {} };
function findChat(node) {
	if (!node) return null;
	if (node.constructor?.name === "EtherChatSidebar") return node;
	for (const entry of node.entries ?? []) {
		const found = findChat(entry.component ?? entry);
		if (found) return found;
	}
	return null;
}

const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
let markdown = `# Side chat — ${ymd}\n\n`;
for (let i = 0; i < 14; i += 1) {
	markdown += `## 10:${String(i).padStart(2, "0")} · you\n\nquestion ${i}\n\n## 10:${String(i).padStart(2, "0")} · ether\n\nanswer ${i}\n\n`;
}
fs.writeFileSync(path.join(HISTORY_DIR, `${ymd}.md`), markdown);
const backup = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, "utf8") : null;
fs.writeFileSync(CONFIG, JSON.stringify({ provider: "zai", model: "glm-5.3-flash" }));

let widgetFactory;
try {
	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	const ctx = {
		mode: "tui",
		model: { id: "deepseek-flash", contextWindow: 128000, reasoning: true },
		thinkingLevel: "max",
		cwd: process.cwd(),
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
		hasPendingMessages: () => false,
		modelRegistry: { find: () => undefined },
		sessionManager: {
			getEntries: () => [], getSessionId: () => "s", getEntryCount: () => 0,
			getLeafId: () => null, getSessionName: () => undefined,
		},
		ui: { theme, setWidget(_n, f) { widgetFactory = f; }, setFooter() {}, setStatus() {} },
	};
	handlers.get("session_start")({}, ctx);
	const tui = new FakeTUI(new AppRoot());
	widgetFactory(tui, theme);
	const chat = findChat(tui.layoutRoot);
	const rows = () => renderLayoutFrame(tui.layoutRoot, 140, 40).lines.map((line) => stripTerminalSequences(line).slice(100));
	const click = (type, x, y) => ({ type, button: "left", x, y, screenX: x + 100, screenY: y, width: 40, height: 40, shift: false, alt: false, ctrl: false });

	check(!!chat, "chat rail found");
	check(chat.thread.length === 28, `restored ${chat.thread.length} messages`);

	rows(); // establish maxScroll before wheeling
	// Scroll to the very top, so the first turn is the one being acted on.
	chat.handleMouse({ ...click("wheel", 20, 20), wheelDelta: -999 });
	let frame = rows();
	check(chat.scrollOffset === 0, "scroll offset is at the top");
	const firstEtherY = frame.findIndex((line, index) => index >= 4 && line.includes("● ETHER"));
	check(firstEtherY > 0, `first Ether label is visible at row ${firstEtherY}`);
	check(frame.filter((line, index) => index >= 4 && (line.includes("● ETHER") || line.includes("YOU ●"))).every((line) => line.includes("⧉") && line.includes("↳")), "every visible label carries copy and reply icons");

	// Reply to the first Ether message, then to the first user message.
	chat.handleMouse(click("press", 38, firstEtherY));
	chat.handleMouse(click("click", 38, firstEtherY));
	let draft = chat.input.getValue();
	check(draft === "↳ answer 0 ", `reply loaded the Ether body (${JSON.stringify(draft)})`);
	check(chat.focused === true, "reply focused the composer");
	frame = rows();
	check(frame.join("\n").includes("╔"), "focused composer uses the double-line frame");

	const firstYouY = frame.findIndex((line, index) => index >= 4 && line.includes("YOU ●"));
	chat.handleMouse(click("press", 4, firstYouY));
	chat.handleMouse(click("click", 4, firstYouY));
	draft = chat.input.getValue();
	check(draft === "↳ answer 0 ↳ question 0 ", `reply appends instead of clobbering (${JSON.stringify(draft)})`);

	// A body click is inert; it must not reload the quote.
	const before = chat.input.getValue();
	chat.handleMouse(click("press", 20, firstEtherY + 2));
	chat.handleMouse(click("click", 20, firstEtherY + 2));
	check(chat.input.getValue() === before, "clicking a bubble body does not change the draft");
} finally {
	handlers.get("session_shutdown")?.();
	if (backup !== null) fs.writeFileSync(CONFIG, backup);
	else fs.rmSync(CONFIG, { force: true });
	fs.rmSync(HISTORY_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
