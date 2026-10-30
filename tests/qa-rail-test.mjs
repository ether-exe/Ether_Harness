/**
 * QA rail harness: form/state flow, progress parsing, stop/reset, slot sharing,
 * taskbar tint, and the browser-tool extension's policy. The child is a fixture,
 * so this proves the plumbing without a model or a real browser.
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

const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "ether-qa-test-"));
const ARTIFACTS = path.join(TMP, "artifacts");
const ARGS = path.join(TMP, "args.json");
process.env.ETHER_QA_PI = path.join(ROOT, "tests", "fixtures", "fake-qa-pi.mjs");
process.env.ETHER_QA_ARTIFACTS_ROOT = ARTIFACTS;
process.env.ETHER_QA_AGENT = path.join(ROOT, "qa", "ether-qa-agent.ts");
process.env.FAKE_QA_ARGS = ARGS;
process.env.ETHER_CHAT_HISTORY_DIR = path.join(TMP, "history");
process.env.ETHER_GH_BIN ??= path.join(ROOT, "tests", "fixtures", "fake-gh.mjs");
process.env.FAKE_GH_MODE ??= "auth";

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};
const waitFor = async (predicate, label, timeout = 6000) => {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (predicate()) return true;
		await new Promise((resolve) => setTimeout(resolve, 25));
	}
	check(false, `timed out waiting for ${label}`);
	return false;
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
	getContextUsage: () => ({ tokens: 100, contextWindow: 128000, percent: 0.1 }),
	hasPendingMessages: () => false,
	sessionManager: {
		getEntries: () => [],
		getSessionId: () => "qa-session",
		getEntryCount: () => 0,
		getLeafId: () => null,
		getSessionName: () => "qa",
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

	// The QA icon lives on the taskbar and opens the rail in place of chat.
	check(plain()[9]?.[1] === "✓", "QA icon sits below GitHub (row 9)");
	fire("alt+7");
	let qa = findByName(tui.layoutRoot, "EtherQaSidebar");
	check(!!qa, "alt+7 mounts the QA rail");
	check(findByName(tui.layoutRoot, "EtherChatSidebar") === null, "opening QA hides the side chat");
	check(frame()[9].includes(theme.fg("toolTitle", "✓")), "visible QA icon is blue");
	check(frame()[5].includes(theme.fg("muted", "✦")), "hidden chat icon stays muted");
	check(qa.field === "address" && tui.focusedComponent === qa, "opening QA focuses an empty address field");
	qa.field = "task";
	qa.handleMouse({
		type: "click",
		button: "left",
		x: 3,
		y: qa.addressRow,
		width: 40,
		height: 40,
		shift: false,
		alt: false,
		ctrl: false,
	});
	check(qa.field === "address", "clicking the address row refocuses ADDRESS");

	// Empty address is rejected and the rail focuses the missing field.
	qa.start();
	check(qa.state === "idle" && qa.error.includes("address"), "an empty address is rejected");
	check(qa.field === "address", "the missing address field gets focus");
	qa.taskEditor.setText("https://platform.claude.com/docs/en/build-with-claude/streaming");
	qa.start();
	check(qa.error.includes("ADDRESS above"), "a URL pasted in TASK points back to ADDRESS");
	qa.taskEditor.setText("");

	// Public http(s) addresses are accepted; the child's gate still scopes navigation.
	qa.addressInput.setValue("https://example.com/");
	qa.taskEditor.setText("test the public site");
	qa.start();
	await waitFor(() => fs.existsSync(ARGS) && qa.state !== "idle", "the public run to start");
	check(qa.state !== "idle" && !qa.error, "public https addresses are accepted");
	check(JSON.parse(fs.readFileSync(ARGS, "utf8")).env.ETHER_QA_ORIGIN === "https://example.com", "the child receives the public origin");
	qa.reset();

	// Local validation still rejects an empty task before spawning.
	qa.addressInput.setValue("http://localhost:3000");
	qa.taskEditor.setText("");
	qa.start();
	check(qa.state === "idle" && qa.error.includes("task"), "an empty task is rejected");
	check(qa.field === "task", "the missing task field gets focus");
	check(qa.child === undefined, "validation failures do not spawn a child");
	check(stripTerminalSequences(frame().join("\n")).includes("enter a task"), "validation errors are visible in the rail");

	// Start from the rail's button using the real press/release/click sequence.
	qa.taskEditor.setText("test the signup flow");
	renderLayoutFrame(tui.layoutRoot, 140, 40);
	const buttonClick = (y) => {
		const base = { button: "left", x: 2, y, width: 40, height: 40, shift: false, alt: false, ctrl: false };
		qa.handleMouse({ ...base, type: "press" });
		qa.handleMouse({ ...base, type: "release" });
		qa.handleMouse({ ...base, type: "click" });
	};
	buttonClick(qa.buttonRow);
	check(qa.state === "running", "the START button launches the run");
	await waitFor(() => qa.state === "done", "the fake QA run to finish");
	check(qa.actionCount === 2, `two browser actions were counted (${qa.actionCount})`);
	check(qa.done[0]?.text === "open http://localhost:3000", `the first done line is readable (${qa.done[0]?.text})`);
	check(qa.done[1]?.text === "click e12", `the click target is shown (${qa.done[1]?.text})`);
	check(qa.report.includes("I opened the local app"), "the final report paragraph is captured");
	check(qa.verdict === "PASS", "the verdict is parsed from the report");
	check(qa.usage.cost > 0, "usage cost is accumulated from message events");
	const args = JSON.parse(fs.readFileSync(ARGS, "utf8"));
	check(args.args.includes("--mode") && args.args.includes("json"), "the child runs in JSON mode");
	check(args.args.includes("--no-session") && args.args.includes("--no-builtin-tools"), "the child has no session and no built-in tools");
	check(args.args.includes("-ne") && args.args.includes("builtin:mcp"), "the child loads only the requested extensions");
	check(args.args.includes(path.join(ROOT, "qa", "ether-qa-agent.ts")), "the child loads the QA browser extension");
	check(args.args.includes("--model") && args.args.includes("deepseek/deepseek-flash"), "the child inherits the main model");
	check(args.env.ETHER_QA_ORIGIN === "http://localhost:3000", "the child receives the allowed origin");
	check(args.env.ETHER_QA_ARTIFACTS && args.env.ETHER_QA_ARTIFACTS.startsWith(ARTIFACTS), "the child receives its artifact directory");

	const doneRaw = frame();
	const donePlain = stripTerminalSequences(doneRaw.join("\n"));
	check(donePlain.includes("REPORT") && donePlain.includes("PASS"), "the rail shows the report and verdict");
	check(doneRaw.join("\n").includes(theme.fg("success", "PASS")), "the PASS verdict is green");
	check(doneRaw.every((line) => visibleWidth(line) === 140), "the 140-col frame keeps its width with QA open");

	// Reset clears the form and the artifacts for a fresh task.
	const runDir = qa.artifactsDir;
	qa.reset();
	check(qa.state === "idle" && qa.addressInput.getValue() === "" && qa.taskEditor.getText() === "", "reset clears the form");
	check(!fs.existsSync(runDir), "reset removes the run artifacts");
	check(qa.done.length === 0 && qa.report === "", "reset clears progress and the report");

	// A long run can be stopped, and it keeps running while the rail is collapsed.
	process.env.FAKE_QA_MODE = "hang";
	qa.addressInput.setValue("http://localhost:3000");
	qa.taskEditor.setText("hang run");
	qa.start();
	await waitFor(() => qa.state === "running" && qa.actionCount >= 1, "the hanging run to start");
	fire("alt+4");
	check(findByName(tui.layoutRoot, "EtherQaSidebar") === null, "opening chat hides QA again");
	check(qa.state === "running", "hiding the rail does not stop the run");
	fire("alt+7");
	check(!!findByName(tui.layoutRoot, "EtherQaSidebar") && qa.state === "running", "reopening QA preserves the running task");
	buttonClick(qa.buttonRow);
	await waitFor(() => qa.state === "stopped", "the hanging run to stop");
	check(qa.child === undefined, "stopping clears the child process");

	// The stopped state exposes Reset, which kills and clears everything.
	const hangDir = qa.artifactsDir;
	qa.reset();
	check(qa.state === "idle" && !fs.existsSync(hangDir), "reset after stop clears the run");
	process.env.FAKE_QA_MODE = "ok";

	// The browser-tool extension itself: trimmed exposure and navigation policy.
	const qaAgentModule = await makeJiti().import(path.join(ROOT, "qa", "ether-qa-agent.ts"));
	const qaAgent = qaAgentModule.default ?? qaAgentModule;
	let registered = null;
	let policy = null;
	let registeredTool = null;
	const stub = {
		registerMcpServer(name, config) {
			registered = { name, config };
		},
		registerTool(tool) {
			registeredTool = tool;
		},
		on(event, handler) {
			if (event === "tool_call") policy = handler;
		},
	};
	process.env.ETHER_QA_ORIGIN = "http://localhost:3000";
	process.env.ETHER_QA_ARTIFACTS = path.join(TMP, "agent-artifacts");
	process.env.ETHER_QA_MAX_ACTIONS = "2";
	qaAgent(stub);
	check(registered?.name === "ether_qa", "the QA agent registers a private MCP server");
	check(registered?.config.exposure === "hidden", "the MCP server is hidden by default");
	check(registered?.config.cwd === path.join(TMP, "agent-artifacts"), "browser files resolve inside the run directory");
	check(registered?.config.toolExposure?.browser_navigate === "direct", "navigation is exposed directly");
	check(registered?.config.toolExposure?.browser_evaluate === "codemode", "javascript evaluation is reachable only from the fixed helper");
	check(registeredTool?.name === "enable_flutter_accessibility", "the Flutter accessibility helper is registered");
	check(registered?.config.args.includes("--headless") && registered?.config.args.includes("--isolated"), "the browser is headless and isolated");
	const helperCalls = [];
	const helperCtx = {
		async executeTool(name, args) {
			helperCalls.push({ name, args });
			return { isError: false, result: { content: [{ type: "text", text: "### Result\ntrue\n### Ran Playwright code" }] } };
		},
	};
	const helperResult = await registeredTool.execute("helper", {}, undefined, undefined, helperCtx);
	check(helperResult.details?.enabled === true && helperResult.content[0].text.includes("enabled"), "the Flutter helper enables semantics through the fixed evaluate script");
	check(helperCalls[0]?.name === "mcp__ether_qa__browser_evaluate", "the helper calls browser_evaluate internally");
	check(
		registered?.config.args.includes("--output-dir") && registered?.config.args.includes(path.join(TMP, "agent-artifacts")),
		"the browser writes artifacts to the run directory",
	);
	check(fs.existsSync(path.join(ROOT, "qa", "ether-qa-agent.ts")) && !fs.existsSync(path.join(ROOT, "extensions", "ether-qa-agent.ts")), "the QA helper lives outside the discovered extensions directory");
	check(qaAgentModule.isAllowedNavigation("http://localhost:3000/page", "http://localhost:3000"), "localhost navigation is allowed");
	check(qaAgentModule.isAllowedNavigation("https://example.com/page", "https://example.com"), "the supplied public origin is allowed");
	check(qaAgentModule.isAllowedNavigation("https://www.example.com/x", "https://example.com"), "same-site subdomains are allowed");
	check(qaAgentModule.isAllowedNavigation("https://login.example.com/x", "https://www.example.com"), "subdomains of a www origin are allowed");
	check(!qaAgentModule.isAllowedNavigation("https://evil.com", "https://example.com"), "unrelated sites are rejected");
	check(!qaAgentModule.isAllowedNavigation("http://localhost:3000", "https://example.com"), "a public task cannot probe loopback");
	check(!qaAgentModule.isAllowedNavigation("https://example.com", "http://localhost:3000"), "a local app cannot browse public sites");
	const external = policy?.({ toolName: "mcp__ether_qa__browser_navigate", input: { url: "https://example.com" } });
	check(external?.block === true, "the tool_call gate blocks external navigation");
	const local = policy?.({ toolName: "mcp__ether_qa__browser_navigate", input: { url: "http://localhost:3000/x" } });
	check(local === undefined, "the tool_call gate allows localhost");
	policy?.({ toolName: "mcp__ether_qa__browser_snapshot", input: {} });
	const limited = policy?.({ toolName: "mcp__ether_qa__browser_snapshot", input: {} });
	check(limited?.block === true, "the action cap blocks runaway runs");

	process.env.ETHER_QA_MAX_ACTIONS = "20";
	let filePolicy = null;
	qaAgent({
		registerMcpServer() {},
		registerTool() {},
		on(event, handler) {
			if (event === "tool_call") filePolicy = handler;
		},
	});
	const inside = filePolicy?.({
		toolName: "mcp__ether_qa__browser_take_screenshot",
		input: { filename: "shot.png" },
	});
	const outside = filePolicy?.({
		toolName: "mcp__ether_qa__browser_take_screenshot",
		input: { filename: "C:/Windows/Temp/escape.png" },
	});
	check(inside === undefined, "a relative screenshot name stays in the run directory");
	check(outside?.block === true, "an absolute screenshot path outside the run directory is blocked");
} finally {
	handlers.get("session_shutdown")?.();
	fs.rmSync(TMP, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
