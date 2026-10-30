/**
 * Notes rail harness: a session-only notepad that shares the GitHub slot.
 * Covers the taskbar toggle, typing, persistence while hidden, slot exclusivity,
 * layout toggles, and session-shutdown wiping.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	EXT,
	ROOT,
	makeJiti,
	theme,
	renderLayoutFrame,
	stripTerminalSequences,
	visibleWidth,
} from "./env.mjs";

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ether-notes-test-"));
process.env.ETHER_CHAT_HISTORY_DIR = path.join(TMP, "history");
process.env.ETHER_GH_BIN ??= path.join(ROOT, "tests", "fixtures", "fake-gh.mjs");
process.env.FAKE_GH_MODE ??= "auth";

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
		return Array.from({ length: 20 }, (_, i) => {
			const label = `app row ${i + 1} `;
			return label + "·".repeat(Math.max(0, w - visibleWidth(label)));
		});
	}
	invalidate() {}
}

let widgetFactory;
const handlers = new Map();
const shortcuts = new Map();
const pi = {
	on(event, handler) {
		handlers.set(event, handler);
	},
	registerCommand() {},
	registerShortcut(key, definition) {
		shortcuts.set(key, definition);
	},
};

const ctx = {
	mode: "tui",
	model: { id: "deepseek-flash", provider: "deepseek", contextWindow: 128000, reasoning: true },
	thinkingLevel: "max",
	cwd: ROOT,
	isIdle: () => true,
	getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
	hasPendingMessages: () => false,
	sessionManager: {
		getEntries: () => [],
		getSessionId: () => "notes-session",
		getEntryCount: () => 0,
		getLeafId: () => null,
		getSessionName: () => "notes",
	},
	ui: {
		theme,
		setWidget(_name, factory) {
			widgetFactory = factory;
		},
		setFooter() {},
		notify() {},
	},
};

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
try {
	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	handlers.get("session_start")({}, ctx);
	tui = new FakeTUI(new AppRoot());
	widgetFactory(tui, theme);
	const taskbar = findByName(tui.layoutRoot, "EtherSidebar");
	check(!!taskbar, "taskbar is mounted");
	const frame = () => renderLayoutFrame(tui.layoutRoot, 140, 40).lines;
	const plain = () => frame().map((line) => stripTerminalSequences(line));

	check(plain()[11]?.[1] === "✎", "Notes icon sits below QA (row 11)");
	fire("alt+8");
	const notes = findByName(tui.layoutRoot, "EtherNotesSidebar");
	check(!!notes, "alt+8 mounts the Notes rail");
	check(notes.focused === true && tui.focusedComponent === notes, "opening Notes focuses the notepad");
	check(frame()[11].includes(theme.fg("toolTitle", "✎")), "visible Notes icon is blue");
	check(notes.editor.getText() === "", "new notepad is empty");

	notes.handleInput("remember the milk");
	check(notes.editor.getText().includes("remember the milk"), "typing lands in the notepad");
	check(stripTerminalSequences(frame().join("\n")).includes("remember the milk"), "typed text is rendered");
	check(stripTerminalSequences(frame().join("\n")).includes("session only"), "rail marks the notepad as session-only");

	fire("alt+8");
	check(findByName(tui.layoutRoot, "EtherNotesSidebar") === null, "alt+8 closes the Notes rail");
	check(frame()[11].includes(theme.fg("muted", "✎")), "closed Notes icon is muted");
	fire("alt+8");
	const reopened = findByName(tui.layoutRoot, "EtherNotesSidebar");
	check(!!reopened && reopened.editor.getText().includes("remember the milk"), "reopening keeps the note for this session");

	// Notes and GitHub share the rightmost slot.
	fire("alt+5");
	check(findByName(tui.layoutRoot, "EtherNotesSidebar") === null, "opening GitHub hides Notes");
	check(!!findByName(tui.layoutRoot, "EtherGithubSidebar"), "GitHub is visible instead");
	fire("alt+8");
	check(findByName(tui.layoutRoot, "EtherGithubSidebar") === null, "opening Notes hides GitHub");
	check(!!findByName(tui.layoutRoot, "EtherNotesSidebar"), "Notes returns");

	// Chat lives in its own slot and can coexist with Notes.
	fire("alt+4");
	check(!!findByName(tui.layoutRoot, "EtherChatSidebar"), "chat opens beside Notes");
	check(!!findByName(tui.layoutRoot, "EtherNotesSidebar"), "Notes stays visible beside chat");
	const frameAt140 = frame();
	check(frameAt140.every((line) => visibleWidth(line) === 140), "140-col frame keeps its width with Notes + chat");

	// ◫ hides/restores both without clearing the note.
	fire("alt+l");
	check(findByName(tui.layoutRoot, "EtherNotesSidebar") === null, "layout collapse hides Notes");
	fire("alt+l");
	const restored = findByName(tui.layoutRoot, "EtherNotesSidebar");
	check(!!restored && restored.editor.getText().includes("remember the milk"), "layout restore keeps the note");

	// Closing the session wipes the page.
	handlers.get("session_shutdown")?.();
	check(restored.editor.getText() === "", "session shutdown wipes the notepad");
} finally {
	handlers.get("session_shutdown")?.();
	fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
