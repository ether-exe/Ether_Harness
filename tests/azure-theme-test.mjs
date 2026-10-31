/**
 * 𝞢𝝉𝜢𝜺𝜞 harness: electric azure (#076BF0) with champagne gold filigree,
 * a legible deep-blue chrome, and native jewel syntax in the preview.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import {
	EXT,
	PI_ROOT,
	THEME_AZURE,
	makeJiti,
	loadThemeFromPath,
	setThemeInstance,
	renderLayoutFrame,
	stripTerminalSequences,
	visibleWidth,
} from "./env.mjs";

const HISTORY_DIR = fs.mkdtempSync(path.join(os.tmpdir(), "ether-azure-history-"));
const WORK = fs.mkdtempSync(path.join(os.tmpdir(), "ether-azure-files-"));
process.env.ETHER_CHAT_HISTORY_DIR = HISTORY_DIR;
fs.mkdirSync(path.join(WORK, "src"));
fs.writeFileSync(
	path.join(WORK, "src", "crown.ts"),
	'// azure preview\nimport { theme } from "./theme";\nconst crown: number = 7;\nfunction reign(name: string): string {\n\treturn `king ${name}`;\n}\n',
);

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};

const luminance = (color) => {
	const channel = (value) => {
		const c = value / 255;
		return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
	};
	return 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
};
const contrast = (a, b) => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
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
	const rawTheme = JSON.parse(fs.readFileSync(THEME_AZURE, "utf8"));
	const schema = await import(
		pathToFileURL(path.join(PI_ROOT, "dist", "modes", "interactive", "theme", "theme-schema.js")).href
	);
	schema.validateThemeJson(THEME_AZURE, rawTheme);
	check(rawTheme.name === "𝞢𝝉𝜢𝜺𝜞", `theme name is 𝞢𝝉𝜢𝜺𝜞 (${rawTheme.name})`);
	check(path.basename(THEME_AZURE, ".json") === rawTheme.name, "theme file name matches the display name");
	check(Object.keys(rawTheme.colors ?? {}).length === 56, "𝞢𝝉𝜢𝜺𝜞 has 56 color tokens");
	check(rawTheme.appearance === "dark", "theme declares a dark appearance");

	const azure = loadThemeFromPath(THEME_AZURE, "truecolor");
	setThemeInstance(azure);
	check(azure.name === "𝞢𝝉𝜢𝜺𝜞", "pi loads the azure theme");
	const accent = azure.colors.accent;
	const text = azure.colors.text;
	const panel = azure.colors.toolPendingBg;
	check(accent.r === 7 && accent.g === 107 && accent.b === 240, "the wordmark accent is exactly #076BF0");
	check(accent.b > accent.g * 2 && accent.g > accent.r * 5, "the accent is a saturated azure, not sky teal");
	check(accent.b > 200, "accent stays luminous against the night canvas");
	check(text.r > 220 && text.g > 225 && text.b > 240, "text is pearl white with a blue cast");
	check(contrast(accent, panel) >= 4, `azure accent clears large-text contrast (${contrast(accent, panel).toFixed(2)}:1)`);
	check(contrast(azure.colors.toolTitle, panel) >= 7, "folders and chrome use a readable azure tint");
	check(contrast(text, panel) >= 12, `pearl text clears AAA contrast (${contrast(text, panel).toFixed(1)}:1)`);
	check(contrast(azure.colors.muted, panel) >= 7, "muted steel stays readable");
	check(contrast(azure.colors.dim, panel) >= 4.5, "dim slate still clears AA contrast");

	const selected = azure.colors.selectedBg;
	const user = azure.colors.userMessageBg;
	check(selected.b > selected.g * 1.3 && selected.g > selected.r * 3, "selection is a deep azure panel");
	check(user.b > user.g * 1.4 && user.g > user.r * 3, "user bubbles are dark azure panels");
	check(luminance(selected) < 0.08 && luminance(panel) < 0.02, "surfaces stay night dark");
	const gold = azure.colors.syntaxFunction;
	check(gold.r > gold.g && gold.g > gold.b && gold.r - gold.b > 90, "functions and headings carry champagne gold");
	check(azure.colors.mdHeading.r > azure.colors.mdHeading.b, "markdown headings are gilded");
	const green = azure.colors.syntaxString;
	check(green.g > green.r * 1.5 && green.g > green.b, "strings are emerald");
	const violet = azure.colors.syntaxType;
	check(violet.b > violet.g && violet.r > violet.g && violet.b > 230, "types are amethyst");
	check(azure.colors.toolDiffAdded.g > azure.colors.toolDiffAdded.r, "added lines are green");
	check(azure.colors.toolDiffRemoved.r > azure.colors.toolDiffRemoved.g, "removed lines are rose");

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
		sessionManager: {
			getEntries: () => [],
			getSessionId: () => "azure",
			getEntryCount: () => 0,
			getLeafId: () => null,
			getSessionName: () => undefined,
		},
		ui: {
			theme: azure,
			setWidget(_name, factory) {
				widgetFactory = factory;
			},
			setFooter() {},
			setStatus() {},
		},
	};
	handlers.get("session_start")({}, ctx);
	const tui = new FakeTUI(new AppRoot());
	widgetFactory(tui, azure);
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

	const frame = raw().join("\n");
	check(frame.includes(azure.getFgAnsi("accent")), "the wordmark is painted in azure");
	check(frame.includes(azure.getFgAnsi("border")), "the chrome frame uses the deep azure border");
	const folderLine = raw().find((line) => stripTerminalSequences(line).slice(5, 29).includes("src"));
	const fileLine = raw().find((line) => stripTerminalSequences(line).slice(5, 29).includes("crown.ts"));
	check(!!folderLine && folderLine.includes(azure.getFgAnsi("toolTitle")), "folders use the light azure tool tone");
	check(!!fileLine && fileLine.includes(azure.getFgAnsi("dim")), "inactive files use the slate tone");

	const fileY = plain().findIndex((line) => line.slice(5, 29).includes("crown.ts"));
	tree.handleMouse({
		type: "click",
		button: "left",
		x: 2,
		y: fileY,
		screenX: 2,
		screenY: fileY,
		width: 24,
		height: 40,
		shift: false,
		alt: false,
	});
	renderLayoutFrame(tui.layoutRoot, 140, 40);
	const preview = findByName(tui.layoutRoot, "EtherPreviewSidebar");
	check(!!preview, "preview opens for the code file");
	check(!!preview && preview.sourceLines.length > 0, "code preview highlights the file");
	const code = preview?.sourceLines.join("\n") ?? "";
	for (const token of [
		"syntaxComment",
		"syntaxKeyword",
		"syntaxFunction",
		"syntaxString",
		"syntaxNumber",
		"syntaxType",
	]) {
		check(code.includes(azure.getFgAnsi(token)), `preview uses the theme's ${token}`);
	}
	const dracula = [
		"\x1b[38;2;255;121;198m",
		"\x1b[38;2;80;250;123m",
		"\x1b[38;2;241;250;140m",
		"\x1b[38;2;189;147;249m",
	];
	check(dracula.every((escape) => !code.includes(escape)), "no Dracula pink, green, yellow, or purple leaks into the preview");

	const azure256 = loadThemeFromPath(THEME_AZURE, "256");
	check(azure256.getColorMode() === "256", "the theme loads in 256-color mode");
	check(azure256.getFgAnsi("accent").startsWith("\x1b[38;5;"), "256-color accents use palette indexes");
} finally {
	handlers.get("session_shutdown")?.();
	fs.rmSync(HISTORY_DIR, { recursive: true, force: true });
	fs.rmSync(WORK, { recursive: true, force: true });
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
