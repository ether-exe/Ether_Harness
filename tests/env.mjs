/**
 * Shared test environment.
 *
 * Resolves the harness source, the installed pi package, and pi-tui's internal
 * render helpers. Tests must never read or write the real agent config.
 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import { ROOT, resolvePiDependency, resolvePiRoot } from "../lib/pi-paths.mjs";

const slash = (value) => value.replace(/\\/g, "/");

export { ROOT };
export const PI_ROOT = resolvePiRoot();
export const EXT = join(ROOT, "extensions", "ether-sidebar.ts");
export const THEME = join(ROOT, "themes", "Ether.json");
export const THEME_BLUE = join(ROOT, "themes", "Bluether.json");
const requireDependency = (specifier) => {
	const resolved = resolvePiDependency(specifier, PI_ROOT);
	if (!resolved) throw new Error(`Cannot resolve pi dependency: ${specifier}`);
	return resolved;
};

export const TUI = slash(requireDependency("@earendil-works/pi-tui/dist/index.js"));
const JITI = slash(requireDependency("jiti/lib/jiti.mjs"));
const TUI_LAYOUT = slash(requireDependency("@earendil-works/pi-tui/dist/layout.js"));
const TUI_UTILS = slash(requireDependency("@earendil-works/pi-tui/dist/utils.js"));
const TYPEBOX = slash(requireDependency("typebox/build/index.mjs"));

/** Isolated side-chat config; the extension honors ETHER_CHAT_CONFIG. */
export const TEMP_ROOT = mkdtempSync(join(tmpdir(), "ether-harness-test-"));
export const CONFIG = join(TEMP_ROOT, "chat-sidebar.json");
process.env.ETHER_CHAT_CONFIG = CONFIG;

const jitiModule = await import(pathToFileURL(JITI).href);
const themeModule = await import(
	pathToFileURL(join(PI_ROOT, "dist", "modes", "interactive", "theme", "theme.js")).href
);
const layoutModule = await import(pathToFileURL(TUI_LAYOUT).href);
const utilsModule = await import(pathToFileURL(TUI_UTILS).href);

export const loadThemeFromPath = themeModule.loadThemeFromPath;
export const setThemeInstance = themeModule.setThemeInstance;
export const renderLayoutFrame = layoutModule.renderLayoutFrame;
export const stripTerminalSequences = utilsModule.stripTerminalSequences;
export const visibleWidth = utilsModule.visibleWidth;
export const sliceByColumn = utilsModule.sliceByColumn;

// Force truecolor so layout assertions do not depend on the terminal running the tests.
// The 256-color path is exercised explicitly in prose-preview-test.mjs.
export const theme = loadThemeFromPath(THEME, "truecolor");
// Pi's highlighter reads the global theme; set it so code-preview tests are real.
setThemeInstance(theme);

/** New jiti instance per call, so reload tests get fresh module state. */
export function makeJiti() {
	return jitiModule.createJiti(import.meta.url, {
		alias: {
			"@earendil-works/pi-tui": TUI,
			"@earendil-works/pi-coding-agent": slash(join(PI_ROOT, "dist", "index.js")),
			typebox: TYPEBOX,
		},
		interopDefault: true,
		moduleCache: false,
		fsCache: false,
	});
}

process.on("exit", () => {
	try {
		rmSync(TEMP_ROOT, { recursive: true, force: true });
	} catch {
		// best-effort cleanup
	}
});
