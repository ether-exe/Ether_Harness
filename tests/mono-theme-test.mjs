/**
 * ETHEREX harness: the monochrome theme keeps the main message white and every
 * other role a distinct dimmer gray, including code preview syntax colors.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
	EXT,
	THEME_MONO,
	makeJiti,
	loadThemeFromPath,
	setThemeInstance,
	renderLayoutFrame,
	stripTerminalSequences,
	visibleWidth,
} from "./env.mjs";

const HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-mono-history-"));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "ether-mono-files-"));
process.env.ETHER_CHAT_HISTORY_DIR = HISTORY_DIR;
fs.mkdirSync(path.join(WORK, "src"));
fs.writeFileSync(path.join(WORK, "src", "code.ts"), '// grayscale preview\nconst x = "hello";\nfunction add(n: number) { return n + 1; }\n');

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
		this.focusedComponent = component;
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

const handlers = new Map();
const pi = { on(event, handler) { handlers.set(event, handler); }, registerCommand() {} };
let widgetFactory;

try {
	const mono = loadThemeFromPath(THEME_MONO, "truecolor");
	setThemeInstance(mono);
	const rawTheme = JSON.parse(fs.readFileSync(THEME_MONO, "utf8"));
	check(mono.name === "ETHEREX", "theme name is ETHEREX");
	check(Object.keys(rawTheme.colors ?? {}).length === 56, "ETHEREX has 56 color tokens");

	const nonGray = Object.entries(mono.colors ?? {}).filter(([, color]) => {
		if (!color || color.kind !== "rgb") return true;
		return color.r !== color.g || color.g !== color.b;
	});
	check(nonGray.length === 0, `every theme color is grayscale (${nonGray.map(([name]) => name).join(", ") || "all"})`);
	const text = mono.colors.text;
	const folder = mono.colors.toolTitle;
	const file = mono.colors.dim;
	const thinking = mono.colors.thinkingText;
	check(text?.r === 255 && text?.g === 255 && text?.b === 255, "main message text is pure white");
	check(folder?.r < text?.r && file?.r < folder?.r && thinking?.r < file?.r, "folder > file > thinking stays a dimmer-white hierarchy");
	check(mono.colors.accent?.r < 255, "structure/accent is not pure white");

	const extension = await makeJiti().import(EXT, { default: true });
	extension(pi);
	const ctx = {
		mode: "tui",
		model: { id: "deepseek-flash", contextWindow: 128000, reasoning: true },
		thinkingLevel: "max",
		cwd: WORK,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
		hasPendingMessages: () => false,
		sessionManager: { getEntries: () => [], getSessionId: () => "mono", getEntryCount: () => 0, getLeafId: () => null, getSessionName: () => undefined },
		ui: { theme: mono, setWidget(_name, factory) { widgetFactory = factory; }, setFooter() {}, setStatus() {} },
	};
	handlers.get("session_start")({}, ctx);
	const tui = new FakeTUI(new AppRoot());
	widgetFactory(tui, mono);
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
	check(!!tree, "Files rail is mounted");

	const folderLine = raw().find((line) => stripTerminalSequences(line).slice(5, 29).includes("src"));
	const fileLine = raw().find((line) => stripTerminalSequences(line).slice(5, 29).includes("code.ts"));
	check(!!folderLine && folderLine.includes(mono.getFgAnsi("toolTitle")), "folders use the dim folder tone");
	check(!!fileLine && fileLine.includes(mono.getFgAnsi("dim")), "inactive files use the dimmer file tone");

	const fileY = plain().findIndex((line) => line.slice(5, 29).includes("code.ts"));
	tree.handleMouse({ type: "click", button: "left", x: 2, y: fileY, screenX: 2, screenY: fileY, width: 24, height: 40, shift: false, alt: false });
	renderLayoutFrame(tui.layoutRoot, 140, 40);
	const preview = findByName(tui.layoutRoot, "EtherPreviewSidebar");
	check(!!preview, "preview opens for the code file");
	check(!!preview && preview.sourceLines.length > 0, "code preview highlights the file");
	const code = preview?.sourceLines.join("\n") ?? "";
	const codeCodes = [...code.matchAll(/\x1b\[38;2;(\d+);(\d+);(\d+)m/g)];
	check(codeCodes.length > 0, "code preview emits truecolor syntax");
	check(
		codeCodes.every(([, r, g, b]) => r === g && g === b),
		"code preview syntax stays grayscale",
	);
	check(!code.includes("\x1b[38;2;255;121;198m") && !code.includes("\x1b[38;2;80;250;123m"), "no Dracula pink/green leaks into ETHEREX");

	const frame = raw().join("\n");
	const frameCodes = [...frame.matchAll(/\x1b\[(?:38|48);2;(\d+);(\d+);(\d+)m/g)];
	check(frameCodes.length > 0, "the rendered chrome emits truecolor");
	check(
		frameCodes.every(([, r, g, b]) => r === g && g === b),
		`the whole chrome is grayscale (${frameCodes.length} color codes)`,
	);
	check(!frame.includes("\x1b[38;2;58;123;203m") && !frame.includes("\x1b[48;2;36;90;156m"), "no legacy blue header or side-chat fill");
	check(frame.includes(mono.getBgAnsi("userMessageBg")) || !frame.includes("YOU"), "side-chat bubbles use the theme fill");
} finally {
	handlers.get("session_shutdown")?.();
	fs.rmSync(HISTORY_DIR, { recursive: true, force: true });
	fs.rmSync(WORK, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
