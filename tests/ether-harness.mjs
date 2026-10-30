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


class FakeTUI {
	terminal = { rows: 40, columns: 140 };
	lastInput = "";
	constructor(root) {
		this.layoutRoot = root;
	}
	setLayoutRoot(root) {
		this.layoutRoot = root;
	}
	handleInput(data) {
		this.lastInput = data;
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

let widgetFactory;
let footerFactory;
const handlers = new Map();
const commands = new Map();
const pi = {
	on(event, handler) { handlers.set(event, handler); },
	registerCommand(name, def) { commands.set(name, def); },
};

function makeCtx(modelId = "deepseek-flash") {
	return {
		mode: "tui",
		model: { id: modelId, contextWindow: 128000, reasoning: true },
		thinkingLevel: "max",
		cwd: ROOT,
		isIdle: () => true,
		getContextUsage: () => ({ tokens: 12345, contextWindow: 128000, percent: 9.6 }),
		hasPendingMessages: () => false,
		sessionManager: {
			getEntries: () => [],
			getSessionId: () => "session-abcdef123456",
			getEntryCount: () => 0,
			getLeafId: () => null,
			getSessionName: () => "right-rail",
		},
		ui: { theme, setWidget(_name, factory) { widgetFactory = factory; }, setFooter(factory) { footerFactory = factory; } },
	};
}

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};

let extension = await makeJiti().import(EXT, { default: true });
const ctx1 = makeCtx();
extension(pi);
handlers.get("session_start")({}, ctx1);
const tui = new FakeTUI(new AppRoot());
widgetFactory(tui, theme);
const footerData = { getGitBranch: () => "main", getExtensionStatuses: () => new Map([["build", "ok"]]) };
const footer = footerFactory(tui, theme, footerData);

let newHandlers;

try {
	for (const width of [160, 140, 120, 100, 90, 72, 71, 60]) {
		const frame = renderLayoutFrame(tui.layoutRoot, width, 40);
		const plain = frame.lines.map((line) => stripTerminalSequences(line));
		const nonEmpty = plain.filter((line) => line !== "");
		const widthsOk = nonEmpty.every((line) => visibleWidth(line) === width);
		const rowsOk = plain.length === 40;
		const railsVisible = width >= 85;
		const filesVisible = width >= 110;
		const taskbarEdge = plain[10]?.[4] === "│";
		const filesEdge = plain[10]?.[28] === "│";
		const chatEdge = plain[10]?.[width - 40] === "│";
		const railCheck = railsVisible
			? taskbarEdge && chatEdge && filesEdge === filesVisible
			: taskbarEdge && !filesEdge && !chatEdge;
		const headerTop = plain[0] ?? "";
		const headerOk = railsVisible
			? headerTop.slice(filesVisible ? 29 : 5).startsWith("┌") && headerTop.slice(width - 40).startsWith("│ ● ETHER")
			: headerTop === `    │┌${"─".repeat(width - 7)}┐`;
		const rightRailOk = !railsVisible || plain[0]?.slice(width - 40).startsWith("│ ● ETHER");
		check(
			widthsOk && rowsOk && railCheck && headerOk && rightRailOk,
			`width ${width}: lines=${widthsOk} rows=${rowsOk} rails=${railCheck} header=${headerOk} chatHeading=${rightRailOk}`,
		);
	}

	// LeftSidebarA: four wired icons at the top, Settings anchored to the bottom.
	for (const width of [140, 60]) {
		const frame = renderLayoutFrame(tui.layoutRoot, width, 40);
		const plain = frame.lines.map((line) => stripTerminalSequences(line));
		const topIcons = ["▤", "◫", "✦", "⑂", "✓", "✎"];
		const drawn = plain
			.slice(1, -1)
			.map((line, index) => ({ row: index + 1, glyph: line?.[1] ?? " " }))
			.filter(({ glyph }) => glyph !== " ");
		const iconsOk =
			drawn.length === topIcons.length + 1 &&
			topIcons.every((icon, index) => drawn[index]?.row === 1 + index * 2 && drawn[index]?.glyph === icon) &&
			drawn.at(-1)?.row === 38 &&
			drawn.at(-1)?.glyph === "⚙";
		const secondColumnEmpty = [...Array(20)].every((_, index) => plain[1 + index * 2]?.[3] === " ");
		check(
			iconsOk && secondColumnEmpty,
			`taskbar ${width}: six icons plus Settings=${iconsOk} secondColumnEmpty=${secondColumnEmpty}`,
		);
	}

	// Open rails tint their icon blue; closed rails keep the muted tone.
	const rawAt = (width) => {
		tui.terminal.columns = width;
		return renderLayoutFrame(tui.layoutRoot, width, 40).lines;
	};
	const wideIcons = rawAt(140);
	check(wideIcons[1].includes(theme.fg("toolTitle", "▤")), "open Files icon is blue");
	check(wideIcons[3].includes(theme.fg("toolTitle", "◫")), "expanded Layout icon is blue");
	check(wideIcons[5].includes(theme.fg("toolTitle", "✦")), "open AI icon is blue");
	check(wideIcons[7].includes(theme.fg("muted", "⑂")), "collapsed GitHub icon stays muted");
	check(wideIcons[9].includes(theme.fg("muted", "✓")), "closed QA icon stays muted");
	check(wideIcons[11].includes(theme.fg("muted", "✎")), "closed Notes icon stays muted");
	check(wideIcons[38].includes(theme.fg("muted", "⚙")), "Settings placeholder stays muted");

	// Footer HUD: four rows, full width, border markers survive narrow widths.
	for (const width of [112, 92, 72, 60, 24, 10]) {
		const lines = footer.render(width).map((line) => stripTerminalSequences(line));
		const fits = lines.length === 4 && lines.every((line) => visibleWidth(line) <= width && visibleWidth(line) > 0);
		const exact = width < 24 || lines.every((line) => visibleWidth(line) === width);
		const framed =
			width < 24 ||
			(lines[0].startsWith("├") &&
				lines[0].endsWith("┤") &&
				lines[1].startsWith("│") &&
				lines[1].endsWith("│") &&
				lines[2].startsWith("│") &&
				lines[2].endsWith("│") &&
				lines[3].startsWith("└") &&
				lines[3].endsWith("┘"));
		check(
			fits && exact && framed,
			`footer ${width}: lines=${lines.length} widths=${lines.map((line) => visibleWidth(line)).join("/")} framed=${framed}`,
		);
	}
	const narrowTui = new FakeTUI(new AppRoot());
	narrowTui.terminal.columns = 60;
	const narrowFooter = footerFactory(narrowTui, theme, footerData);
	const narrowLines = narrowFooter.render(60).map((line) => stripTerminalSequences(line));
	check(
		narrowLines[0]?.startsWith("┌") && narrowLines[0]?.endsWith("┐"),
		`footer rails hidden: uses box corners (${narrowLines[0]?.slice(0, 1)}…${narrowLines[0]?.slice(-1)})`,
	);


	// LeftSidebarB file tree: heading, default-expanded recursion, folder clicks.
	const originalCwd = ctx1.cwd;
	const treeRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ether-tree-"));
	fs.mkdirSync(path.join(treeRoot, "src", "nested", "deep", "deeper"), { recursive: true });
	fs.writeFileSync(path.join(treeRoot, "src", "a.ts"), "");
	fs.writeFileSync(path.join(treeRoot, "src", "nested", "deep", "deeper", "deep.ts"), "");
	fs.writeFileSync(path.join(treeRoot, "src", "nested", "b.ts"), "");
	fs.writeFileSync(path.join(treeRoot, "README.md"), "");
	// Generated system/editor noise must never enter the tree.
	fs.writeFileSync(path.join(treeRoot, ".DS_Store"), "");
	fs.writeFileSync(path.join(treeRoot, "._README.md"), "");
	fs.writeFileSync(path.join(treeRoot, "debug.log"), "");
	fs.writeFileSync(path.join(treeRoot, "notes.md~"), "");
	fs.mkdirSync(path.join(treeRoot, ".pytest_cache"));
	fs.writeFileSync(path.join(treeRoot, ".pytest_cache", "state"), "");
	fs.mkdirSync(path.join(treeRoot, "node_modules"));
	fs.writeFileSync(path.join(treeRoot, "node_modules", "dep.js"), "");
	fs.mkdirSync(path.join(treeRoot, ".git"));
	fs.writeFileSync(path.join(treeRoot, ".git", "config"), "");
	// Flutter/Dart web tooling drops a whole Edge profile under .dart_tool
	// (EdgeCoupons, BudgetDatabase, Collections, discount DBs, maskable icons).
	fs.mkdirSync(path.join(treeRoot, ".dart_tool", "chrome-device", "Default", "EdgeCoupons"), { recursive: true });
	fs.mkdirSync(path.join(treeRoot, ".dart_tool", "chrome-device", "Default", "BudgetDatabase"));
	fs.mkdirSync(path.join(treeRoot, ".dart_tool", "chrome-device", "Default", "Collections"));
	fs.mkdirSync(path.join(treeRoot, ".dart_tool", "chrome-device", "Default", "discount_infos_db"));
	fs.writeFileSync(path.join(treeRoot, ".dart_tool", "chrome-device", "Default", "EdgeCoupons", "state"), "");
	fs.mkdirSync(path.join(treeRoot, ".idea"));
	fs.writeFileSync(path.join(treeRoot, ".idea", "workspace.xml"), "");
	fs.writeFileSync(path.join(treeRoot, "owniverse.iml"), "");
	fs.writeFileSync(path.join(treeRoot, ".metadata"), "");
	fs.writeFileSync(path.join(treeRoot, ".flutter-plugins-dependencies"), "{}");
	const outsideRoot = fs.mkdtempSync(path.join(os.tmpdir(), "ether-outside-"));
	fs.writeFileSync(path.join(outsideRoot, "secret.ts"), "");
	try {
		fs.symlinkSync(outsideRoot, path.join(treeRoot, "outside-link"), "dir");
	} catch {
		// symlinks may be unavailable on some platforms; the filter still stands
	}
	ctx1.cwd = treeRoot;
	const bFrame = renderLayoutFrame(tui.layoutRoot, 140, 40);
	const bRows = bFrame.lines.map((line) => stripTerminalSequences(line).slice(5, 29));
	const treeText = bRows.join("\n");
	const deepRow = bRows.find((line) => line.includes("deep.ts"));
	check(
		bRows[0].includes("Files") &&
			treeText.includes("src") &&
			treeText.includes("nested") &&
			treeText.includes("deep") &&
			treeText.includes("deeper") &&
			treeText.includes("deep.ts") &&
			treeText.includes("b.ts") &&
			treeText.includes("a.ts") &&
			treeText.includes("README.md") &&
			deepRow?.indexOf("deep.ts") === 9,
		"file tree: heading, expanded recursion, and clamped deep indent",
	);
	check(
		!treeText.includes(".DS_Store") &&
			!treeText.includes("._README.md") &&
			!treeText.includes("debug.log") &&
			!treeText.includes("notes.md~") &&
			!treeText.includes(".pytest_cache") &&
			!treeText.includes("node_modules") &&
			!treeText.includes(".git") &&
			!treeText.includes(".dart_tool") &&
			!treeText.includes("EdgeCoupons") &&
			!treeText.includes("BudgetDatabase") &&
			!treeText.includes("Collections") &&
			!treeText.includes("discount_infos_db") &&
			!treeText.includes(".idea") &&
			!treeText.includes("owniverse.iml") &&
			!treeText.includes(".metadata") &&
			!treeText.includes(".flutter-plugins-dependencies") &&
			!treeText.includes("outside-link") &&
			!treeText.includes("secret.ts"),
		"file tree: generated files and links outside the workspace are excluded",
	);
	const folderLine = bFrame.lines.find((line) => stripTerminalSequences(line).slice(5, 29).includes("src"));
	check(
		!!folderLine && folderLine.includes(theme.getFgAnsi("toolTitle")),
		"file tree: folders use the harness blue",
	);
	const filesClick = (y) => ({
		type: "click",
		button: "left",
		x: 1,
		y,
		screenX: 1,
		screenY: y,
		width: 24,
		height: 40,
		shift: false,
		alt: false,
		ctrl: false,
	});
	const filesSidebar = tui.layoutRoot.entries?.[1]?.component;
	filesSidebar.handleMouse?.({ ...filesClick(1), type: "press" });
	filesSidebar.handleMouse?.(filesClick(1));
	const treeCollapsedFrame = renderLayoutFrame(tui.layoutRoot, 140, 40);
	const collapsedRows = treeCollapsedFrame.lines.map((line) => stripTerminalSequences(line).slice(5, 29));
	check(
		collapsedRows[1].includes("▸") &&
			collapsedRows[1].includes("src") &&
			!collapsedRows.slice(2, 6).join(" ").includes("b.ts") &&
			!collapsedRows.slice(2, 6).join(" ").includes("a.ts") &&
			collapsedRows[2].includes("README.md"),
		"file tree: folder click collapses its children",
	);
	const layoutTaskbar = tui.layoutRoot.entries?.[0]?.component;
	const taskbarClick = (y) => ({ ...filesClick(y), x: 1, width: 5 });
	layoutTaskbar.handleMouse?.({ ...taskbarClick(3), type: "press" });
	layoutTaskbar.handleMouse?.(taskbarClick(3));
	const reopenedTaskbar = tui.layoutRoot.entries?.[0]?.component;
	reopenedTaskbar.handleMouse?.({ ...taskbarClick(3), type: "press" });
	reopenedTaskbar.handleMouse?.(taskbarClick(3));
	const persistedRows = renderLayoutFrame(tui.layoutRoot, 140, 40).lines.map((line) =>
		stripTerminalSequences(line).slice(5, 29),
	);
	check(
		persistedRows[1].includes("▸") &&
			persistedRows[1].includes("src") &&
			!persistedRows.slice(2, 6).join(" ").includes("b.ts"),
		"file tree: collapsed state survives layout toggle",
	);
	ctx1.cwd = originalCwd;
	fs.rmSync(treeRoot, { recursive: true, force: true });
	fs.rmSync(outsideRoot, { recursive: true, force: true });

	// Mouse action: every taskbar icon is wired; empty rows are inert.
	const clickEvent = (y) => ({
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
	});
	const taskbarOf = () => tui.layoutRoot.entries?.[0]?.component;
	const taskbar = taskbarOf();
	const filesFrame = () =>
		renderLayoutFrame(tui.layoutRoot, 140, 40).lines.map((line) => stripTerminalSequences(line).slice(5, 29));
	const filesRailVisible = () => filesFrame().some((line) => line.includes("Files") || line.includes("README.md"));
	const filesPressEntries = tui.layoutRoot.entries?.length ?? 0;
	const filesPress = taskbar.handleMouse?.({ ...clickEvent(1), type: "press" });
	const filesResult = taskbar.handleMouse?.(clickEvent(1));
	check(filesPress?.handled === true && filesResult?.handled === true, "taskbar Files row handles clicks");
	check(!filesRailVisible() && (tui.layoutRoot.entries?.length ?? 0) === filesPressEntries, "Files icon collapses the tree");
	taskbar.handleMouse?.({ ...clickEvent(1), type: "press" });
	taskbar.handleMouse?.(clickEvent(1));
	check(filesRailVisible() && (tui.layoutRoot.entries?.length ?? 0) === filesPressEntries, "Files icon restores the tree");
	const emptyPress = taskbar.handleMouse?.({ ...clickEvent(13), type: "press" });
	const emptyResult = taskbar.handleMouse?.(clickEvent(13));
	check(emptyPress === undefined && emptyResult === undefined, "empty taskbar row has no action");
	const entriesBeforeGithub = tui.layoutRoot.entries?.length ?? 0;
	const githubPress = taskbar.handleMouse?.({ ...clickEvent(7), type: "press" });
	const githubResult = taskbar.handleMouse?.(clickEvent(7));
	check(githubPress?.handled === true && githubResult?.handled === true, "taskbar GitHub row handles clicks");
	check((tui.layoutRoot.entries?.length ?? 0) === entriesBeforeGithub + 1, "GitHub icon opens its rail");
	check(rawAt(140)[7].includes(theme.fg("toolTitle", "⑂")), "opening GitHub turns its icon blue");
	taskbar.handleMouse?.({ ...clickEvent(7), type: "press" });
	taskbar.handleMouse?.(clickEvent(7));
	check((tui.layoutRoot.entries?.length ?? 0) === entriesBeforeGithub, "GitHub icon collapses its rail");
	check(rawAt(140)[7].includes(theme.fg("muted", "⑂")), "collapsing GitHub mutes its icon");
	const aiExpandedEntries = tui.layoutRoot.entries?.length ?? 0;
	const aiPress = taskbar.handleMouse?.({ ...clickEvent(5), type: "press" });
	const aiResult = taskbar.handleMouse?.(clickEvent(5));
	const aiCollapsedPlain = renderLayoutFrame(tui.layoutRoot, 140, 40).lines.map((line) => stripTerminalSequences(line));
	check(aiPress?.handled === true && aiResult?.handled === true, "taskbar AI row handles clicks");
	check(
		(tui.layoutRoot.entries?.length ?? 0) === aiExpandedEntries - 1 &&
			!aiCollapsedPlain.some((line) => line.includes("● ETHER")) &&
			aiCollapsedPlain.some((line) => line.includes("Files")),
		"AI icon collapses only the side chat",
	);
	taskbar.handleMouse?.({ ...clickEvent(5), type: "press" });
	taskbar.handleMouse?.(clickEvent(5));
	check(
		(tui.layoutRoot.entries?.length ?? 0) === aiExpandedEntries &&
			renderLayoutFrame(tui.layoutRoot, 140, 40).lines.some((line) => stripTerminalSequences(line).includes("● ETHER")),
		"AI icon restores the side chat",
	);
	taskbar.handleMouse?.({ ...clickEvent(3), type: "press" });
	taskbar.handleMouse?.(clickEvent(3));
	let entries = tui.layoutRoot.entries ?? [];
	check(entries.length === 2, `layout collapsed: ${entries.length} HStack entries (expected 2)`);
	const collapsedIcons = rawAt(140);
	check(collapsedIcons[3].includes(theme.fg("muted", "◫")), "collapsed Layout icon stays muted");
	check(collapsedIcons[1].includes(theme.fg("muted", "▤")), "Files icon mutes while rails are collapsed");
	check(collapsedIcons[5].includes(theme.fg("muted", "✦")), "AI icon mutes while rails are collapsed");
	const collapsedFrame = renderLayoutFrame(tui.layoutRoot, 140, 40);
	const collapsedTop = stripTerminalSequences(collapsedFrame.lines[0] ?? "");
	check(collapsedTop.startsWith("    │┌") && collapsedTop.endsWith("┐"), "layout collapsed: header spans full width");
	const collapsedFooterLine = stripTerminalSequences(footer.render(135)[0] ?? "");
	check(
		collapsedFooterLine.startsWith("┌") && collapsedFooterLine.endsWith("┐"),
		"layout collapsed: footer switches to box corners",
	);
	const taskbar2 = taskbarOf();
	taskbar2.handleMouse?.({ ...clickEvent(3), type: "press" });
	taskbar2.handleMouse?.(clickEvent(3));
	entries = tui.layoutRoot.entries ?? [];
	check(entries.length === 4, `layout expanded: ${entries.length} HStack entries (expected 4)`);

	// Wordmark: 38 cells, solid accent-white, same visible text.
	const artFrame = renderLayoutFrame(tui.layoutRoot, 140, 40);
	const artRaw = sliceByColumn(artFrame.lines[3], 34, 38);
	const artPlain = stripTerminalSequences(artRaw);
	const artColors = new Set(artRaw.match(/\x1b\[38;[25];[0-9;]+m/g) ?? []);
	check(visibleWidth(artPlain) === 38, `wordmark: 38 cells wide (got ${visibleWidth(artPlain)})`);
	check(artRaw.includes("\x1b[38;2;240;241;241m"), `wordmark: accent-white (${artColors.size} fg codes in slice)`);

	// Reload simulation: fresh extension runtime, stale old ctx, new model.
	const oldRoot = tui.layoutRoot;
	const fresh = await makeJiti().import(`${EXT}`, { default: true });
	newHandlers = new Map();
	fresh({ on(event, handler) { newHandlers.set(event, handler); }, registerCommand() {} });
	const ctx2 = makeCtx("deepseek-pro");
	newHandlers.get("session_start")({}, ctx2);
	widgetFactory(tui, theme);
	const before = renderLayoutFrame(oldRoot, 140, 40).lines.map((line) => stripTerminalSequences(line));
	check(before.some((line) => line.includes("deepseek-flash")), "reload: old frame keeps old model (sanity)");

	const frame2 = renderLayoutFrame(tui.layoutRoot, 140, 40);
	const text2 = frame2.lines.map((line) => stripTerminalSequences(line)).join("\n");
	check(text2.includes("deepseek-pro"), "reload: new model appears");
	check(text2.includes("ETHER") || text2.split("\n")[10].includes("app row"), "reload: wordmark or app content survives");
	const row = text2.split("\n")[10];
	const barCount = [row[4], row[28], row[140 - 40]].filter((char) => char === "│").length;
	check(barCount === 3, `reload: exactly three rail edges on a content row (found ${barCount})`);
} finally {
	handlers.get("session_shutdown")?.();
	newHandlers.get("session_shutdown")?.();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURE(S)`);
process.exitCode = failures === 0 ? 0 : 1;
