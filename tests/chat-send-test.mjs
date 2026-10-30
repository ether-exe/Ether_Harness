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

const HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-history-"));
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

const statusMap = new Map();
const handlers = new Map();
const pi = {
	on(event, handler) { handlers.set(event, handler); },
	registerCommand() {},
};

const backup = fs.existsSync(CONFIG) ? fs.readFileSync(CONFIG, "utf8") : null;
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function findChat(node) {
	if (!node) return null;
	if (node.constructor?.name === "EtherChatSidebar") return node;
	for (const entry of node.entries ?? []) {
		const found = findChat(entry.component ?? entry);
		if (found) return found;
	}
	return null;
}

let widgetFactory;
const start = (registry, cwd = process.cwd()) => {
	const ctx = {
		mode: "tui",
		model: { id: "deepseek-flash", contextWindow: 128000, reasoning: true },
		thinkingLevel: "max",
		cwd,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
		hasPendingMessages: () => false,
		modelRegistry: registry,
		sessionManager: {
			getEntries: () => [], getSessionId: () => "s", getEntryCount: () => 0,
			getLeafId: () => null, getSessionName: () => undefined,
		},
		ui: { theme, setWidget(_n, f) { widgetFactory = f; }, setFooter() {}, setStatus(key, value) { if (value === undefined) statusMap.delete(key); else statusMap.set(key, value); } },
	};
	handlers.get("session_start")({}, ctx);
	const tui = new FakeTUI(new AppRoot());
	widgetFactory(tui, theme);
	return { tui, ctx };
};

const railRows = (tui, width = 140) =>
	renderLayoutFrame(tui.layoutRoot, width, 40).lines.map((line) => stripTerminalSequences(line).slice(width - 40));

const clickComposer = (chat) => {
	const event = { type: "click", button: "left", x: 20, y: 38, screenX: 120, screenY: 38, width: 40, height: 40, shift: false, alt: false };
	chat.handleMouse({ ...event, type: "press" });
	chat.handleMouse(event);
	chat.focused = true;
};

try {
	fs.writeFileSync(CONFIG, JSON.stringify({ provider: "zai", model: "glm-5.3-flash" }));
	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);

	// ---- streaming success path
	let releaseChunks;
	let capturedContext;
	let capturedOptions;
	const stream = {
		async *[Symbol.asyncIterator]() {
			yield { type: "start" };
			yield { type: "text_delta", delta: "Hel" };
			await new Promise((resolve) => { releaseChunks = resolve; });
			yield { type: "text_delta", delta: "lo there" };
			yield { type: "done", reason: "stop" };
		},
		async result() { return { role: "assistant", content: [{ type: "text", text: "Hello there" }], provider: "zai", model: "glm-5.3-flash", usage: { input: 16000, output: 40, cacheRead: 0, cacheWrite: 0 } }; },
	};
	const registry = {
		find(provider, id) {
			check(provider === "zai" && id === "glm-5.3-flash", `registry.find(${provider}, ${id})`);
			return { provider, id, contextWindow: 128000 };
		},
		streamSimple(model, context, options) {
			capturedContext = { ...context, messages: [...context.messages] };
			capturedOptions = options;
			return stream;
		},
	};

	let { tui } = start(registry);
	let chat = findChat(tui.layoutRoot);
	check(!!chat, "chat component found in layout");
	clickComposer(chat);
	chat.handleInput("what is the TUI?");
	chat.handleInput("\r");
	await sleep(20);

	let rows = railRows(tui);
	let text = rows.join("\n");
	check(capturedContext?.systemPrompt?.includes("seven years old"), "system prompt carries the teaching persona");
	check(capturedContext?.messages?.length === 1 && capturedContext.messages[0].role === "user", "history starts with the user message");
	check(capturedContext?.messages?.[0]?.content?.[0]?.text === "what is the TUI?", "user text reaches the model");
	check(!!capturedOptions?.signal, "abort signal passed to streamSimple");
	check(capturedOptions?.reasoning === "max", `thinking level is max (${capturedOptions?.reasoning})`);
	check(text.includes("what is the TUI?"), "user bubble rendered");
	check(text.includes("WORK"), "masthead shows WORK while streaming");
	check(text.includes("▌"), "streaming cursor visible");
	check(text.includes("Hel"), "partial text rendered");
	check(!text.includes("^C"), "no escape artifacts");

	releaseChunks();
	await sleep(20);
	rows = railRows(tui);
	text = rows.join("\n");
	check(text.includes("IDLE"), "masthead returns to IDLE");
	check(!text.includes("▌"), "cursor removed when done");
	check(text.includes("Hello there"), "final reply rendered");
	check(text.includes("CTX 12.5%/128k"), `masthead context meter (${railRows(tui)[1].trim().replace(/ +/g, " ")})`);
	const rawFrame = renderLayoutFrame(tui.layoutRoot, 140, 40).lines.join(String.fromCharCode(10));
	const rawLines = renderLayoutFrame(tui.layoutRoot, 140, 40).lines;
	const escSeq = String.fromCharCode(27);
	check(rawFrame.includes(theme.getBgAnsi("userMessageBg")), "user bubble uses userMessageBg");
	check(rawFrame.includes(`${escSeq}[48;2;4;4;5m`), "Ether bubble uses the dark matte fill");
	check(!rawFrame.includes(theme.getBgAnsi("customMessageBg")), "Ether bubble no longer uses customMessageBg");
	const replyLine = rawLines.find((line) => line.includes("Hello there"));
	check(!!replyLine && replyLine.includes(theme.getFgAnsi("customMessageText")), "Ether body uses customMessageText");
	check(!!replyLine && !replyLine.includes(theme.getFgAnsi("text")), "Ether body no longer uses text");

	check(chat.history?.length === 2, `history holds user + assistant (${chat.history?.length})`);

	// second turn keeps history
	await sleep(5);
	const stream2 = {
		async *[Symbol.asyncIterator]() {
			yield { type: "start" };
			yield { type: "text_delta", delta: "second" };
			yield { type: "done", reason: "stop" };
		},
		async result() { return { role: "assistant", content: [{ type: "text", text: "second" }] }; },
	};
	registry.streamSimple = (model, context) => { capturedContext = { ...context, messages: [...context.messages] }; return stream2; };
	chat.handleInput("again");
	chat.handleInput("\r");
	await sleep(20);
	check(capturedContext.messages.length === 3, `second turn sends 3 history messages (${capturedContext.messages.length})`);

	// ---- unread marker: masthead NEW plus a footer badge
	chat.focused = false;
	void chat.send("while away");
	await sleep(20);
	text = railRows(tui).join("\n");
	check(text.includes("NEW"), "masthead marks an unseen reply when unfocused");
	check(statusMap.get("side-chat") === "new reply", "footer badge shows a new reply");
	clickComposer(chat);
	await sleep(5);
	check(!railRows(tui).join("\n").includes("NEW"), "focusing clears the masthead marker");
	check(statusMap.get("side-chat") === undefined, "focusing clears the footer badge");

	chat.focused = false;
	tui.terminal.columns = 80;
	chat.syncVisibility();
	void chat.send("hidden reply");
	await sleep(20);
	check(statusMap.get("side-chat") === "new reply", "hidden rail still badges the footer");
	tui.terminal.columns = 140;
	chat.syncVisibility();
	check(statusMap.get("side-chat") === undefined, "showing the rails clears the badge");

	// ---- persistence: one Markdown file per day, restored on a new session
	const historyFiles = fs.readdirSync(HISTORY_DIR).filter((name) => name.endsWith(".md"));
	check(historyFiles.length === 1, `one history file for today (${historyFiles.join(",")})`);
	const historyText = fs.readFileSync(path.join(HISTORY_DIR, historyFiles[0]), "utf8");
	check(historyText.startsWith("# Side chat —"), "history file has a day heading");
	check(/## \d{2}:\d{2} · you/.test(historyText) && /## \d{2}:\d{2} · ether/.test(historyText), "history file has timed you/ether blocks");
	check(historyText.includes("what is the TUI?") && historyText.includes("Hello there"), "history file holds both sides of the turn");
	check(historyText.includes("second"), "later turns append to the same file");

	({ tui } = start(registry));
	chat = findChat(tui.layoutRoot);
	text = railRows(tui).join("\n");
	check(chat.thread.length === 8, `restored thread (${chat.thread.length} bubbles)`);
	check(text.split("Hello there").length - 1 === 1, "restored turn renders exactly once");
	check(text.includes("hidden reply"), "restored recent user text renders");
	check(chat.history.length === chat.thread.length, "restored history matches bubbles");

	// ---- read-only tools, follow-up turn, and path safety
	const toolRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ether-tools-"));
	fs.mkdirSync(path.join(toolRoot, "src"));
	fs.writeFileSync(path.join(toolRoot, "src", "demo.txt"), "hello from demo\nsecond line\n");
	fs.writeFileSync(path.join(os.tmpdir(), "ether-secret-test.txt"), "secret");

	const makeToolStream = (call) => ({
		async *[Symbol.asyncIterator]() {
			yield { type: "start" };
			yield { type: "toolcall_end", toolCall: call };
			yield { type: "done", reason: "toolUse" };
		},
		async result() { return { role: "assistant", content: [{ type: "toolCall", ...call }] }; },
	});
	const makeTextStream = (replyText) => ({
		async *[Symbol.asyncIterator]() {
			yield { type: "start" };
			yield { type: "text_delta", delta: replyText };
			yield { type: "done", reason: "stop" };
		},
		async result() { return { role: "assistant", content: [{ type: "text", text: replyText }] }; },
	});

	let toolContexts = [];
	let toolTurn = 0;
	const toolRegistry = {
		find: (provider, id) => ({ provider, id }),
		streamSimple(model, context) {
			toolContexts.push({ ...context, messages: [...context.messages] });
			toolTurn += 1;
			return toolTurn === 1
				? makeToolStream({ id: "call-1", name: "read_file", arguments: { path: "src/demo.txt" } })
				: makeTextStream("It says hi.");
		},
	};

	({ tui } = start(toolRegistry, toolRoot));
	chat = findChat(tui.layoutRoot);
	clickComposer(chat);
	chat.handleInput("read the demo");
	chat.handleInput("\r");
	await sleep(40);
	text = railRows(tui).join("\n");
	check(toolContexts[0]?.tools?.map((tool) => tool.name).join(",") === "list_dir,read_file,grep_workspace,web_search,fetch_url,read_history", "tools offered to the side model");
	check(toolContexts[0]?.messages?.at(-1)?.content?.[0]?.text === "read the demo", "tool turn ends with the user message");
	check(toolContexts[1]?.messages?.some((m) => m.role === "toolResult" && m.toolCallId === "call-1"), "tool result returned to the model");
	check(toolTurn === 2, `two model requests for one tool round (${toolTurn})`);
	const toolResult = chat.history.find((m) => m.role === "toolResult");
	check(toolResult?.content?.[0]?.text?.includes("hello from demo"), "read_file returned the file text");
	check(toolResult?.isError === false, "read_file succeeded");
	check(text.includes("It says hi."), "follow-up reply rendered after the tool");
	check(text.includes("// src"), `title shows the folder it read (${railRows(tui)[0].trim()})`);
	check(!text.includes("⌕"), "activity line cleared after the turn");

	toolContexts = [];
	toolTurn = 0;
	const escapeRegistry = {
		find: (provider, id) => ({ provider, id }),
		streamSimple(model, context) {
			toolContexts.push({ ...context, messages: [...context.messages] });
			toolTurn += 1;
			return toolTurn === 1
				? makeToolStream({ id: "call-x", name: "read_file", arguments: { path: "../ether-secret-test.txt" } })
				: makeTextStream("blocked");
		},
	};
	({ tui } = start(escapeRegistry, toolRoot));
	chat = findChat(tui.layoutRoot);
	clickComposer(chat);
	chat.handleInput("read outside");
	chat.handleInput("\r");
	await sleep(40);
	const escaped = chat.history.find((m) => m.role === "toolResult");
	check(escaped?.isError === true && escaped?.content?.[0]?.text?.includes("outside the workspace"), "path escape is refused");

	// ---- web tools: search, fetch, and the "never invent" instruction
	check(toolContexts[0]?.systemPrompt?.includes("Never invent specifics"), "system prompt forbids inventing current facts");
	const originalFetch = globalThis.fetch;
	const mock = (body, type) => ({ ok: true, status: 200, statusText: "OK", url: "https://example.com/", headers: { get: () => type }, text: async () => body });
	globalThis.fetch = async (url) => {
		const target = String(url);
		if (target.includes("duckduckgo.com")) {
			const html = '<html><body><div class="result results_links"><a class="result__a" href="https://example.com/page">Example Page</a><a class="result__snippet">Example snippet mentioning version 1.3.0 release notes</a></div></body></html>';
			return mock(html, "text/html; charset=utf-8");
		}
		if (target.includes("bing.com")) {
			const xml = '<?xml version="1.0"?><rss><channel><item><title>Example RSS</title><link>https://example.com/rss</link><description>Version 2.0 released today</description></item></channel></rss>';
			return mock(xml, "text/xml; charset=utf-8");
		}
		return mock("<html><body><h1>Release</h1><p>Version 1.3.0 is current.</p></body></html>", "text/html; charset=utf-8");
	};

	toolContexts = [];
	toolTurn = 0;
	const webRegistry = {
		find: (provider, id) => ({ provider, id }),
		streamSimple(model, context) {
			toolContexts.push({ ...context, messages: [...context.messages] });
			toolTurn += 1;
			if (toolTurn === 1) {
				const calls = [
					{ id: "web-1", name: "web_search", arguments: { query: "pi version release" } },
					{ id: "web-2", name: "fetch_url", arguments: { url: "https://example.com/release" } },
				];
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "start" };
						for (const call of calls) yield { type: "toolcall_end", toolCall: call };
						yield { type: "done", reason: "toolUse" };
					},
					async result() { return { role: "assistant", content: calls.map((call) => ({ type: "toolCall", ...call })) }; },
				};
			}
			return makeTextStream("Checked the web.");
		},
	};
	try {
		({ tui } = start(webRegistry));
		chat = findChat(tui.layoutRoot);
		clickComposer(chat);
		chat.handleInput("what is the latest pi version?");
		chat.handleInput("\r");
		await sleep(80);
		const webResults = chat.history.filter((m) => m.role === "toolResult");
		check(webResults.length === 2, `two web tool results (${webResults.length})`);
		const searchResult = webResults.find((m) => m.toolName === "web_search");
		const fetchResult = webResults.find((m) => m.toolName === "fetch_url");
		check(searchResult?.isError === false && searchResult.content[0].text.includes("example.com/page"), "web_search returns parsed hits");
		check(searchResult?.content[0].text.includes("1.3.0"), "web_search keeps the snippet");
		check(fetchResult?.isError === false && fetchResult.content[0].text.includes("Version 1.3.0 is current."), "fetch_url returns page text");
		check(toolContexts[1]?.messages?.filter((m) => m.role === "toolResult").length === 2, "both results return to the model");
		text = railRows(tui).join("\n");
		check(text.includes("Checked the web."), "reply after web tools renders");
	} finally {
		globalThis.fetch = originalFetch;
	}

	// ---- read_history: past days are listed and readable by the side model
	fs.writeFileSync(
		path.join(HISTORY_DIR, "2026-10-19.md"),
		"# Side chat — 2026-10-19\n\n## 09:00 · you\n\nyesterday question\n\n## 09:01 · ether\n\nyesterday answer\n",
	);
	toolContexts = [];
	toolTurn = 0;
	const historyRegistry = {
		find: (provider, id) => ({ provider, id }),
		streamSimple(model, context) {
			toolContexts.push({ ...context, messages: [...context.messages] });
			toolTurn += 1;
			if (toolTurn === 1) {
				const calls = [
					{ id: "hist-1", name: "read_history", arguments: { date: "2026-10-19" } },
					{ id: "hist-2", name: "read_history", arguments: {} },
				];
				return {
					async *[Symbol.asyncIterator]() {
						yield { type: "start" };
						for (const call of calls) yield { type: "toolcall_end", toolCall: call };
						yield { type: "done", reason: "toolUse" };
					},
					async result() { return { role: "assistant", content: calls.map((call) => ({ type: "toolCall", ...call })) }; },
				};
			}
			return makeTextStream("Found yesterday.");
		},
	};
	({ tui } = start(historyRegistry));
	chat = findChat(tui.layoutRoot);
	clickComposer(chat);
	chat.handleInput("what did we talk about yesterday?");
	chat.handleInput("\r");
	await sleep(40);
	const historyResults = chat.history.filter((m) => m.role === "toolResult");
	const dayResult = historyResults.find((m) => m.toolCallId === "hist-1");
	const listResult = historyResults.find((m) => m.toolCallId === "hist-2");
	check(dayResult?.isError === false && dayResult.content[0].text.includes("yesterday question"), "read_history returns an older day");
	check(dayResult?.content[0].text.includes("yesterday answer"), "read_history keeps both roles");
	check(listResult?.content[0].text.includes("2026-10-19 — 2 turns"), "read_history lists saved days when no date is given");
	text = railRows(tui).join("\n");
	check(text.includes("Found yesterday."), "reply after history tools renders");

	// ---- search fallback: a DDG challenge falls back to Bing RSS
	globalThis.fetch = async (url) => {
		const target = String(url);
		const mock = (body, type) => ({ ok: true, status: 200, statusText: "OK", url: target, headers: { get: () => type }, text: async () => body });
		if (target.includes("duckduckgo.com")) {
			return mock('<html><body>anomaly challenge</body></html>', "text/html; charset=utf-8");
		}
		if (target.includes("bing.com")) {
			return mock('<?xml version="1.0"?><rss><channel><item><title>RSS Hit</title><link>https://example.com/rss</link><description>Version 7.2 released notes</description></item></channel></rss>', "text/xml; charset=utf-8");
		}
		return mock("<html><body>page</body></html>", "text/html; charset=utf-8");
	};
	toolContexts = [];
	toolTurn = 0;
	const fallbackRegistry = {
		find: (provider, id) => ({ provider, id }),
		streamSimple(model, context) {
			toolContexts.push({ ...context, messages: [...context.messages] });
			toolTurn += 1;
			return toolTurn === 1
				? makeToolStream({ id: "fb-1", name: "web_search", arguments: { query: "version released" } })
				: makeTextStream("rss works");
		},
	};
	({ tui } = start(fallbackRegistry));
	chat = findChat(tui.layoutRoot);
	clickComposer(chat);
	chat.handleInput("check the release");
	chat.handleInput("\r");
	await sleep(80);
	const fallbackResult = chat.history.find((m) => m.role === "toolResult" && m.toolCallId === "fb-1");
	check(fallbackResult?.isError === false && fallbackResult.content[0].text.includes("example.com/rss"), "DDG challenge falls back to Bing RSS");

	// ---- error path
	const failRegistry = {
		find: (provider, id) => ({ provider, id }),
		streamSimple() { throw new Error("provider is down"); },
	};
	({ tui } = start(failRegistry));
	chat = findChat(tui.layoutRoot);
	clickComposer(chat);
	chat.handleInput("hello");
	chat.handleInput("\r");
	await sleep(20);
	text = railRows(tui).join("\n");
	check(text.includes("! provider is down"), "stream failure renders a one-line note");
	check(text.includes("hello"), "user message survives the failure");
	check(!text.includes("ETHER ●"), "no empty Ether bubble left behind");
	check(text.includes("IDLE"), "status returns to IDLE after failure");

	// ---- no model path
	fs.unlinkSync(CONFIG);
	({ tui } = start(failRegistry));
	chat = findChat(tui.layoutRoot);
	clickComposer(chat);
	chat.handleInput("anyone there?");
	chat.handleInput("\r");
	await sleep(20);
	text = railRows(tui).join("\n");
	check(text.includes("run /chat-model"), "missing side model explains the fix");
	check(!chat.history?.some((m) => m.role === "user" && m.content?.[0]?.text === "anyone there?"), "nothing sent without a model");
} finally {
	if (backup === null) {
		if (fs.existsSync(CONFIG)) fs.unlinkSync(CONFIG);
	} else {
		fs.writeFileSync(CONFIG, backup);
	}
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
