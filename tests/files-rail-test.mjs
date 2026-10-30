/**
 * Files rail harness: the taskbar toggle, the width override, state persistence
 * across layout changes, and reattachment on a renderer swap.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	EXT,
	makeJiti,
	theme,
	renderLayoutFrame,
	stripTerminalSequences,
	visibleWidth,
} from "./env.mjs";

process.env.ETHER_CHAT_HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-files-history-"));
const TREE = fs.mkdtempSync(path.join(os.tmpdir(), "ether-files-tree-"));
fs.mkdirSync(path.join(TREE, "src"), { recursive: true });
fs.writeFileSync(path.join(TREE, "src", "a.ts"), "const a = 1;\n");
fs.writeFileSync(path.join(TREE, "README.md"), "# readme\n");

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};

class FakeTUI {
	terminal = { rows: 40, columns: 140 };
	focusedComponent = null;
	constructor(root) {
		this.layoutRoot = root;
	}
	setLayoutRoot(root) {
		this.layoutRoot = root;
	}
	setFocus(component) {
		if (this.focusedComponent && this.focusedComponent !== component) this.focusedComponent.focused = false;
		this.focusedComponent = component;
		if (component) component.focused = true;
	}
	getFocusedComponent() {
		return this.focusedComponent;
	}
	requestRender() {}
}

class AppRoot {
	render(width) {
		const w = Math.max(1, width);
		return Array.from({ length: 25 }, (_, i) => {
			const label = `app row ${i + 1} `;
			return label + "·".repeat(Math.max(0, w - visibleWidth(label)));
		});
	}
	invalidate() {}
}

class EditorStub {
	focused = false;
	handleInput() {}
	render() {
		return [];
	}
	invalidate() {}
}

const handlers = new Map();
const shortcuts = new Map();
const notices = [];
const pi = {
	on(event, handler) {
		handlers.set(event, handler);
	},
	registerCommand() {},
	registerShortcut(key, options) {
		shortcuts.set(key, options);
	},
};

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
		getEntries: () => [],
		getSessionId: () => "s",
		getEntryCount: () => 0,
		getLeafId: () => null,
		getSessionName: () => undefined,
	},
	ui: {
		theme,
		setWidget(_name, factory) {
			widgetFactory = factory;
		},
		setFooter() {},
		setStatus() {},
		notify(message, type) {
			notices.push({ message, type });
		},
	},
};

let widgetFactory;
let tui;

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

const taskbar = () => tui.layoutRoot.entries?.[0]?.component;
const fire = (key) => shortcuts.get(key)?.handler(ctx);

try {
	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	handlers.get("session_start")({}, ctx);
	tui = new FakeTUI(new AppRoot());
	const editor = new EditorStub();
	tui.setFocus(editor);
	widgetFactory(tui, theme);

	const plainAt = (width) => {
		tui.terminal.columns = width;
		return renderLayoutFrame(tui.layoutRoot, width, 40).lines.map((line) => stripTerminalSequences(line));
	};
	const filesVisible = (rows) => {
		const left = rows.map((line) => line.slice(5, 29)).join("\n");
		return left.includes("Files") && left.includes("README.md");
	};
	const click = (y) => {
		const event = {
			type: "click",
			button: "left",
			x: 1,
			y,
			screenX: 1,
			screenY: y,
			width: 5,
			height: 40,
			shift: false,
			alt: false,
			ctrl: false,
		};
		taskbar().handleMouse?.({ ...event, type: "press" });
		taskbar().handleMouse?.(event);
	};

	// Icon placement and the default auto behavior.
	const wide = plainAt(140);
	check(wide[1]?.[1] === "▤", "Files icon sits at the top (row 1)");
	check(wide[7]?.[1] === "⑂", "GitHub icon sits below it (row 7)");
	check(wide[38]?.[1] === "⚙", "Settings icon is anchored at the bottom (row 38)");
	check(filesVisible(wide), "140 cols: Files tree is visible by default");
	check(!filesVisible(plainAt(100)), "100 cols: the width rule hides Files");

	// Manual override: the icon opens below the cutoff and closes above it.
	click(1);
	check(filesVisible(plainAt(100)), "100 cols: the Files icon opens the tree");
	const openRaw = renderLayoutFrame(tui.layoutRoot, 100, 40).lines;
	check(openRaw[1].includes(theme.fg("toolTitle", "▤")), "the open Files icon is blue");
	check(filesVisible(plainAt(140)), "manual open survives growing the terminal");
	click(1);
	check(!filesVisible(plainAt(140)), "the Files icon closes the tree at 140 cols");
	const closedRaw = renderLayoutFrame(tui.layoutRoot, 140, 40).lines;
	check(closedRaw[1].includes(theme.fg("muted", "▤")), "the closed Files icon stays muted");
	check(!filesVisible(plainAt(100)), "manual close survives shrinking the terminal");
	click(1);
	check(filesVisible(plainAt(100)), "the Files icon reopens the tree at 100 cols");

	// The layout toggle hides every rail but must not erase the Files choice.
	click(3);
	check(tui.layoutRoot.entries?.length === 2, "◫ collapses all side rails");
	check(!filesVisible(plainAt(100)), "◫ hides the tree while collapsed");
	click(3);
	check(tui.layoutRoot.entries?.length === 4, "◫ restores the rails");
	check(filesVisible(plainAt(100)), "manual open survives a layout toggle");

	// Keyboard parity.
	check(shortcuts.has("alt+6"), "alt+6 is registered");
	fire("alt+6");
	check(!filesVisible(plainAt(100)), "alt+6 closes the tree");
	fire("alt+6");
	check(filesVisible(plainAt(100)), "alt+6 opens the tree");
	fire("alt+2");
	check(
		tui.focusedComponent === findByName(tui.layoutRoot, "EtherFilesSidebar"),
		"alt+2 focuses a manually opened tree",
	);

	// Very narrow terminals: the manual open still wins, and alt+2 keeps the cutoff notice.
	const narrow = plainAt(60);
	check(filesVisible(narrow), "60 cols: manual open still shows the tree");
	fire("alt+6");
	check(!filesVisible(plainAt(60)), "60 cols: the Files icon closes the tree again");
	fire("alt+2");
	check(notices.at(-1)?.message.includes("110"), "alt+2 still explains the 110-column auto cutoff");
	fire("alt+6");
	check(filesVisible(plainAt(100)), "the tree is open again before the renderer swap");

	// A renderer swap (fullscreen -> regular -> fullscreen) mounts a new TUI and
	// calls setLayoutRoot on it; the chrome must reattach with the same rail state.
	const filesRail = findByName(tui.layoutRoot, "EtherFilesSidebar");
	const treeClick = (y) => ({
		type: "click",
		button: "left",
		x: 1,
		y,
		screenX: 6,
		screenY: y,
		width: 24,
		height: 40,
		shift: false,
		alt: false,
		ctrl: false,
	});
	filesRail.handleMouse?.({ ...treeClick(1), type: "press" });
	filesRail.handleMouse?.(treeClick(1));
	check(filesRail.collapsed.has(path.join(TREE, "src")), "folder state: src is collapsed before the swap");
	const filesBefore = filesRail;
	const nextTui = new FakeTUI(new AppRoot());
	nextTui.terminal.columns = 100;
	nextTui.setLayoutRoot(nextTui.layoutRoot);
	const nextRows = renderLayoutFrame(nextTui.layoutRoot, 100, 40).lines.map((line) => stripTerminalSequences(line));
	check(filesVisible(nextRows), "renderer swap: the Files tree reattaches open");
	check(nextRows.some((line) => line.includes("app row 1")), "renderer swap: the app root still renders");
	check(
		nextRows[0]?.slice(29).startsWith("┌") && nextRows[3]?.includes("⣿"),
		"renderer swap: the header and wordmark reattach",
	);
	const wideNextRows = renderLayoutFrame(nextTui.layoutRoot, 140, 40).lines.map((line) =>
		stripTerminalSequences(line),
	);
	check(
		wideNextRows[0]?.slice(29).startsWith("┌") &&
			wideNextRows.slice(0, 5).some((line) => line.includes("deepseek-flash")),
		"renderer swap: header metrics return at 140 cols",
	);
	check(nextRows.some((line) => line.includes("● ETHER")), "renderer swap: the chat rail reattaches");
	const nextLeft = nextRows.map((line) => line.slice(5, 29)).join("\n");
	check(
		nextLeft.includes("src") && !nextLeft.includes("a.ts"),
		"renderer swap: the collapsed folder state survives",
	);
	check(findByName(nextTui.layoutRoot, "EtherFilesSidebar") === filesBefore, "renderer swap: same Files rail instance");
	check(
		nextRows.filter((line) => line !== "").every((line) => visibleWidth(line) === 100),
		"renderer swap: every row is exactly 100 cells",
	);
} finally {
	handlers.get("session_shutdown")?.();
	fs.rmSync(TREE, { recursive: true, force: true });
	fs.rmSync(process.env.ETHER_CHAT_HISTORY_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
