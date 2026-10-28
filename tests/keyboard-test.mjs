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

const HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-keys-"));
process.env.ETHER_CHAT_HISTORY_DIR = HISTORY_DIR;
const TREE = fs.mkdtempSync(path.join(os.tmpdir(), "ether-keys-tree-"));
fs.mkdirSync(path.join(TREE, "src", "nested"), { recursive: true });
fs.writeFileSync(path.join(TREE, "src", "a.ts"), "const a = 1;\n");
fs.writeFileSync(path.join(TREE, "src", "nested", "b.ts"), "const b = 2;\n");
fs.writeFileSync(path.join(TREE, "README.md"), Array.from({ length: 200 }, (_, i) => `# line ${i}`).join("\n") + "\n");

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};

class FakeTUI {
	terminal = { rows: 40, columns: 140 };
	focusedComponent = null;
	constructor(root) { this.layoutRoot = root; }
	setLayoutRoot(root) { this.layoutRoot = root; }
	setFocus(component) {
		if (this.focusedComponent && this.focusedComponent !== component) this.focusedComponent.focused = false;
		this.focusedComponent = component;
		if (component) component.focused = true;
	}
	getFocusedComponent() { return this.focusedComponent; }
	requestRender() {}
}
class AppRoot {
	render(width) { return Array.from({ length: 25 }, (_, i) => `app row ${i + 1} ` + "·".repeat(Math.max(0, width - 11))); }
	invalidate() {}
}
class EditorStub {
	focused = false;
	handleInput() {}
	render() { return []; }
	invalidate() {}
}

const handlers = new Map();
const shortcuts = new Map();
const commands = new Map();
const pi = {
	on(event, handler) { handlers.set(event, handler); },
	registerCommand(name, def) { commands.set(name, def); },
	registerShortcut(key, def) { shortcuts.set(key, def); },
};
const notices = [];
const ctx = {
	mode: "tui",
	model: { id: "deepseek-flash", contextWindow: 128000, reasoning: true },
	thinkingLevel: "max",
	cwd: TREE,
	isIdle: () => true,
	getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
	hasPendingMessages: () => false,
	modelRegistry: { find: () => undefined },
	sessionManager: {
		getEntries: () => [], getSessionId: () => "s", getEntryCount: () => 0,
		getLeafId: () => null, getSessionName: () => undefined,
	},
	ui: {
		theme,
		setWidget(_n, f) { widgetFactory = f; },
		setFooter() {},
		setStatus() {},
		notify(message, type) { notices.push({ message, type }); },
	},
};

let widgetFactory;
const today = new Date();
const ymd = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}-${String(today.getDate()).padStart(2, "0")}`;
let markdown = `# Side chat — ${ymd}\n\n`;
for (let i = 0; i < 10; i += 1) {
	markdown += `## 10:${String(i).padStart(2, "0")} · you\n\nquestion ${i}\n\n## 10:${String(i).padStart(2, "0")} · ether\n\nanswer ${i}\n\n`;
}
fs.writeFileSync(path.join(HISTORY_DIR, `${ymd}.md`), markdown);

function findByName(node, name) {
	if (!node) return null;
	if (node.constructor?.name === name) return node;
	for (const entry of node.entries ?? []) {
		const found = findByName(entry.component ?? entry, name);
		if (found) return found;
	}
	for (const child of node.children ?? []) {
		const found = findByName(child, name);
		if (found) return found;
	}
	return null;
}
const fire = (key) => shortcuts.get(key)?.handler(ctx);
let tui;
const rawFrame = () => renderLayoutFrame(tui.layoutRoot, tui.terminal.columns, 40).lines;
const plainFrame = () => rawFrame().map((line) => stripTerminalSequences(line));

try {
	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	handlers.get("session_start")({}, ctx);
	tui = new FakeTUI(new AppRoot());
	const editor = new EditorStub();
	tui.setFocus(editor);
	widgetFactory(tui, theme);

	const chat = findByName(tui.layoutRoot, "EtherChatSidebar");
	const files = findByName(tui.layoutRoot, "EtherFilesSidebar");
	const taskbar = findByName(tui.layoutRoot, "EtherSidebar");
	const preview = findByName(tui.layoutRoot, "EtherPreviewSidebar");
	check(!!chat && !!files && !!taskbar, "chat, Files, and taskbar are mounted");
	check(preview === null, "preview is not mounted until a file is open");
	check(shortcuts.has("alt+1") && shortcuts.has("alt+2") && shortcuts.has("alt+3") && shortcuts.has("alt+4") && shortcuts.has("alt+l"), "global shortcuts registered");

	// alt+4 focuses the chat, and the composer switches to the focused frame.
	fire("alt+4");
	check(tui.focusedComponent === chat && chat.focused === true, "alt+4 focuses the chat");
	let raw = rawFrame();
	check(raw.join("\n").includes("╔"), "focused chat composer uses the double-line frame");

	// Tab / shift+tab cycle visible rails in left-to-right order.
	chat.handleInput("\t");
	check(tui.focusedComponent === taskbar, "tab from chat wraps to the taskbar");
	taskbar.handleInput("\x1b[B");
	check(taskbar.selectedIcon === "⬡", "down moves the taskbar selection to the next icon");
	raw = rawFrame();
	check(raw.some((line) => line.includes(theme.getBgAnsi("selectedBg"))), "focused taskbar selection uses selectedBg");
	taskbar.handleInput("\r");
	check(notices.at(-1)?.message === "Extensions is not wired yet", "enter on an inert taskbar icon explains it is inert");
	taskbar.selectedIcon = "⑂";
	const githubBefore = tui.layoutRoot.entries.length;
	taskbar.handleInput("\r");
	check(tui.layoutRoot.entries.length === githubBefore + 1, "enter on the GitHub icon opens the rail");
	taskbar.handleInput("\r");
	check(tui.layoutRoot.entries.length === githubBefore, "enter on the GitHub icon collapses the rail");
	taskbar.handleInput("\x1b[H");
	check(taskbar.selectedIcon === "⌂", "home selects the first taskbar icon");
	taskbar.handleInput("\x1b[F");
	check(taskbar.selectedIcon === "?", "end selects the last taskbar icon");
	const aiExpandedEntries = tui.layoutRoot.entries.length;
	taskbar.selectedIcon = "✦";
	taskbar.handleInput("\r");
	check(tui.layoutRoot.entries.length === aiExpandedEntries - 1, "enter on the AI icon collapses the side chat");
	taskbar.handleInput("\r");
	check(tui.layoutRoot.entries.length === aiExpandedEntries, "enter on the AI icon restores the side chat");
	taskbar.selectedIcon = "◫";
	const layoutBefore = tui.layoutRoot.entries.length;
	taskbar.handleInput("\r");
	check(tui.layoutRoot.entries.length === 2 && tui.focusedComponent === taskbar, "enter on ◫ toggles layout and keeps taskbar focus");
	taskbar.handleInput("\r");
	check(tui.layoutRoot.entries.length === layoutBefore, "enter on ◫ restores the layout");
	taskbar.handleInput("\x1b");
	check(tui.focusedComponent === editor, "esc leaves the taskbar for the editor");

	// Files tree keyboard: selection, collapse/expand, parent, open preview.
	fire("alt+2");
	check(tui.focusedComponent === files && files.focused === true, "alt+2 focuses the Files rail");
	raw = rawFrame();
	check(raw.some((line) => line.includes(theme.getBgAnsi("selectedBg"))), "focused Files row uses selectedBg");
	check(plainFrame()[0].slice(5, 29).includes("esc"), "focused Files heading shows the esc hint");
	check(files.selectedPath === path.join(TREE, "src"), "initial Files selection is the first row");
	files.handleInput("\x1b[B");
	check(files.selectedPath === path.join(TREE, "src", "nested"), "down selects the next tree row");
	files.handleInput("\x1b[D");
	check(files.collapsed.has(path.join(TREE, "src", "nested")), "left collapses the selected folder");
	files.handleInput("\x1b[C");
	check(!files.collapsed.has(path.join(TREE, "src", "nested")), "right expands the selected folder");
	files.handleInput("\x1b[D");
	files.handleInput("\x1b[D");
	check(files.selectedPath === path.join(TREE, "src"), "left on an expanded folder collapses it, then moves to the parent");
	files.handleInput("\r");
	check(files.collapsed.has(path.join(TREE, "src")), "enter collapses a folder");
	files.handleInput("\r");
	check(!files.collapsed.has(path.join(TREE, "src")), "enter expands a folder again");
	files.handleInput("\x1b[H");
	check(files.selectedPath === path.join(TREE, "src"), "home selects the first tree row");
	files.handleInput("\x1b[F");
	check(files.selectedPath === path.join(TREE, "README.md"), "end selects the last tree row");
	files.handleInput("\r");
	const previewSidebar = findByName(tui.layoutRoot, "EtherPreviewSidebar");
	check(!!previewSidebar, "enter on a file mounts the preview");
	check(tui.focusedComponent === previewSidebar, "keyboard file open moves focus into the preview");
	check(files.getActiveFile() === path.join(TREE, "README.md"), "keyboard file open sets the active file");
	fire("alt+2");
	check(notices.at(-1)?.message.includes("Files is hidden"), "alt+2 explains that Files hides behind the preview");
	// Preview keyboard: focus hint, line/page/home/end scroll, esc closes back to Files.
	rawFrame();
	check(previewSidebar.maxScroll > 0, `long preview has scroll range (${previewSidebar.maxScroll})`);
	check(plainFrame()[0].slice(5, 52).includes("esc"), "focused preview header shows the esc hint");
	previewSidebar.handleInput("\x1b[B");
	check(previewSidebar.scrollOffset === 1, "down scrolls the preview one line");
	previewSidebar.handleInput("\x1b[6~");
	check(previewSidebar.scrollOffset > 1, "pageDown scrolls the preview by a page");
	previewSidebar.handleInput("\x1b[F");
	check(previewSidebar.scrollOffset === previewSidebar.maxScroll, "end jumps the preview to the bottom");
	previewSidebar.handleInput("\x1b[H");
	check(previewSidebar.scrollOffset === 0, "home jumps the preview to the top");
	previewSidebar.handleInput("\x1b");
	check(files.getActiveFile() === null, "esc closes the preview");
	check(tui.focusedComponent === files, "esc returns preview focus to Files");
	check(findByName(tui.layoutRoot, "EtherPreviewSidebar") === null, "preview is unmounted after esc");
	files.handleInput("\x1b");
	check(tui.focusedComponent === editor, "esc leaves Files for the editor");
	tui.terminal.columns = 100;
	fire("alt+2");
	check(notices.at(-1)?.message.includes("110"), "alt+2 explains the 110-column Files cutoff");
	tui.terminal.columns = 140;

	// esc always returns to the editor captured on entry.
	fire("alt+4");
	chat.handleInput("\x1b");
	check(tui.focusedComponent === editor, "esc returns focus to the main editor");

	// Chat transcript keyboard: paging, selection, reply quote.
	rawFrame();
	const maxScroll = chat.maxScroll;
	chat.handleInput("\x1b[5~");
	check(chat.scrollOffset === Math.max(0, maxScroll - chat.pageStep()), `pageUp scrolls one page (${chat.scrollOffset}/${maxScroll})`);
	check(chat.follow === false, "pageUp detaches transcript follow");
	chat.handleInput("\x1b[1;5F");
	check(chat.follow === true && chat.scrollOffset === chat.maxScroll, "ctrl+end returns to the bottom");
	chat.handleInput("\x1b[1;5A");
	check(chat.messageSelection === chat.thread.length - 1, "ctrl+up selects the last message");
	raw = rawFrame();
	const selectedFill = theme.getBgAnsi("selectedBg");
	check(raw.some((line) => line.includes(selectedFill)), "selected label row uses selectedBg");
	chat.handleInput("\x12");
	check(chat.input.getValue().startsWith("↳ answer 9"), `ctrl+r quotes the selected Ether reply (${JSON.stringify(chat.input.getValue())})`);
	chat.input.setValue("");
	chat.handleInput("\x1b");
	check(chat.messageSelection === null && tui.focusedComponent === chat, "esc clears the message selection first");
	chat.handleInput("\x1b");
	check(tui.focusedComponent === editor, "a second esc leaves the chat");

	// Layout shortcut and unavailable-rail notices.
	const beforeEntries = tui.layoutRoot.entries.length;
	fire("alt+l");
	check(tui.layoutRoot.entries.length === 2, `alt+l collapses the rails (${beforeEntries} -> 2)`);
	fire("alt+4");
	check(tui.layoutRoot.entries.length === 4 && tui.focusedComponent === chat, "alt+4 expands collapsed rails and focuses chat");
	chat.handleInput("");
	fire("alt+3");
	check(notices.at(-1)?.message.includes("no file open"), "alt+3 explains that the preview needs a file");
	tui.terminal.columns = 80;
	fire("alt+4");
	check(notices.at(-1)?.message.includes("85"), "alt+4 explains the 85-column chat cutoff");
	tui.terminal.columns = 140;
} finally {
	handlers.get("session_shutdown")?.();
	fs.rmSync(HISTORY_DIR, { recursive: true, force: true });
	fs.rmSync(TREE, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
