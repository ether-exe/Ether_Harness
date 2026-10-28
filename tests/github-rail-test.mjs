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

// The dedicated GitHub harness drives the fixture explicitly; env.mjs defaults to auth.
process.env.FAKE_GH_MODE = "ok";

let failures = 0;
const check = (ok, message) => {
	console.log(`${ok ? "PASS" : "FAIL"}  ${message}`);
	if (!ok) failures += 1;
};

class FakeTUI {
	terminal = { rows: 40, columns: 140 };
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
		return this.focusedComponent ?? null;
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
	render() {
		return [];
	}
	invalidate() {}
	handleInput() {}
}

const handlers = new Map();
const commands = new Map();
const shortcuts = new Map();
const notices = [];
const pi = {
	on(event, handler) {
		handlers.set(event, handler);
	},
	registerCommand(name, def) {
		commands.set(name, def);
	},
	registerShortcut(key, options) {
		shortcuts.set(key, options);
	},
};

let widgetFactory;
const ctx = {
	mode: "tui",
	model: { id: "deepseek-flash", contextWindow: 128000, reasoning: true },
	thinkingLevel: "max",
	cwd: ROOT,
	isIdle: () => true,
	getContextUsage: () => ({ tokens: 0, contextWindow: 128000, percent: 0 }),
	hasPendingMessages: () => false,
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

const findByName = (node, name) => {
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
};

const plainFrame = () => renderLayoutFrame(tui.layoutRoot, 140, 40).lines.map((line) => stripTerminalSequences(line));
const slot = (y, type = "click") => ({
	type,
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
const clickIcon = (taskbar, y) => {
	taskbar.handleMouse?.(slot(y, "press"));
	taskbar.handleMouse?.(slot(y));
};
const waitFor = async (predicate, label, timeout = 8000) => {
	const start = Date.now();
	while (Date.now() - start < timeout) {
		if (predicate()) return true;
		await new Promise((resolve) => setTimeout(resolve, 50));
	}
	check(false, `timed out waiting for ${label}`);
	return false;
};

const extension = await makeJiti().import(EXT, { default: true });
extension(pi);
handlers.get("session_start")({}, ctx);
const tui = new FakeTUI(new AppRoot());
const editor = new EditorStub();
tui.setFocus(editor);
widgetFactory(tui, theme);

try {
	const taskbar = findByName(tui.layoutRoot, "EtherSidebar");
	check(!!taskbar, "taskbar is mounted");
	const baseEntries = tui.layoutRoot.entries.length;

	// Open the rail from the taskbar icon.
	clickIcon(taskbar, 19);
	check(tui.layoutRoot.entries.length === baseEntries + 1, "GitHub icon opens the rail");
	const rail = findByName(tui.layoutRoot, "EtherGithubSidebar");
	check(!!rail, "GitHub rail component is mounted");
	await waitFor(() => rail && !rail.syncing && !!rail.snapshot, "initial GitHub sync");
	await waitFor(() => rail.readmeCache.has("octo-test/trend-one"), "feed README prefetch");

	const text = plainFrame().join("\n");
	const fullText = stripTerminalSequences(rail.sections(theme, 37).join("\n"));
	check(text.includes("◢ GITHUB"), "rail header renders");
	check(text.includes("O c t o"), "profile name renders in the card with letter spacing");
	check(text.includes("@octo-test"), "username renders");
	check(text.includes("octo-test/alpha"), "repo list renders");
	check(text.includes("Alpha demo repository"), "repo description renders");
	check(text.includes("TypeScript"), "repo language renders");
	check(fullText.includes("Feat: add the GitHub rail"), "latest commit message renders");
	check(fullText.includes("a1b2c3d"), "commit sha renders");
	check(fullText.includes("◢ CONTRIBUTIONS"), "contributions section renders");
	check(fullText.includes("TOTAL"), "contribution total renders");
	check(fullText.includes("12 MO"), "contribution total is labelled 12 MO");
	check(fullText.includes("STREAK"), "streak renders");
	check(fullText.includes("LESS"), "heatmap legend renders");
	check(fullText.includes("S M T W T F S"), "month heatmap has weekday columns");
	check(rail.snapshot?.contributions?.days?.length === 365, "365 contribution days parsed");
	check((rail.snapshot?.contributions?.monthTotal ?? -1) >= 0, "current-month total computed");
	const sectionOrder = ["◢ REPOS", "◢ CONTRIBUTIONS", "◢ ACTIVITY"].map((label) => fullText.indexOf(label));
	check(sectionOrder[0] >= 0 && sectionOrder[0] < sectionOrder[1] && sectionOrder[1] < sectionOrder[2], "sections run REPOS → CONTRIBUTIONS → ACTIVITY");

	// REPOS / ACTIVITY: ten rows by default, then a see-more control.
	const sectionRow = (section) => [...rail.sectionToggleRows.entries()].find(([, kind]) => kind === section)?.[0];
	const clickSection = (section) => {
		const row = sectionRow(section);
		check(row !== undefined, `${section} has a more control`);
		rail.scrollOffset = Math.max(0, row - 8);
		plainFrame();
		const y = row - rail.scrollOffset + 2;
		const event = (type) => ({
			type,
			button: "left",
			x: 4,
			y,
			screenX: 4,
			screenY: y,
			width: 38,
			height: 40,
			shift: false,
			alt: false,
			ctrl: false,
		});
		rail.handleMouse(event("press"));
		rail.handleMouse(event("click"));
	};

	check(!fullText.includes("octo-test/repo-12"), "repo 12 is hidden in the default ten");
	clickSection("repos");
	check(rail.reposExpanded === true, "repos toggled to expanded");
	const reposOpen = stripTerminalSequences(rail.sections(theme, 37).join("\n"));
	check(reposOpen.includes("octo-test/repo-12"), "repo list expands past ten");
	clickSection("repos");
	check(rail.reposExpanded === false, "repos toggled back to collapsed");
	const reposClosed = stripTerminalSequences(rail.sections(theme, 37).join("\n"));
	check(!reposClosed.includes("octo-test/repo-12"), "repo list collapses back to ten");

	check(!fullText.includes("Commit for octo-test/repo-12"), "activity 12 is hidden in the default ten");
	clickSection("activity");
	check(rail.activityExpanded === true, "activity toggled to expanded");
	const activityOpen = stripTerminalSequences(rail.sections(theme, 37).join("\n"));
	check(activityOpen.includes("Commit for octo-test/repo-12"), "activity expands past ten");
	clickSection("activity");
	check(rail.activityExpanded === false, "activity toggled back to collapsed");
	const activityClosed = stripTerminalSequences(rail.sections(theme, 37).join("\n"));
	check(!activityClosed.includes("Commit for octo-test/repo-12"), "activity collapses back to ten");

	// Feed: scroll to its first item, then expand and collapse a README from its icon.
	rail.handleInput("\x1b[F");
	const feedText = plainFrame().join("\n");
	check(feedText.includes("◢ FEED"), "feed section renders below activity");
	check(feedText.includes("octo-test/trend-one"), "trending repo renders");
	check(feedText.includes("★ 12k"), "trending star total renders");
	check(feedText.includes("Short readme intro for the feed."), "collapsed feed shows the short README excerpt");
	plainFrame();
	const feedRow = [...rail.feedToggleRows.entries()].find(([, index]) => index === 0)?.[0];
	check(feedRow !== undefined, "feed item has a toggle row");
	const scrollToFeed = () => {
		rail.scrollOffset = Math.max(0, feedRow - 4);
		plainFrame();
		return feedRow - rail.scrollOffset + 2;
	};
	const feedY = scrollToFeed();
	check(plainFrame()[feedY]?.slice(102).includes("⊞"), "show-more icon is on the feed row");
	const feedClick = (y, type) => ({
		type,
		button: "left",
		x: 36,
		y,
		screenX: 36,
		screenY: y,
		width: 38,
		height: 40,
		shift: false,
		alt: false,
		ctrl: false,
	});
	rail.handleMouse(feedClick(feedY, "press"));
	rail.handleMouse(feedClick(feedY, "click"));
	await waitFor(() => rail.readmeCache.has("octo-test/trend-one"), "readme fetch");
	const expandY = scrollToFeed();
	const expandedText = plainFrame().join("\n");
	check(rail.expandedFeed.has("octo-test/trend-one"), "feed item is expanded");
	check(expandedText.includes("README-MARKER"), "README expands on click");
	check(expandedText.includes("⊟"), "show-less icon appears");
	rail.handleMouse(feedClick(expandY, "press"));
	rail.handleMouse(feedClick(expandY, "click"));
	scrollToFeed();
	const collapsedText = plainFrame().join("\n");
	check(!rail.expandedFeed.has("octo-test/trend-one"), "feed item is collapsed");
	check(!collapsedText.includes("README-MARKER"), "README collapses on second click");
	check(collapsedText.includes("⊞"), "show-more icon returns");
	check(text.includes("SYNCED"), "footer shows a completed sync");
	check(plainFrame().every((line) => visibleWidth(line) === 140), "both right rails keep the frame at 140 cells");

	const bothOpen = plainFrame();
	check(bothOpen[0].slice(102).includes("◢ GITHUB"), "GitHub rail sits rightmost");
	check(bothOpen[0].slice(62, 102).includes("● ETHER"), "chat rail stays beside it at 40 cols");

	// Per-icon independence: hide chat, GitHub remains.
	clickIcon(taskbar, 17);
	check(tui.layoutRoot.entries.length === baseEntries, "AI icon hides only the chat");
	check(plainFrame().some((line) => line.includes("◢ GITHUB")), "GitHub rail survives the chat toggle");
	clickIcon(taskbar, 17);
	check(tui.layoutRoot.entries.length === baseEntries + 1, "AI icon restores the chat");
	check(plainFrame().some((line) => line.includes("● ETHER")), "chat returns beside GitHub");

	// Logged-out state.
	process.env.FAKE_GH_MODE = "auth";
	rail.handleInput("r");
	await waitFor(() => !rail.syncing && rail.errorKind === "auth", "auth failure");
	const authText = plainFrame();
	check(authText.join("\n").includes("No GitHub CLI connected"), "logged-out state shows the centered notice");
	check(authText.join("\n").includes("gh auth login"), "logged-out state explains the fix");
	const noticeRow = authText.find((line) => line.includes("No GitHub CLI connected")) ?? "";
	const noticeInRail = noticeRow.slice(102);
	const noticeBody = noticeInRail.startsWith("│") ? noticeInRail.slice(1) : noticeInRail;
	const leading = noticeBody.length - noticeBody.trimStart().length;
	check(leading > 2 && noticeBody.includes("No GitHub CLI connected"), "notice is centered inside the rail");

	// Missing binary state.
	process.env.ETHER_GH_BIN = path.join(os.tmpdir(), `ether-no-gh-${Date.now()}`);
	rail.handleInput("r");
	await waitFor(() => !rail.syncing && rail.errorKind === "missing", "missing gh");
	const missingText = plainFrame().join("\n");
	check(missingText.includes("No GitHub CLI connected"), "missing gh shows the same notice");
	check(missingText.includes("not found on PATH"), "missing gh explains the cause");

	// Close, then reopen with alt+5 and leave with esc.
	clickIcon(taskbar, 19);
	check(tui.layoutRoot.entries.length === baseEntries, "GitHub icon collapses the rail");
	shortcuts.get("alt+5")?.handler(ctx);
	await waitFor(() => tui.focusedComponent === rail, "alt+5 focus");
	check(tui.focusedComponent === rail, "alt+5 opens and focuses the GitHub rail");
	rail.handleInput("\x1b");
	check(tui.focusedComponent === editor, "esc returns focus to the editor");
	clickIcon(taskbar, 19);
	check(tui.layoutRoot.entries.length === baseEntries, "rail closes cleanly at the end");
} finally {
	handlers.get("session_shutdown")?.();
}

console.log(failures === 0 ? "ALL PASS" : `${failures} FAILED`);
process.exit(failures === 0 ? 0 : 1);
