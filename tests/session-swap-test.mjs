/**
 * Session-swap harness: replacing a session (or reloading) invalidates the captured
 * extension ctx, and every getter on it throws from then on. Pi keeps rendering the
 * old chrome until the replacement runtime remounts its own, so a rail that touched
 * ctx during that window crashed pi with an uncaughtException from
 * EtherFilesSidebar.render. The chrome must survive the gap on plain data.
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

process.env.ETHER_CHAT_HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-swap-history-"));

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

const STALE = "This extension ctx is stale after session replacement or reload.";

let widgetFactory;
let footerFactory;

/** A ctx whose getters throw once invalidated, like pi's ExtensionRunner.assertActive. */
function makeCtx(modelId, cwd = ROOT) {
	let stale = false;
	const assert = () => {
		if (stale) throw new Error(STALE);
	};
	const ui = {
		theme,
		setWidget(_name, factory) {
			widgetFactory = factory;
		},
		setFooter(factory) {
			footerFactory = factory;
		},
		setStatus() {},
		notify() {},
	};
	return {
		get mode() {
			assert();
			return "tui";
		},
		get model() {
			assert();
			return { id: modelId, provider: "test", contextWindow: 128000, reasoning: true };
		},
		get thinkingLevel() {
			assert();
			return "max";
		},
		get cwd() {
			assert();
			return cwd;
		},
		get isIdle() {
			assert();
			return () => true;
		},
		get getContextUsage() {
			assert();
			return () => ({ tokens: 0, contextWindow: 128000, percent: 0 });
		},
		get hasPendingMessages() {
			assert();
			return () => false;
		},
		get modelRegistry() {
			assert();
			return { find: () => undefined };
		},
		get ui() {
			assert();
			return ui;
		},
		get sessionManager() {
			assert();
			return {
				getEntries: () => [],
				getSessionId: () => "session-swap",
				getEntryCount: () => 0,
				getLeafId: () => null,
				getSessionName: () => "swap",
			};
		},
		invalidate() {
			stale = true;
		},
	};
}

const handlers = new Map();
const pi = {
	on(event, handler) {
		handlers.set(event, handler);
	},
	registerCommand() {},
};

const tui = new FakeTUI(new AppRoot());
const plain = (root = tui.layoutRoot) =>
	renderLayoutFrame(root, 140, 40).lines.map((line) => stripTerminalSequences(line));
const text = (root) => plain(root).join("\n");
const renderQuietly = () => {
	try {
		const lines = plain();
		return { lines, error: undefined };
	} catch (error) {
		return { lines: [], error };
	}
};

let reloadHandlers;

try {
	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	const ctx1 = makeCtx("deepseek-flash");
	handlers.get("session_start")({}, ctx1);
	widgetFactory(tui, theme);

	check(text().includes("deepseek-flash"), "session swap: the live ctx fills the header");
	const row = plain()[10];
	const bars = [row[4], row[28], row[140 - 40]].filter((char) => char === "│").length;
	check(bars === 3, `session swap: taskbar, Files, and chat rails mounted (${bars} edges)`);

	// The crash path: a ctx goes stale without a shutdown event (render timer gap).
	ctx1.invalidate();
	const staleFrame = renderQuietly();
	check(!staleFrame.error, `stale ctx: old chrome renders instead of throwing (${staleFrame.error?.message ?? "ok"})`);
	check(
		staleFrame.lines.length === 40 && staleFrame.lines.every((line) => visibleWidth(line) === 140),
		"stale ctx: frame stays well-formed",
	);
	check(staleFrame.lines.join("\n").includes("Files"), "stale ctx: the Files rail keeps its last known cwd");

	// The replacement lifecycle: shutdown, then invalidation, then a fresh session_start.
	handlers.get("session_shutdown")();
	const afterShutdown = renderQuietly();
	check(!afterShutdown.error, "session swap: the gap after shutdown does not throw");

	const ctx2 = makeCtx("deepseek-pro");
	handlers.get("session_start")({}, ctx2);
	widgetFactory(tui, theme);
	check(text().includes("deepseek-pro"), "session swap: the chrome adopts the new ctx");
	check(!text().includes("deepseek-flash"), "session swap: the replaced model is gone");

	// A late event from the replaced runtime must not clobber the new ctx.
	handlers.get("message_end")({}, ctx1);
	check(text().includes("deepseek-pro"), "session swap: a late stale event is ignored");

	// Reload: a fresh runtime drives the same renderer while the old one is still mounted.
	const ctx3 = makeCtx("deepseek-pro-x");
	const reloaded = await makeJiti().import(EXT, { default: true });
	reloadHandlers = new Map();
	reloaded({
		on(event, handler) {
			reloadHandlers.set(event, handler);
		},
		registerCommand() {},
	});
	reloadHandlers.get("session_start")({}, ctx3);
	widgetFactory(tui, theme);
	check(text().includes("deepseek-pro-x"), "reload: the new runtime owns the chrome");

	ctx3.invalidate();
	const reloadStale = renderQuietly();
	check(!reloadStale.error, `reload: a stale ctx in the new runtime does not throw (${reloadStale.error?.message ?? "ok"})`);
} finally {
	handlers.get("session_shutdown")?.();
	reloadHandlers?.get("session_shutdown")?.();
	fs.rmSync(process.env.ETHER_CHAT_HISTORY_DIR, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
