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

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};

class FakeTUI {
	terminal = { rows: 40, columns: 140 };
	constructor(root) { this.layoutRoot = root; }
	setLayoutRoot(root) { this.layoutRoot = root; }
	requestRender() {}
}
class AppRoot {
	render(width) { return Array.from({ length: 25 }, (_, i) => `app row ${i + 1} ` + "·".repeat(Math.max(0, width - 11))); }
	invalidate() {}
}

const handlers = new Map();
const commands = new Map();
const pi = {
	on(event, handler) { handlers.set(event, handler); },
	registerCommand(name, def) { commands.set(name, def); },
};

let widgetFactory;
const makeCtx = () => ({
	mode: "tui",
	model: { id: "deepseek-flash", contextWindow: 128000, reasoning: true },
	thinkingLevel: "max",
	cwd: ROOT,
	isIdle: () => true,
	getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
	hasPendingMessages: () => false,
	sessionManager: {
		getEntries: () => [], getSessionId: () => "s", getEntryCount: () => 0,
		getLeafId: () => null, getSessionName: () => undefined,
	},
	ui: { theme, setWidget(_n, f) { widgetFactory = f; }, setFooter() {} },
});

const MODELS = [
	{ provider: "deepseek", id: "deepseek-flash" },
	{ provider: "openai", id: "gpt-5" },
];
const makeCommandCtx = (selectResult) => {
	const notified = [];
	return {
		notified,
		modelRegistry: { getAvailable: () => MODELS },
		ui: {
			async select() { return selectResult; },
			notify(message, level) { notified.push({ message, level }); },
		},
	};
};

const backup = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, "utf8") : null;
try {
	if (fs.existsSync(CONFIG)) fs.unlinkSync(CONFIG);

	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	check(commands.has("chat-model"), "command registered: /chat-model");

	const cmd = commands.get("chat-model");
	check(typeof cmd?.handler === "function", "command has a handler");
	check(cmd?.description?.includes("side chat"), `description present (${cmd?.description})`);

	// Cancelled stock picker writes nothing.
	let ctx = makeCommandCtx(undefined);
	await cmd.handler("", ctx);
	check(!fs.existsSync(CONFIG), "cancelled picker leaves config untouched");

	// Stock picker pick persists and shows up in the masthead.
	ctx = makeCommandCtx("deepseek/deepseek-flash");
	await cmd.handler("", ctx);
	const saved = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
	check(saved.provider === "deepseek" && saved.model === "deepseek-flash", `config saved (${JSON.stringify(saved)})`);
	check(ctx.notified.at(-1)?.message.includes("deepseek/deepseek-flash"), "notify names the model");

	handlers.get("session_start")({}, makeCtx());
	const tui = new FakeTUI(new AppRoot());
	widgetFactory(tui, theme);
	const frame = renderLayoutFrame(tui.layoutRoot, 140, 40);
	const railRows = frame.lines.map((line) => stripTerminalSequences(line).slice(140 - 40));
	check(railRows[1]?.includes("MODEL deepseek-flash"), `masthead model row (${railRows[1]?.trim().replace(/ +/g, " ")})`);
	check(railRows[1]?.includes("CTX —/—"), "masthead ctx placeholder");
	check(railRows[0]?.includes("// LOOPBACK"), "masthead title unchanged");

	// Direct argument path, by bare model id.
	ctx = makeCommandCtx(undefined);
	await cmd.handler("gpt-5", ctx);
	const saved2 = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
	check(saved2.provider === "openai" && saved2.model === "gpt-5", `arg path saved (${JSON.stringify(saved2)})`);

	// Unknown argument is rejected without overwriting.
	ctx = makeCommandCtx(undefined);
	await cmd.handler("nope-9000", ctx);
	const saved3 = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
	check(saved3.model === "gpt-5", "unknown arg keeps previous choice");
	check(ctx.notified.at(-1)?.level === "error", "unknown arg reports an error");

	// Empty provider list.
	const emptyCtx = { modelRegistry: { getAvailable: () => [] }, ui: { select: async () => undefined, notify() {} } };
	const notes = [];
	emptyCtx.ui.notify = (message, level) => notes.push({ message, level });
	await cmd.handler("", emptyCtx);
	check(notes.at(-1)?.level === "error", "no logged-in models reports an error");

	// Custom picker: viewport, wheel, paging, enter, esc.
	const MANY = Array.from({ length: 30 }, (_, i) => ({ provider: "prov", id: `model-${i + 1}` }));
	let component;
	const tuiForPicker = new FakeTUI(new AppRoot());
	const openPicker = () => ({
		mode: "tui",
		modelRegistry: { getAvailable: () => MANY },
		ui: {
			notify() {},
			custom(factory) {
				return new Promise((resolve) => {
					component = factory(tuiForPicker, theme, {}, resolve);
					component._resolve = resolve;
				});
			},
		},
	});

	let ctxP = openPicker();
	let pending = cmd.handler("", ctxP);
	await Promise.resolve();
	await Promise.resolve();
	check(!!component, "picker component was created");

	const lines = component.render(46).map((line) => stripTerminalSequences(line));
	check(lines.every((line) => line.length === 46), `picker rows are 46 cells (${lines.map((l) => l.length).join("/")})`);
	check(lines[0].includes("SIDE MODEL"), "picker title");
	check(lines.length === 12 + 4, `picker viewport 12 + chrome (got ${lines.length})`);
	check(lines.join("\n").includes("1/30 ↕"), "picker shows scroll position");
	check(lines.join("\n").includes("prov/model-13"), "picker window starts at option 1");

	for (let i = 0; i < 3; i++) component.handleMouse({ type: "wheel", wheelDelta: 1 });
	let view = component.render(46).map((line) => stripTerminalSequences(line)).join("\n");
	check(view.includes("4/30 ↕") && view.includes("→ prov/model-12"), "wheel moves the selection");

	component.handleInput("\x1b[6~");
	view = component.render(46).map((line) => stripTerminalSequences(line)).join("\n");
	const selected = view.match(/→ prov\/model-(\d+)/)?.[1] ?? "";
	check(Number(selected) > 4, `page down jumps the selection (model-${selected})`);

	component.handleInput("\r");
	await pending;
	const savedPicker = JSON.parse(fs.readFileSync(CONFIG, "utf8"));
	check(savedPicker.model === `model-${selected}`, `enter saved the highlighted model (${savedPicker.model})`);

	component = undefined;
	ctxP = openPicker();
	pending = cmd.handler("", ctxP);
	await Promise.resolve();
	await Promise.resolve();
	const beforeCancel = fs.readFileSync(CONFIG, "utf8");
	component.handleInput("\x1b");
	await pending;
	check(fs.readFileSync(CONFIG, "utf8") === beforeCancel, "esc cancels without writing");
} finally {
	if (backup === null) {
		if (fs.existsSync(CONFIG)) fs.unlinkSync(CONFIG);
	} else {
		fs.writeFileSync(CONFIG, backup);
	}
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
