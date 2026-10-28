/**
 * Ether chrome: animated session header, far-left taskbar, Files rail, and fixed RightsidebarA Chat.
 *
 * Pi's TUI has no sidebar/header slots, so this wraps the fullscreen layout root:
 *   HStack( LeftSidebarA , LeftSidebarB/Files , VStack( header , app root ) , RightsidebarB , RightsidebarA )
 * Files needs a wider terminal than the chat, so either rail can drop out independently.
 * The header sits above the app root and outside its ScrollView, so scrolling cannot move it.
 * Fullscreen mode only. Delete this file to get rid of everything.
 */
import {
	copyToClipboard,
	getLanguageFromPath,
	highlightCode,
	type ExtensionAPI,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { appendFileSync, existsSync, mkdirSync, closeSync, openSync, readdirSync, readFileSync, readSync, statSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";
import {
	HStack,
	Input,
	Key,
	VStack,
	matchesKey,
	mixColors,
	rgbColor,
	styleText,
	truncateToWidth,
	visibleWidth,
	wrapTextWithAnsi,
	type Component,
	type TUI,
	type TuiMouseEvent,
	type TuiMouseEventResult,
} from "@earendil-works/pi-tui";

/** LeftSidebarB width. */
const SIDEBAR_WIDTH = 24;
/** RightsidebarA's fixed width. */
const CHAT_SIDEBAR_WIDTH = 40;
/** Below this total width the chat rail is hidden so the transcript keeps >= 40 columns. */
const CHAT_MIN_TERMINAL = 85;
/** Below this total width LeftSidebarB is hidden so the transcript keeps >= 40 columns. */
const FILES_MIN_TERMINAL = 110;
/** RightsidebarA narrows by 10% while the file preview is open, giving the transcript room. */
const CHAT_SIDEBAR_COMPACT_WIDTH = 36;
/** RightsidebarB opens in the left slot: 30% wider than A, then 10% narrower. */
const PREVIEW_SIDEBAR_WIDTH = Math.round(CHAT_SIDEBAR_WIDTH * 1.3 * 0.9);
/** Below this total width the left preview cannot fit beside chat with a 40-col transcript. */
const PREVIEW_MIN_TERMINAL = 132;
const PREVIEW_MAX_BYTES = 1_000_000;
const PREVIEW_MAX_LINES = 5000;
const PREVIEW_TAB_SIZE = 4;
const PREVIEW_REFRESH_MS = 2000;
const PROSE_EXTENSIONS = new Set([".md", ".markdown", ".txt", ".rst", ".org", ".log"]);
const DRACULA = {
	comment: "#6272a4",
	keyword: "#ff79c6",
	string: "#f1fa8c",
	number: "#bd93f9",
	function: "#50fa7b",
	type: "#8be9fd",
	variable: "#f8f8f2",
	operator: "#ff79c6",
	punctuation: "#6272a4",
	text: "#f8f8f2",
	muted: "#6272a4",
	added: "#50fa7b",
	removed: "#ff5555",
} as const;
const CHAT_PLACEHOLDER = "type here…";
/** Per-message actions: copy the body, or load it into the composer as a reply. */
const CHAT_COPY_ICON = "⧉";
const CHAT_REPLY_ICON = "↳";
const CHAT_ACTION_WIDTH = 5;
/** User bubble fill: bright enough for near-white text (WCAG 5.5:1), still dark. */
const SIDE_USER_BG = rgbColor(0x24, 0x5a, 0x9c);
/** Persisted side-chat settings. Lives in global pi state, not the workspace. */
const CHAT_AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent");
const CHAT_CONFIG_PATH = process.env.ETHER_CHAT_CONFIG ?? join(CHAT_AGENT_DIR, "chat-sidebar.json");
/** Side-chat transcripts: one Markdown file per day. */
const CHAT_HISTORY_DIR = process.env.ETHER_CHAT_HISTORY_DIR ?? join(homedir(), "Ether", "chat_rightsidebarA");
/** How many restored messages are replayed into the rail and the model context. */
const CHAT_HISTORY_RESTORE_MESSAGES = 60;
/** Far-left taskbar width; reserved for icon columns. */
const LEFT_SIDEBAR_A_WIDTH = 5;
/** Keyboard-addressable rails. The taskbar is always visible; the rest follow the viewport. */
type RailKind = "taskbar" | "files" | "preview" | "chat";

/** Shared keyboard-focus coordinator so every rail enters and leaves focus the same way. */
interface RailNav {
	captureEditor(): void;
	enter(target: Component): void;
	leave(): void;
	cycle(delta: number): void;
	ensureFocusVisible(): void;
}

/** Prototype first column in LeftSidebarA; the second column is intentionally empty. */
type TaskbarAction = "layout" | "chat";

interface TaskbarIcon {
	readonly icon: string;
	readonly label: string;
	readonly action?: TaskbarAction;
}

const TASKBAR_TOP_ICONS: readonly TaskbarIcon[] = [
	{ icon: "⌂", label: "Home" },
	{ icon: "▤", label: "Files" },
	{ icon: "⌕", label: "Search" },
	{ icon: "⌁", label: "Tools" },
	{ icon: "⎇", label: "Git" },
	{ icon: "◫", label: "Layout", action: "layout" },
	{ icon: "⬡", label: "Extensions" },
	{ icon: "◷", label: "History" },
	{ icon: "✦", label: "AI", action: "chat" },
];
const TASKBAR_FOOTER_ICONS: readonly TaskbarIcon[] = [
	{ icon: "⟳", label: "Reload" },
	{ icon: "≡", label: "Menu" },
	{ icon: "?", label: "Help" },
];
/** VCS metadata is skipped whether it is a directory or a worktree pointer file. */
const FILE_TREE_SKIP_VCS = new Set([".git", ".hg", ".svn"]);
/** Heavy/generated directories skipped so the tree stays useful. */
const FILE_TREE_SKIP_DIRS = new Set([
	"node_modules",
	".cache",
	".next",
	".turbo",
	"dist",
	"build",
	"out",
	"target",
	"__pycache__",
	".pytest_cache",
	".mypy_cache",
	".ruff_cache",
	".venv",
	"venv",
	"__MACOSX",
	"$RECYCLE.BIN",
	"System Volume Information",
]);
/** OS/editor files that are generated noise rather than workspace content. */
const FILE_TREE_SKIP_FILES = new Set([
	".DS_Store",
	".localized",
	"Thumbs.db",
	"ehthumbs.db",
	"desktop.ini",
]);
const FILE_TREE_SKIP_FILE_PATTERNS: readonly RegExp[] = [
	/^\._/, // AppleDouble resource forks
	/^\.#/, // Emacs lock files
	/^#.*#$/, // Emacs autosave files
	/~$/, // editor backups
	/\.(swp|swo|swx|pyc|log|tmp)$/i,
];

/** One filter used by the Files rail and the side-chat read-only tools. */
function isTreeNoise(name: string, isDir: boolean): boolean {
	if (FILE_TREE_SKIP_VCS.has(name)) return true;
	if (isDir && FILE_TREE_SKIP_DIRS.has(name)) return true;
	if (isDir) return false;
	if (FILE_TREE_SKIP_FILES.has(name)) return true;
	return FILE_TREE_SKIP_FILE_PATTERNS.some((pattern) => pattern.test(name));
}
const FILE_TREE_MAX_DEPTH = 8;
const FILE_TREE_INDENT_STEP = 2;
const FILE_TREE_MAX_INDENT = 6;
const FILE_TREE_MAX_NODES = 500;
const FILE_TREE_REFRESH_MS = 10_000;

/** Side-chat persona: plain language first, read-only, independent of the main session. */
const CHAT_SYSTEM_PROMPT = [
	"You are Ether's side companion in the right rail of a terminal UI, in a separate thread that never touches the main session.",
	"Explain like the reader is seven years old: short sentences, concrete comparisons, and no jargon without a plain definition.",
	"You may look at the workspace when it helps, but you never edit, write, run commands, or change anything; if asked to act, say you only read and suggest what the human can do.",
	"Use list_dir, read_file, and grep_workspace to check facts instead of guessing. Cite paths relative to the workspace root.",
	"If the answer depends on anything current — versions, releases, dates, prices, documentation, news, or the present state of a tool, project, or product — call web_search first and open at least one result with fetch_url. Never invent specifics from memory. If the web cannot be reached, say so plainly instead of guessing. Name the URLs you used.",
	"Search results can be off-topic: refine the query with the exact name, organization, or a site: filter and search again. Only call fetch_url on URLs that appeared in results, never on a URL you guessed.",
	"Keep replies short enough for a narrow sidebar. Offer to go deeper instead of dumping everything at once.",
	"You cannot see the main chat transcript; ask for context or look at the files instead of guessing.",
].join(" ");

interface ChatBubble {
	role: "you" | "ether";
	text: string;
}

interface ChatRowAction {
	index: number;
	copyX: number;
	replyX: number;
}

/** Bounds for the side chat's read-only tools. Small on purpose: this is a companion, not a crawler. */
const SIDE_TOOL_LIMITS = {
	steps: 6,
	listEntries: 200,
	readLines: 2000,
	readBytes: 1_000_000,
	readDefaultLines: 400,
	grepFiles: 2000,
	grepResults: 40,
	grepBytes: 256_000,
} as const;

/** Model-facing tool declarations. Executors below are the only implementation. */
const SIDE_TOOLS = [
	{
		name: "list_dir",
		description:
			"List a folder inside the workspace. Read-only. Skips build and dependency folders. Use it to see what exists before reading files.",
		parameters: Type.Object({
			path: Type.Optional(Type.String({ description: "Folder relative to the workspace root; defaults to the root." })),
			depth: Type.Optional(Type.Number({ description: "Levels to list, 1-3. Default 2." })),
		}),
	},
	{
		name: "read_file",
		description:
			"Read a text file inside the workspace with line numbers. Read-only. For long files, read a range with start and end.",
		parameters: Type.Object({
			path: Type.String({ description: "File path relative to the workspace root." }),
			start: Type.Optional(Type.Number({ description: "First line, 1-based. Default 1." })),
			end: Type.Optional(Type.Number({ description: "Last line, inclusive. Defaults to start + 399." })),
		}),
	},
	{
		name: "grep_workspace",
		description:
			"Search workspace file contents with a regular expression. Read-only. Returns file:line:text hits.",
		parameters: Type.Object({
			pattern: Type.String({ description: "Regular expression, case-insensitive." }),
			glob: Type.Optional(Type.String({ description: "Optional filter such as *.ts or a path fragment." })),
		}),
	},
	{
		name: "web_search",
		description:
			"Search the web and return titles, URLs, and snippets. Use it whenever the answer depends on current facts: versions, releases, dates, prices, docs, news, or the present state of anything. Never invent those specifics. If the results are off-topic, refine the query (exact product/org name, site: filter) and search again; do not fetch guessed URLs.",
		parameters: Type.Object({
			query: Type.String({ description: "Search query." }),
			count: Type.Optional(Type.Number({ description: "Results to return, 1-8. Default 6." })),
		}),
	},
	{
		name: "fetch_url",
		description:
			"Read a web page as text. Use it to verify a search result instead of trusting its snippet.",
		parameters: Type.Object({
			url: Type.String({ description: "Absolute http(s) URL." }),
			maxChars: Type.Optional(Type.Number({ description: "Text cap, default 12000." })),
		}),
	},
	{
		name: "read_history",
		description:
			"Read saved side-chat transcripts from earlier days, or list the days that exist. Use it when the human asks what you discussed before; the current day is already in context.",
		parameters: Type.Object({
			date: Type.Optional(Type.String({ description: "Day to read as YYYY-MM-DD. Omit to list available days." })),
		}),
	},
] as const;

interface SideToolOutcome {
	text: string;
	isError: boolean;
	/** Resolved path to show in the masthead when the tool looked at something. */
	path?: string;
}

interface ChatToolCallLike {
	id: string;
	name: string;
	arguments: Record<string, unknown>;
}

/** Resolve a model-supplied path and refuse anything outside the workspace. */
function workspacePath(root: string, target: string): { abs: string } | { error: string } {
	const abs = resolve(root, target || ".");
	const rel = relative(root, abs);
	if (rel.startsWith("..") || isAbsolute(rel)) return { error: "path is outside the workspace" };
	return { abs };
}

function sortedEntries(dir: string) {
	try {
		return readdirSync(dir, { withFileTypes: true })
			.filter((entry) => !isTreeNoise(entry.name, entry.isDirectory()))
			.sort((a, b) => Number(b.isDirectory()) - Number(a.isDirectory()) || a.name.localeCompare(b.name));
	} catch {
		return [];
	}
}

function runListDir(root: string, args: Record<string, unknown>): SideToolOutcome {
	const requested = typeof args.path === "string" && args.path.trim() ? args.path.trim() : ".";
	const resolved = workspacePath(root, requested);
	if ("error" in resolved) return { text: resolved.error, isError: true };
	try {
		if (!statSync(resolved.abs).isDirectory()) return { text: "not a directory", isError: true };
	} catch {
		return { text: "folder not found", isError: true };
	}

	const depth = Math.max(1, Math.min(3, Math.trunc(Number(args.depth) || 2)));
	const lines: string[] = [];
	let count = 0;
	let truncated = false;
	const walk = (dir: string, level: number, indent: string) => {
		for (const entry of sortedEntries(dir)) {
			if (count >= SIDE_TOOL_LIMITS.listEntries) {
				truncated = true;
				return;
			}
			count += 1;
			lines.push(`${indent}${entry.name}${entry.isDirectory() ? "/" : ""}`);
			if (entry.isDirectory() && level < depth) walk(join(dir, entry.name), level + 1, `${indent}  `);
		}
	};
	walk(resolved.abs, 1, "");
	const body = lines.length > 0 ? lines.join("\n") : "empty folder";
	const note = truncated ? `\n… stopped at ${SIDE_TOOL_LIMITS.listEntries} entries` : "";
	return { text: body + note, isError: false, path: resolved.abs };
}

function runReadFile(root: string, args: Record<string, unknown>): SideToolOutcome {
	const target = typeof args.path === "string" ? args.path.trim() : "";
	if (!target) return { text: "path is required", isError: true };
	const resolved = workspacePath(root, target);
	if ("error" in resolved) return { text: resolved.error, isError: true };

	let size = 0;
	try {
		const stat = statSync(resolved.abs);
		if (!stat.isFile()) return { text: "not a file", isError: true };
		size = stat.size;
	} catch {
		return { text: "file not found", isError: true };
	}
	if (size > SIDE_TOOL_LIMITS.readBytes) {
		return { text: `file is too large (${Math.round(size / 1000)} KB); use grep_workspace`, isError: true, path: dirname(resolved.abs) };
	}

	try {
		const raw = readFileSync(resolved.abs);
		if (raw.subarray(0, 8192).includes(0)) return { text: "binary file", isError: true, path: dirname(resolved.abs) };
		const lines = raw.toString("utf8").replace(/\r\n?/g, "\n").split("\n");
		const start = Math.max(1, Math.trunc(Number(args.start) || 1));
		const requestedEnd = Number(args.end) > 0 ? Math.trunc(Number(args.end)) : start + SIDE_TOOL_LIMITS.readDefaultLines - 1;
		const end = Math.max(start, Math.min(lines.length, requestedEnd, start + SIDE_TOOL_LIMITS.readLines - 1));
		const width = String(end).length;
		const body = lines.slice(start - 1, end).map((line, index) => {
			const clipped = line.length > 400 ? `${line.slice(0, 400)}…` : line;
			return `${String(start + index).padStart(width, " ")} │ ${clipped}`;
		});
		const note = end < lines.length ? `\n… ${lines.length - end} more lines; call read_file with start=${end + 1}` : "";
		return { text: body.join("\n") + note, isError: false, path: dirname(resolved.abs) };
	} catch (error) {
		return { text: error instanceof Error ? error.message : "cannot read file", isError: true, path: dirname(resolved.abs) };
	}
}

function runGrepWorkspace(root: string, args: Record<string, unknown>): SideToolOutcome {
	const pattern = typeof args.pattern === "string" ? args.pattern : "";
	if (!pattern) return { text: "pattern is required", isError: true };
	let regex: RegExp;
	try {
		regex = new RegExp(pattern, "i");
	} catch {
		regex = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i");
	}
	const glob = typeof args.glob === "string" ? args.glob.trim() : "";
	const suffix = glob.includes("*") ? glob.replace(/^\*+/, "") : "";
	const hits: string[] = [];
	let files = 0;
	let truncated = false;

	const walk = (dir: string) => {
		for (const entry of sortedEntries(dir)) {
			if (truncated) return;
			const abs = join(dir, entry.name);
			if (entry.isDirectory()) {
				walk(abs);
				continue;
			}
			const rel = relative(root, abs).replace(/\\/g, "/");
			if (glob && (suffix ? !entry.name.endsWith(suffix) : !rel.includes(glob))) continue;
			if (files >= SIDE_TOOL_LIMITS.grepFiles) {
				truncated = true;
				return;
			}
			files += 1;
			try {
				const stat = statSync(abs);
				if (!stat.isFile() || stat.size > SIDE_TOOL_LIMITS.grepBytes) continue;
				const raw = readFileSync(abs);
				if (raw.subarray(0, 1024).includes(0)) continue;
				const lines = raw.toString("utf8").replace(/\r\n?/g, "\n").split("\n");
				for (let index = 0; index < lines.length; index++) {
					if (!regex.test(lines[index])) continue;
					hits.push(`${rel}:${index + 1}: ${lines[index].trim().slice(0, 200)}`);
					if (hits.length >= SIDE_TOOL_LIMITS.grepResults) {
						truncated = true;
						return;
					}
				}
			} catch {
				// unreadable file: skip it
			}
		}
	};
	walk(root);

	const head = hits.length > 0 ? hits.join("\n") : "no matches";
	const note = truncated
		? `\n… stopped after ${SIDE_TOOL_LIMITS.grepResults} hits / ${SIDE_TOOL_LIMITS.grepFiles} files`
		: `\n${files} files scanned`;
	return { text: head + note, isError: false };
}

interface FileNode {
	readonly name: string;
	readonly path: string;
	readonly isDir: boolean;
	children?: FileNode[];
}

function readFileTree(dir: string, depth = 0, budget = { remaining: FILE_TREE_MAX_NODES }): FileNode[] {
	if (depth > FILE_TREE_MAX_DEPTH || budget.remaining <= 0) return [];
	let entries;
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return [];
	}
	const nodes: FileNode[] = [];
	for (const entry of entries) {
		if (budget.remaining <= 0) break;
		if (entry.isSymbolicLink()) continue;
		const isDir = entry.isDirectory();
		if (isTreeNoise(entry.name, isDir)) continue;
		const node: FileNode = { name: entry.name, path: join(dir, entry.name), isDir };
		budget.remaining -= 1;
		if (isDir) node.children = readFileTree(node.path, depth + 1, budget);
		nodes.push(node);
	}
	nodes.sort((a, b) => (a.isDir === b.isDir ? a.name.localeCompare(b.name) : a.isDir ? -1 : 1));
	return nodes;
}
const HEADER_ROWS = 7;
/** Blank cells between the header content and its border. */
const HEADER_PAD_X = 2;
const HEADER_PAD_Y = 1;
/** Isometra 400 (faux-bolded) rasterised to 76x12 dots, packed as 38x3 braille cells. */
const ETHER_ART: readonly string[] = [
	"⢻⣿⣿⠿⠿⡿⠃⠹⣿⣿⣿⣿⣿⣿⡿⠙⣿⣿⡏⠀⣿⣿⡟⠘⣿⣿⡿⠿⢿⠟⠈⢿⣿⣿⣿⣿⣷⡀",
	"⢸⣿⣿⣿⡿⠀⠀⠀⠉⠀⣿⣿⡇⠈⠀⠀⣿⣿⣷⣶⣿⣿⡇⠀⣿⣿⣿⣿⠇⠀⠀⢸⣿⣿⣼⣿⡿⠁",
	"⣼⣿⣿⣿⣿⣿⣦⠀⠀⢠⣿⣿⣇⠀⠀⢠⣿⣿⣇⠀⣿⣿⣧⢠⣿⣿⣿⣿⣿⣷⣀⣾⣿⣿⢻⣿⣷⣄",
];
const HEADING = "Ether";
const SEPARATOR = " · ";
/* ------------------------------------------------------------------- web */

const WEB_UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const WEB_TIMEOUT_MS = 15_000;
const WEB_SEARCH_MAX_CHARS = 8_000;
const WEB_FETCH_MAX_CHARS = 12_000;
const WEB_FETCH_HARD_MAX = 30_000;

function webEntities(input: string): string {
	const named: Record<string, string> = {
		amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ", mdash: "—", ndash: "–",
		hellip: "…", rsquo: "’", lsquo: "‘", ldquo: "“", rdquo: "”",
	};
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&([a-z]+;?)/gi, (match, name: string) => named[name] ?? named[name.replace(/;$/, "")] ?? match);
}

function webClean(input: string): string {
	return webEntities(input.replace(/<[^>]*>/g, " "))
		.replace(/[ \t\u00a0]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
}

function webHtmlToText(html: string): string {
	const stripped = html
		.replace(/<script[\s\S]*?<\/script>/gi, " ")
		.replace(/<style[\s\S]*?<\/style>/gi, " ")
		.replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
		.replace(/<svg[\s\S]*?<\/svg>/gi, " ")
		.replace(/<!--[\s\S]*?-->/g, " ");
	const withBreaks = stripped
		.replace(/<(?:br|hr)\s*\/?>/gi, "\n")
		.replace(/<li[^>]*>/gi, "\n• ")
		.replace(/<\/(?:p|div|li|h[1-6]|tr|section|article|header|footer|blockquote|pre|table|ul|ol|nav|main)>/gi, "\n")
		.replace(/<[^>]+>/g, " ");
	return webClean(withBreaks).replace(/[ ]*\n[ ]*/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function webGet(url: string): Promise<{ body: string; contentType: string; finalUrl: string }> {
	const response = await fetch(url, {
		signal: AbortSignal.timeout(WEB_TIMEOUT_MS),
		redirect: "follow",
		headers: {
			"user-agent": WEB_UA,
			accept: "text/html,application/xhtml+xml,application/json,text/plain;q=0.9,*/*;q=0.8",
			"accept-language": "en-US,en;q=0.9",
		},
	});
	if (!response.ok) throw new Error(`HTTP ${response.status} ${response.statusText}`);
	return {
		body: await response.text(),
		contentType: response.headers.get("content-type") ?? "",
		finalUrl: response.url,
	};
}

function webClip(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n\n[… truncated ${text.length - max} characters]`;
}

interface WebHit {
	title: string;
	url: string;
	snippet: string;
}

async function webSearch(query: string, count: number): Promise<WebHit[]> {
	const errors: string[] = [];
	// DuckDuckGo has the best tech relevance here, but it rate-limits with a 202 challenge.
	try {
		const hits = await searchDuckDuckGo(query, count);
		if (hits.length > 0) return hits;
		errors.push("duckduckgo: no results");
	} catch (error) {
		errors.push(`duckduckgo: ${error instanceof Error ? error.message : String(error)}`);
	}
	// Bing RSS is plain XML and stays reachable when the HTML page degrades.
	try {
		const hits = await searchBingRss(query, count);
		if (hits.length > 0) return hits;
		errors.push("bing: no relevant results");
	} catch (error) {
		errors.push(`bing: ${error instanceof Error ? error.message : String(error)}`);
	}
	throw new Error(errors.join("; "));
}

function decodeDdgTarget(href: string): string {
	try {
		const url = new URL(href, "https://duckduckgo.com");
		const target = url.searchParams.get("uddg");
		if (target) return decodeURIComponent(target);
		if (/^https?:/i.test(href)) return href;
		if (href.startsWith("//")) return `https:${href}`;
	} catch {
		// fall through
	}
	return href;
}

async function searchDuckDuckGo(query: string, count: number): Promise<WebHit[]> {
	const { body } = await webGet(`https://html.duckduckgo.com/html/?q=${encodeURIComponent(query)}`);
	if (/anomaly|captcha|challenge/i.test(body.slice(0, 4000)) && !body.includes("result__a")) {
		throw new Error("rate limited");
	}
	const hits: WebHit[] = [];
	for (const block of body.split('<div class="result ').slice(1)) {
		if (block.includes("result--ad")) continue;
		const anchor = /<a\b[^>]*class="[^"]*result__a[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block);
		if (!anchor) continue;
		const href = decodeDdgTarget(/href="([^"]+)"/.exec(anchor[0])?.[1] ?? "");
		const title = webClean(anchor[1]);
		const snippet = webClean(/class="[^"]*result__snippet[^"]*"[^>]*>([\s\S]*?)<\/a>/.exec(block)?.[1] ?? "");
		if (title && /^https?:\/\//i.test(href)) hits.push({ title, url: href, snippet });
		if (hits.length >= count) break;
	}
	return hits;
}

async function searchBingRss(query: string, count: number): Promise<WebHit[]> {
	const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&format=rss&setlang=en&count=${Math.min(8, Math.max(1, count))}`;
	const { body } = await webGet(url);
	const hits: WebHit[] = [];
	for (const item of body.matchAll(/<item>([\s\S]*?)<\/item>/g)) {
		const title = webClean(/<title>([\s\S]*?)<\/title>/.exec(item[1])?.[1] ?? "");
		const link = webEntities(/<link>([\s\S]*?)<\/link>/.exec(item[1])?.[1] ?? "").trim();
		const snippet = webClean(/<description>([\s\S]*?)<\/description>/.exec(item[1])?.[1] ?? "");
		if (title && /^https?:\/\//i.test(link)) hits.push({ title, url: link, snippet });
		if (hits.length >= count) break;
	}
	// Bing pads empty queries with trending noise; require a query word in the hit text.
	const tokens = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2))];
	if (tokens.length === 0) return hits;
	return hits.filter((hit) => {
		const haystack = `${hit.title} ${hit.snippet} ${hit.url}`.toLowerCase();
		return tokens.some((token) => haystack.includes(token));
	});
}

async function runWebSearch(args: Record<string, unknown>): Promise<SideToolOutcome> {
	const query = typeof args.query === "string" ? args.query.trim() : "";
	if (!query) return { text: "query is required", isError: true };
	const count = Math.max(1, Math.min(8, Math.trunc(Number(args.count) || 6)));
	try {
		const hits = await webSearch(query, count);
		if (hits.length === 0) return { text: `no results for "${query}" (rate-limited or markup changed)`, isError: true };
		const text = hits
			.map((hit, index) => `${index + 1}. ${hit.title}\n   ${hit.url}${hit.snippet ? `\n   ${hit.snippet}` : ""}`)
			.join("\n\n");
		return { text: webClip(text, WEB_SEARCH_MAX_CHARS), isError: false };
	} catch (error) {
		return { text: `search failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
	}
}

async function runFetchUrl(args: Record<string, unknown>): Promise<SideToolOutcome> {
	const raw = typeof args.url === "string" ? args.url.trim() : "";
	if (!raw) return { text: "url is required", isError: true };
	let parsed: URL;
	try {
		parsed = new URL(raw);
	} catch {
		return { text: `invalid URL: ${raw}`, isError: true };
	}
	if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
		return { text: `unsupported protocol: ${parsed.protocol}`, isError: true };
	}
	const maxChars = Math.max(500, Math.min(WEB_FETCH_HARD_MAX, Math.trunc(Number(args.maxChars) || WEB_FETCH_MAX_CHARS)));
	try {
		const { body, contentType, finalUrl } = await webGet(parsed.toString());
		const textual = /json|text|xml|javascript/i.test(contentType) || contentType === "";
		if (!textual) return { text: `${finalUrl}\n[${contentType}] not a text document`, isError: false };
		const text = /json/i.test(contentType) ? body : webHtmlToText(body);
		return { text: webClip(`${finalUrl}\n\n${text}`, maxChars), isError: false };
	} catch (error) {
		return { text: `fetch failed: ${error instanceof Error ? error.message : String(error)}`, isError: true };
	}
}

const TICK_MS = 150;
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const BAR_CELLS = 6;

type RailSide = "left" | "right";

interface ThemeLike {
	bg(token: string, text: string): string;
	fg(token: string, text: string): string;
	style(text: string, options: { fg?: unknown; bg?: unknown; bold?: boolean; dim?: boolean }): string;
	getFgAnsi?(token: string): string;
	getColorMode?(): "truecolor" | "256color";
	colors?: Record<string, unknown>;
}

/* -------------------------------------------------------------- formatting */

export function formatTokens(count: number): string {
	if (count < 1000) return count.toString();
	if (count < 10000) return `${(count / 1000).toFixed(1)}k`;
	if (count < 1000000) return `${Math.round(count / 1000)}k`;
	if (count < 10000000) return `${(count / 1000000).toFixed(1)}M`;
	return `${Math.round(count / 1000000)}M`;
}

/** Extra precision for sub-cent spend, so a session does not look free at $0.000. */
export function formatCost(cost: number): string {
	if (!Number.isFinite(cost) || cost <= 0) return "$0.000";
	if (cost < 0.01) return `$${cost.toFixed(4)}`;
	return `$${cost.toFixed(3)}`;
}

export function formatDuration(ms: number): string {
	const total = Math.max(0, Math.floor(ms / 1000));
	if (total < 60) return `${total}s`;
	const minutes = Math.floor(total / 60);
	if (minutes < 60) return `${minutes}m${String(total % 60).padStart(2, "0")}s`;
	return `${Math.floor(minutes / 60)}h${String(minutes % 60).padStart(2, "0")}m`;
}

function shortenPath(path: string, max = 20): string {
	const home = process.env.HOME || process.env.USERPROFILE;
	let out = path;
	if (home && path.startsWith(home)) out = `~${path.slice(home.length)}`;
	if (visibleWidth(out) <= max) return out;
	const tail = out.slice(Math.max(0, out.length - (max - 1)));
	return `…${tail}`;
}

/* ------------------------------------------------------------------ stats */

interface Totals {
	input: number;
	output: number;
	cacheRead: number;
	cacheWrite: number;
	cost: number;
}

interface SessionStats {
	totals: Totals;
	messages: number;
	tools: number;
	cacheHit?: number;
}

function createTotals(): Totals {
	return { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, cost: 0 };
}

function addUsage(totals: Totals, usage: unknown): void {
	const u = usage as { input?: number; output?: number; cacheRead?: number; cacheWrite?: number; cost?: { total?: number } };
	if (!u) return;
	totals.input += u.input ?? 0;
	totals.output += u.output ?? 0;
	totals.cacheRead += u.cacheRead ?? 0;
	totals.cacheWrite += u.cacheWrite ?? 0;
	totals.cost += u.cost?.total ?? 0;
}

/** Cumulative usage, message/tool counts, and the latest cache-hit rate. */
function computeStats(entries: readonly unknown[]): SessionStats {
	const totals = createTotals();
	let messages = 0;
	let tools = 0;
	let cacheHit: number | undefined;
	for (const raw of entries) {
		const entry = raw as { type?: string; usage?: unknown; message?: { role?: string; usage?: unknown } };
		if (entry.type === "usage") addUsage(totals, entry.usage);
		else if (entry.type === "message") {
			const role = entry.message?.role;
			if (role === "assistant") {
				messages += 1;
				addUsage(totals, entry.message?.usage);
				const u = entry.message?.usage as
					| { input?: number; cacheRead?: number; cacheWrite?: number }
					| undefined;
				if (u) {
					const prompt = (u.input ?? 0) + (u.cacheRead ?? 0) + (u.cacheWrite ?? 0);
					cacheHit = prompt > 0 ? ((u.cacheRead ?? 0) / prompt) * 100 : undefined;
				}
			} else if (role === "user") messages += 1;
			else if (role === "toolResult") {
				tools += 1;
				addUsage(totals, entry.message?.usage);
			}
		} else if ((entry.type === "branch_summary" || entry.type === "compaction") && entry.usage) {
			addUsage(totals, entry.usage);
		}
	}
	return { totals, messages, tools, cacheHit };
}

let statsCache: { key: string; stats: SessionStats } | undefined;

function readStats(ctx: ExtensionContextLike): SessionStats {
	let key = "";
	try {
		const sm = ctx.sessionManager;
		key = `${sm.getSessionId()}:${sm.getEntryCount()}:${sm.getLeafId()}`;
	} catch {
		key = "";
	}
	if (statsCache && statsCache.key === key && key !== "") return statsCache.stats;
	const stats = computeStats(ctx.sessionManager.getEntries());
	statsCache = { key, stats };
	return stats;
}

interface ExtensionContextLike {
	model?: { id?: string; provider?: string; contextWindow?: number; reasoning?: boolean };
	thinkingLevel?: string;
	cwd?: string;
	modelRegistry?: {
		find(provider: string, id: string): ChatModelLike | undefined;
		streamSimple(
			model: ChatModelLike,
			context: { systemPrompt: string; messages: unknown[] },
			options?: { signal?: AbortSignal; reasoning?: "minimal" | "low" | "medium" | "high" | "xhigh" | "max" },
		): ChatStreamLike;
	};
	getContextUsage?(): { tokens: number | null; contextWindow: number; percent: number | null } | undefined;
	isIdle?(): boolean;
	hasPendingMessages?(): boolean;
	sessionManager: {
		getEntries(): readonly unknown[];
		getSessionId(): string;
		getEntryCount(): number;
		getLeafId(): string | null;
		getSessionName(): string | undefined;
	};
	ui?: {
		theme?: ThemeLike;
		setFooter?(factory: undefined): void;
		setStatus?(key: string, text: string | undefined): void;
		notify?(message: string, type?: "info" | "warning" | "error"): void;
	};
}

/* --------------------------------------------------------------- animation */

let tick = 0;
let startedAt = Date.now();

/** Same blue as the tool text, used sparingly on header identity/cost. */
const TOOL_BLUE = rgbColor(0x3a, 0x7b, 0xcb);

function toolBlueText(theme: ThemeLike, text: string): string {
	return theme.style(text, { fg: TOOL_BLUE });
}

/** Busy spinner while the agent works, otherwise a slow breathing dot. */
function activityGlyph(theme: ThemeLike, busy: boolean): string {
	if (busy) return theme.fg("accent", SPINNER[tick % SPINNER.length]);
	const phase = (Math.sin((tick * TICK_MS) / 260) + 1) / 2; // ~1.6s breath
	try {
		const from = theme.colors?.borderMuted;
		const to = theme.colors?.success;
		if (from && to) return theme.style("●", { fg: mixColors(from, to, 0.25 + phase * 0.75) });
	} catch {
		// fall through to plain token
	}
	return theme.fg(phase > 0.6 ? "success" : "dim", "●");
}

function contextBar(theme: ThemeLike, percent: number): string {
	const filled = Math.max(0, Math.min(BAR_CELLS, Math.round((percent / 100) * BAR_CELLS)));
	const tone = percent > 90 ? "error" : percent > 70 ? "warning" : "success";
	return theme.fg(tone, "▰".repeat(filled)) + theme.fg("dim", "▱".repeat(BAR_CELLS - filled));
}

/* --------------------------------------------------------------- components */

/** Zero-height component so the boot widget occupies no rows. */
class Empty implements Component {
	render(): string[] {
		return [];
	}
	invalidate(): void {
		// no cache
	}
}

/** Sticky status header: bold ETHER wordmark on the left, live metrics on the right. */
class EtherHeader implements Component {
	private readonly getCtx: () => ExtensionContextLike | undefined;
	private readonly getTheme: () => ThemeLike;

	constructor(getCtx: () => ExtensionContextLike | undefined, getTheme: () => ThemeLike) {
		this.getCtx = getCtx;
		this.getTheme = getTheme;
	}

	invalidate(): void {
		// no cache: metrics and animation are read every render
	}

	render(width: number): string[] {
		const theme = this.getTheme();
		const w = Math.max(2, width);
		const inner = Math.max(0, w - 2);
		const content = Math.max(0, inner - HEADER_PAD_X * 2);
		const border = (text: string) => theme.fg("borderMuted", text);

		const blank = " ".repeat(content);
		const glyphRow = Math.floor(ETHER_ART.length / 2);
		let rows: string[] = ETHER_ART.map(() => blank);
		try {
			const busy = this.isBusy();
			const glyph = activityGlyph(theme, busy);
			const art = ETHER_ART.map((line) => theme.fg("accent", line));
			rows = ETHER_ART.map((_, index) => {
				const label = index === glyphRow ? `${glyph} ${art[index]}` : `  ${art[index]}`;
				const metrics =
					index === 0 ? this.rowOne(theme, busy) : index === ETHER_ART.length - 1 ? this.rowTwo(theme, busy) : [];
				return this.compose(theme, label, metrics, content);
			});
		} catch {
			// Degrade to the plain bold wordmark rather than an empty bar.
			let fallback = HEADING;
			try {
				fallback = theme.style(HEADING, { fg: "accent", bold: true });
			} catch {
				// keep the raw text
			}
			rows = ETHER_ART.map((_, index) => this.compose(theme, index === glyphRow ? fallback : "", [], content));
		}

		const frame = (body: string) =>
			border("│") + " ".repeat(HEADER_PAD_X) + body + " ".repeat(HEADER_PAD_X) + border("│");
		const spacer = frame(blank);
		return [
			border(`┌${"─".repeat(inner)}┐`),
			...Array.from({ length: HEADER_PAD_Y }, () => spacer),
			...rows.map(frame),
			...Array.from({ length: HEADER_PAD_Y }, () => spacer),
			border(`└${"─".repeat(inner)}┘`),
		];
	}

	private isBusy(): boolean {
		const ctx = this.getCtx();
		if (!ctx) return false;
		try {
			return ctx.isIdle ? !ctx.isIdle() : false;
		} catch {
			return false;
		}
	}

	private rowOne(theme: ThemeLike, busy: boolean): string[] {
		const ctx = this.getCtx();
		if (!ctx) return [];
		const parts: string[] = [];
		const model = ctx.model;

		if (model?.id) parts.push(toolBlueText(theme, model.id));

		const usage = ctx.getContextUsage?.();
		if (usage && usage.percent !== null && usage.percent !== undefined) {
			const window = usage.contextWindow || model?.contextWindow || 0;
			parts.push(
				`${contextBar(theme, usage.percent)} ${theme.fg("dim", `${usage.percent.toFixed(1)}%/${formatTokens(window)}`)}`,
			);
		} else if (model?.contextWindow) {
			parts.push(theme.fg("dim", `?/${formatTokens(model.contextWindow)}`));
		}

		const stats = readStats(ctx);
		parts.push(toolBlueText(theme, formatCost(stats.totals.cost)));
		if (stats.totals.input || stats.totals.output) {
			parts.push(theme.fg("dim", `↑${formatTokens(stats.totals.input)} ↓${formatTokens(stats.totals.output)}`));
		}

		if (model?.reasoning && ctx.thinkingLevel) {
			parts.push(theme.fg("dim", busy ? `${ctx.thinkingLevel}…` : ctx.thinkingLevel));
		}

		return parts;
	}

	private rowTwo(theme: ThemeLike, busy: boolean): string[] {
		const ctx = this.getCtx();
		if (!ctx) return [];
		const stats = readStats(ctx);
		const parts: string[] = [];

		// agent state, with animated dots while working
		if (busy) parts.push(theme.fg("accent", `working${".".repeat(1 + (tick % 3))}`));
		else parts.push(theme.fg("dim", "idle"));
		try {
			const queued = ctx.hasPendingMessages?.() ? 1 : 0;
			if (queued) parts.push(theme.fg("warning", "queued"));
		} catch {
			// ignore
		}

		try {
			const name = ctx.sessionManager.getSessionName();
			if (name) parts.push(theme.fg("muted", name));
		} catch {
			// ignore
		}

		if (stats.cacheHit !== undefined && (stats.totals.cacheRead > 0 || stats.totals.cacheWrite > 0)) {
			parts.push(theme.fg("dim", `CH ${stats.cacheHit.toFixed(0)}%`));
		}
		if (stats.messages) parts.push(theme.fg("dim", `${stats.messages} msg`));
		if (stats.tools) parts.push(theme.fg("dim", `${stats.tools} tool`));
		parts.push(theme.fg("dim", `up ${formatDuration(Date.now() - startedAt)}`));

		if (ctx.cwd) parts.push(theme.fg("dim", shortenPath(ctx.cwd)));

		try {
			const id = ctx.sessionManager.getSessionId();
			if (id) parts.push(theme.fg("dim", `#${String(id).slice(0, 8)}`));
		} catch {
			// ignore
		}

		return parts;
	}

	/** Left label, right-aligned parts, dropping whole parts from the right before clipping one. */
	private compose(theme: ThemeLike, left: string, parts: string[], width: number): string {
		let label = left;
		if (visibleWidth(label) > width) label = truncateToWidth(label, width, "");
		const separator = theme.fg("dim", SEPARATOR);
		let metrics = parts.join(separator);
		while (parts.length > 1 && visibleWidth(label) + 2 + visibleWidth(metrics) > width) {
			parts.pop();
			metrics = parts.join(separator);
		}
		if (visibleWidth(label) + 2 + visibleWidth(metrics) > width) {
			metrics = truncateToWidth(metrics, Math.max(0, width - visibleWidth(label) - 2), "");
		}
		const gap = Math.max(0, width - visibleWidth(label) - visibleWidth(metrics));
		return label + " ".repeat(gap) + metrics;
	}
}

/** Full-height empty rail, used for the LeftSidebarA taskbar. */
class EtherSidebar implements Component {
	private readonly tui: TUI;
	private readonly getTheme: () => ThemeLike;
	private readonly side: RailSide;
	private readonly taskbar: boolean;
	private readonly onAction?: (action: TaskbarAction) => void;
	private readonly nav: RailNav;
	private readonly onInert?: (item: TaskbarIcon) => void;
	focused = false;
	private selectedIcon = "◫";

	constructor(
		tui: TUI,
		getTheme: () => ThemeLike,
		side: RailSide,
		nav: RailNav,
		taskbar = false,
		onAction?: (action: TaskbarAction) => void,
		onInert?: (item: TaskbarIcon) => void,
	) {
		this.tui = tui;
		this.getTheme = getTheme;
		this.side = side;
		this.nav = nav;
		this.taskbar = taskbar;
		this.onAction = onAction;
		this.onInert = onInert;
	}

	invalidate(): void {
		// no cache: height and theme are read every render
	}

	private rowLayout(rows: number): Map<number, TaskbarIcon> {
		const out = new Map<number, TaskbarIcon>();
		if (!this.taskbar) return out;
		const footerStart = rows - 2 - (TASKBAR_FOOTER_ICONS.length - 1) * 2;
		TASKBAR_TOP_ICONS.forEach((item, index) => {
			const row = 1 + index * 2;
			if (row <= footerStart - 2) out.set(row, item);
		});
		TASKBAR_FOOTER_ICONS.forEach((item, index) => {
			const row = footerStart + index * 2;
			if (row >= 1 && row < rows) out.set(row, item);
		});
		return out;
	}

	/** Icons in visual top-to-bottom order; the same set the mouse handler sees. */
	private items(rows: number): Array<{ row: number; item: TaskbarIcon }> {
		return [...this.rowLayout(rows).entries()]
			.map(([row, item]) => ({ row, item }))
			.sort((a, b) => a.row - b.row);
	}

	private selectedIndex(items: Array<{ item: TaskbarIcon }>): number {
		const found = items.findIndex((entry) => entry.item.icon === this.selectedIcon);
		return found >= 0 ? found : Math.min(5, Math.max(0, items.length - 1));
	}

	private select(index: number, items: Array<{ item: TaskbarIcon }>): void {
		const item = items[Math.max(0, Math.min(items.length - 1, index))];
		if (!item) return;
		this.selectedIcon = item.item.icon;
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (!this.taskbar) return;
		if (matchesKey(data, "tab")) {
			this.nav.cycle(1);
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.nav.cycle(-1);
			return;
		}
		if (matchesKey(data, "escape")) {
			this.nav.leave();
			return;
		}
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const items = this.items(rows);
		if (items.length === 0) return;
		const index = this.selectedIndex(items);
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.select(index - 1, items);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.select(index + 1, items);
			return;
		}
		if (matchesKey(data, "home")) {
			this.select(0, items);
			return;
		}
		if (matchesKey(data, "end")) {
			this.select(items.length - 1, items);
			return;
		}
		if (!matchesKey(data, "enter")) return;
		const item = items[index]?.item;
		if (!item) return;
		this.selectedIcon = item.icon;
		if (item.action && this.onAction) this.onAction(item.action);
		else this.onInert?.(item);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (!this.taskbar) return undefined;
		if (event.button !== "left") return undefined;
		if (event.x < 0 || event.x >= Math.max(1, event.width - 1)) return undefined;
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const item = this.rowLayout(rows).get(event.y);
		if (!item) return undefined;
		// Keep keyboard selection in sync with the pointer, without taking focus.
		this.selectedIcon = item.icon;
		if (!this.onAction || !item.action) return undefined;
		// The fullscreen renderer only emits `click` after a handled `press` sets the target.
		if (event.type === "press") return { handled: true, render: false };
		if (event.type !== "click") return undefined;
		this.onAction(item.action);
		return { handled: true, render: false };
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.getTheme();
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const fillWidth = Math.max(0, width - 1);
		const edge = theme.bg("toolPendingBg", theme.fg("borderMuted", "│"));
		const items = this.items(rows);
		const selectedRow =
			this.focused && items.length > 0 ? items[this.selectedIndex(items)]?.row : undefined;

		return Array.from({ length: rows }, (_, row) => {
			let content = " ".repeat(fillWidth);
			const item = items.find((entry) => entry.row === row)?.item;
			if (item && width >= 3) {
				const tint = row === selectedRow ? "accent" : "muted";
				content = ` ${theme.fg(tint, item.icon)}${ " ".repeat(Math.max(0, fillWidth - 2))}`;
			}
			const fill = theme.bg(row === selectedRow ? "selectedBg" : "toolPendingBg", content);
			return this.side === "left" ? fill + edge : edge + fill;
		});
	}
}

/* ---------------------------------------------------------------- chat rail */

type ChatRole = "you" | "ether";

/** RightsidebarA: an isolated side conversation. Visual preview until the thread backend lands. */
class EtherChatSidebar implements Component {
	private readonly tui: TUI;
	private readonly getTheme: () => ThemeLike;
	private readonly getCtx: () => ExtensionContextLike | undefined;
	private readonly getSideModel: () => ChatModelRef | null;
	private readonly isRailVisible: () => boolean;
	private readonly input: Input;
	private readonly nav: RailNav;
	focused = false;
	private scrollOffset = 0;
	private maxScroll = 0;
	private follow = true;
	private messageSelection: number | null = null;
	private thread: ChatBubble[] = [];
	private history: unknown[] = [];
	private busy = false;
	private error: string | null = null;
	private abort?: AbortController;
	private recentPath: string | null = null;
	private activity: string | null = null;
	private usageInput: number | null = null;
	private contextWindow: number | null = null;
	private unseen = false;
	private wasVisible = true;
	private readonly actionRows = new Map<number, ChatRowAction>();
	private actionAtScroll = 0;
	private notice: { error: boolean; until: number } | null = null;

	constructor(
		tui: TUI,
		getTheme: () => ThemeLike,
		getCtx: () => ExtensionContextLike | undefined,
		getSideModel: () => ChatModelRef | null,
		isRailVisible: () => boolean,
		nav: RailNav,
	) {
		this.tui = tui;
		this.getTheme = getTheme;
		this.getCtx = getCtx;
		this.getSideModel = getSideModel;
		this.isRailVisible = isRailVisible;
		this.nav = nav;
		this.wasVisible = isRailVisible();
		const theme = getTheme();
		this.input = new Input({
			prompt: ` ${theme.fg("toolTitle", "▸")} `,
			placeholder: CHAT_PLACEHOLDER,
			placeholderStyle: (text) => getTheme().fg("dim", text),
		});
		this.input.onEscape = () => this.releaseFocus();
		this.input.onSubmit = (value) => void this.send(value);
		this.restoreToday();
	}

	/** Replay today's saved turns so a reload does not wipe the thread. */
	private restoreToday(): void {
		const turns = readChatDay().slice(-CHAT_HISTORY_RESTORE_MESSAGES);
		if (turns.length === 0) return;
		this.thread = turns.map((turn) => ({ role: turn.role, text: turn.text }));
		this.history = turns.map((turn) =>
			turn.role === "you"
				? { role: "user", content: [{ type: "text", text: turn.text }], timestamp: Date.now() }
				: { role: "assistant", content: [{ type: "text", text: turn.text }] },
		);
	}

	invalidate(): void {
		this.input.invalidate();
	}

	private matte(theme: ThemeLike, text: string): string {
		return theme.bg("toolPendingBg", text);
	}

	private captureFocus(): void {
		this.nav.captureEditor();
	}

	/** Copy one bubble body and flash a one-glyph confirmation in the composer. */
	private async copyMessage(text: string): Promise<void> {
		try {
			await copyToClipboard(text);
			this.notice = { error: false, until: Date.now() + 1400 };
		} catch {
			this.notice = { error: true, until: Date.now() + 2400 };
		}
		this.tui.requestRender();
	}

	/** Drop a quoted bubble into the composer, focus it, and leave the cursor after the quote. */
	private replyToMessage(text: string): void {
		const quoted = text.replace(/\s+/g, " ").trim();
		if (!quoted) return;
		const existing = this.input.getValue().trimEnd();
		const next = `${existing ? `${existing} ` : ""}↳ ${quoted} `;
		this.input.setValue(next);
		const inputState = this.input as unknown as { cursor?: number };
		if (typeof inputState.cursor === "number") inputState.cursor = next.length;
		this.markSeen();
		this.nav.enter(this);
	}

	/** Resolve a mouse event over a message's copy/reply strip. */
	private actionAt(event: TuiMouseEvent): { message: ChatBubble; action: "copy" | "reply" } | null {
		if (event.x < 1) return null;
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const transcriptRows = Math.max(0, rows - 7);
		const localY = event.y - 4;
		if (localY < 0 || localY >= transcriptRows) return null;
		const hit = this.actionRows.get(this.actionAtScroll + localY);
		if (!hit) return null;
		const x = event.x - 1;
		const copyHit = x >= hit.copyX && x < hit.copyX + 2;
		const replyHit = x >= hit.replyX && x < hit.replyX + 2;
		if (!copyHit && !replyHit) return null;
		const message = this.thread[hit.index];
		if (!message) return null;
		return { message, action: copyHit ? "copy" : "reply" };
	}

	/** Clear the unread marker and the footer badge. */
	private markSeen(): void {
		if (!this.unseen) return;
		this.unseen = false;
		this.syncBadge();
		this.tui.requestRender();
	}

	/** Reflect unread state in the footer statuses; visible even when the rail is hidden. */
	private syncBadge(): void {
		try {
			this.getCtx()?.ui?.setStatus?.("side-chat", this.unseen ? "new reply" : undefined);
		} catch {
			// status is a hint, not a dependency
		}
	}

	/** Called from the animation tick: clears the marker when hidden rails come back. */
	syncVisibility(): void {
		const visible = this.isRailVisible();
		if (visible && !this.wasVisible && this.unseen) this.unseen = false;
		this.wasVisible = visible;
		if (this.focused && this.unseen) this.unseen = false;
		this.syncBadge();
	}

	/** Return focus to the editor. The rail stays fixed at its current width. */
	releaseFocus(): void {
		this.nav.leave();
	}

	/**
	 * Send the draft to the side model. This is a separate thread with its own history:
	 * nothing here enters the main session, and nothing here can act on the workspace.
	 */
	private async send(value: string): Promise<void> {
		const text = value.trim();
		if (!text || this.busy) return;
		const chosen = this.getSideModel();
		const registry = this.getCtx()?.modelRegistry;
		const model = chosen && registry ? registry.find(chosen.provider, chosen.id) : undefined;
		if (!registry || !model) {
			this.error = "no side model — run /chat-model";
			this.tui.requestRender();
			return;
		}
		this.contextWindow = typeof model.contextWindow === "number" ? model.contextWindow : null;

		this.input.setValue("");
		this.error = null;
		this.busy = true;
		this.follow = true;
		this.messageSelection = null;
		this.thread.push({ role: "you", text });
		const reply: ChatBubble = { role: "ether", text: "" };
		this.thread.push(reply);
		this.history.push({ role: "user", content: [{ type: "text", text }], timestamp: Date.now() });
		appendChatEntry("you", text);

		const abort = new AbortController();
		this.abort = abort;
		this.tui.requestRender();

		const root = this.getCtx()?.cwd ?? process.cwd();
		try {
			for (let step = 0; step < SIDE_TOOL_LIMITS.steps; step++) {
				const stream = registry.streamSimple(
					model,
					{ systemPrompt: CHAT_SYSTEM_PROMPT, messages: this.history, tools: SIDE_TOOLS },
					{ signal: abort.signal, reasoning: "max" },
				);
				const calls: ChatToolCallLike[] = [];
				let failed = false;
				for await (const event of stream) {
					if (event.type === "text_delta" && typeof event.delta === "string") {
						reply.text += event.delta;
						this.tui.requestRender();
					} else if (event.type === "toolcall_end" && event.toolCall) {
						calls.push(event.toolCall);
					} else if (event.type === "error") {
						this.error = event.error?.errorMessage ?? "request failed";
						failed = true;
					}
				}
				if (failed) break;
				const final = await stream.result();
				if (final) {
					this.history.push(final);
					const usage = (final as { usage?: { input?: unknown } }).usage;
					if (usage && typeof usage.input === "number") this.usageInput = usage.input;
				}
				if (calls.length === 0) break;

				for (const call of calls) {
					const detail =
						typeof call.arguments.path === "string"
							? call.arguments.path
							: typeof call.arguments.query === "string"
								? `"${call.arguments.query}"`
								: typeof call.arguments.url === "string"
									? call.arguments.url
									: "";
					this.activity = `${call.name} ${detail}`.trim();
					this.tui.requestRender();
					const outcome = await this.runTool(root, call);
					if (outcome.path) this.recentPath = outcome.path;
					this.history.push({
						role: "toolResult",
						toolCallId: call.id,
						toolName: call.name,
						content: [{ type: "text", text: outcome.text }],
						isError: outcome.isError,
						timestamp: Date.now(),
					});
					this.tui.requestRender();
				}
			}
		} catch (error) {
			this.error = error instanceof Error ? error.message : String(error);
		} finally {
			this.activity = null;
			if (reply.text.trim()) appendChatEntry("ether", reply.text);
			if (!reply.text.trim()) {
				const index = this.thread.indexOf(reply);
				if (index >= 0) this.thread.splice(index, 1);
			}
			this.busy = false;
			this.abort = undefined;
			this.unseen = !this.focused || !this.isRailVisible();
			this.syncBadge();
			this.tui.requestRender();
		}
	}

	/** Context meter for the masthead: percent of the side model's window, plus its size. */
	private ctxLabel(): string {
		const window = this.contextWindow;
		if (!window) return "—/—";
		const used = this.usageInput;
		const pct = used === null ? null : Math.max(0, Math.min(999, (used / window) * 100));
		const pctText = pct === null ? "—" : `${pct >= 10 ? pct.toFixed(1) : pct.toFixed(2)}%`;
		return `${pctText}/${compactCount(window)}`;
	}

	/** Run one read-only tool. Unknown names fail closed. */
	private async runTool(root: string, call: ChatToolCallLike): Promise<SideToolOutcome> {
		try {
			switch (call.name) {
				case "list_dir":
					return runListDir(root, call.arguments);
				case "read_file":
					return runReadFile(root, call.arguments);
				case "grep_workspace":
					return runGrepWorkspace(root, call.arguments);
				case "web_search":
					return await runWebSearch(call.arguments);
				case "fetch_url":
					return await runFetchUrl(call.arguments);
				case "read_history":
					return runReadHistory(call.arguments);
				default:
					return { text: `unknown tool: ${call.name}`, isError: true };
			}
		} catch (error) {
			return { text: error instanceof Error ? error.message : "tool failed", isError: true };
		}
	}

	private transcriptRows(): number {
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		return Math.max(1, rows - 7);
	}

	private pageStep(): number {
		return Math.max(1, this.transcriptRows() - 2);
	}

	private scrollBy(delta: number): void {
		this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset + delta));
		this.follow = this.scrollOffset >= this.maxScroll;
		this.tui.requestRender();
	}

	private scrollTo(offset: number): void {
		this.scrollOffset = Math.max(0, Math.min(this.maxScroll, offset));
		this.follow = this.scrollOffset >= this.maxScroll;
		this.tui.requestRender();
	}

	/** Last non-empty Ether bubble, then any non-empty bubble. */
	private lastEtherIndex(): number | null {
		for (let index = this.thread.length - 1; index >= 0; index--) {
			if (this.thread[index]?.role === "ether" && this.thread[index].text.trim()) return index;
		}
		for (let index = this.thread.length - 1; index >= 0; index--) {
			if (this.thread[index]?.text.trim()) return index;
		}
		return null;
	}

	/** The selected bubble, or the last Ether reply when nothing is selected. */
	private selectionTarget(): ChatBubble | null {
		const index = this.messageSelection ?? this.lastEtherIndex();
		return index === null ? null : (this.thread[index] ?? null);
	}

	/** Keep the selected label row on screen; selection detaches transcript follow. */
	private revealSelection(): void {
		if (this.messageSelection === null) return;
		let labelRow: number | undefined;
		for (const [row, action] of this.actionRows) {
			if (action.index === this.messageSelection) {
				labelRow = row;
				break;
			}
		}
		if (labelRow === undefined) return;
		const viewport = this.transcriptRows();
		if (labelRow < this.scrollOffset + 1) this.scrollOffset = Math.max(0, labelRow - 1);
		else if (labelRow > this.scrollOffset + viewport - 3) {
			this.scrollOffset = Math.max(0, labelRow - viewport + 3);
		}
		this.follow = this.scrollOffset >= this.maxScroll;
	}

	private moveSelection(delta: number): void {
		if (this.thread.length === 0) return;
		const next =
			this.messageSelection === null
				? delta < 0
					? this.thread.length - 1
					: 0
				: this.messageSelection + delta;
		this.messageSelection = Math.max(0, Math.min(this.thread.length - 1, next));
		this.revealSelection();
		this.tui.requestRender();
	}

	private copySelected(): void {
		const message = this.selectionTarget();
		if (!message || !message.text.trim()) return;
		void this.copyMessage(message.text);
	}

	private replySelected(): void {
		const message = this.selectionTarget();
		if (!message || !message.text.trim()) return;
		this.replyToMessage(message.text);
	}

	handleInput(data: string): void {
		if (matchesKey(data, "tab")) {
			this.nav.cycle(1);
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.nav.cycle(-1);
			return;
		}
		if (matchesKey(data, "escape")) {
			if (this.messageSelection !== null) {
				this.messageSelection = null;
				this.tui.requestRender();
				return;
			}
			this.nav.leave();
			return;
		}
		if (matchesKey(data, "pageUp")) {
			this.scrollBy(-this.pageStep());
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.scrollBy(this.pageStep());
			return;
		}
		if (matchesKey(data, "ctrl+home")) {
			this.scrollTo(0);
			return;
		}
		if (matchesKey(data, "ctrl+end")) {
			this.scrollTo(this.maxScroll);
			this.follow = true;
			return;
		}
		if (matchesKey(data, "ctrl+up")) {
			this.moveSelection(-1);
			return;
		}
		if (matchesKey(data, "ctrl+down")) {
			this.moveSelection(1);
			return;
		}
		if (matchesKey(data, "ctrl+x")) {
			this.copySelected();
			return;
		}
		if (matchesKey(data, "ctrl+r")) {
			this.replySelected();
			return;
		}
		this.input.focused = this.focused;
		this.input.handleInput(data);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			const delta = Math.trunc(event.wheelDelta ?? 0);
			if (delta === 0) return undefined;
			this.markSeen();
			this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset + delta));
			this.follow = this.scrollOffset >= this.maxScroll;
			return { handled: true };
		}
		if (event.button !== "left") return undefined;
		const hit = this.actionAt(event);
		if (hit) {
			if (event.type === "press") return { handled: true, render: false };
			if (event.type === "click") {
				this.markSeen();
				if (hit.action === "copy") void this.copyMessage(hit.message.text);
				else this.replyToMessage(hit.message.text);
				return { handled: true, render: false };
			}
			return undefined;
		}
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		if (event.y < rows - 3) return undefined;
		this.markSeen();
		if (event.type === "press") {
			this.captureFocus();
			return { handled: true, render: false, focus: true };
		}
		if (event.type !== "click") return undefined;
		if (!this.focused) this.captureFocus();
		return { handled: true, focus: true };
	}

	private bubble(theme: ThemeLike, role: ChatRole, text: string, maxWidth: number): string[] {
		const mode = theme.getColorMode?.() ?? "truecolor";
		const paint =
			role === "you"
				? (line: string) => styleText(line, { bg: SIDE_USER_BG }, mode)
				: (line: string) => theme.bg("toolPendingBg", line);
		const maxText = Math.max(1, maxWidth - 4);
		const wrap = (width: number): string[] =>
			text.split("\n").flatMap((line) => {
				const wrapped = wrapTextWithAnsi(line, width);
				return wrapped.length > 0 ? wrapped : [""];
			});

		const lines = wrap(maxText);
		const bubbleWidth = Math.max(6, maxWidth);
		const innerWidth = Math.max(1, bubbleWidth - 4);

		const border = (value: string) => theme.fg("borderMuted", value);
		const top = border("╭" + "─".repeat(Math.max(0, bubbleWidth - 2)) + "╮");
		const bodyTone = role === "ether" ? "customMessageText" : "text";
		const body = lines.map((line) => {
			const clipped = truncateToWidth(line, innerWidth, "…");
			return (
				border("│") +
				" " +
				theme.fg(bodyTone, clipped) +
				" ".repeat(Math.max(0, innerWidth - visibleWidth(clipped))) +
				" " +
				border("│")
			);
		});
		const bottom = border("╰" + "─".repeat(Math.max(0, bubbleWidth - 2)) + "╯");
		return [top, ...body, bottom].map(paint);
	}

	/** Role line above a bubble; the dot is the only blue mark on Ether messages. */
	private label(theme: ThemeLike, role: ChatRole, fillWidth: number, selected: boolean): string {
		const actions = ` ${theme.fg("dim", CHAT_COPY_ICON)} ${theme.fg("dim", CHAT_REPLY_ICON)} `;
		const paint = selected
			? (text: string) => theme.bg("selectedBg", text)
			: (text: string) => this.matte(theme, text);
		if (role === "ether") {
			const label = ` ${theme.fg("toolTitle", "●")} ${theme.fg("muted", "ETHER")}`;
			const gap = Math.max(1, fillWidth - visibleWidth(label) - visibleWidth(actions));
			return paint(label + " ".repeat(gap) + actions);
		}
		const label = `${theme.fg("dim", "YOU")} ${theme.fg("dim", "●")}`;
		const gap = Math.max(1, fillWidth - visibleWidth(actions) - visibleWidth(label) - 1);
		return paint(actions + " ".repeat(gap) + label + " ");
	}

	private transcript(theme: ThemeLike, fillWidth: number, viewportRows: number): { lines: string[]; maxScroll: number } {
		const rows: string[] = [];
		this.actionRows.clear();
		if (this.messageSelection !== null && this.messageSelection >= this.thread.length) {
			this.messageSelection = null;
		}
		if (this.thread.length === 0) {
			for (const note of ["ask about the project", "I can look, not touch"]) {
				const content = ` ${theme.fg("dim", note)}`;
				rows.push(this.matte(theme, content + " ".repeat(Math.max(0, fillWidth - visibleWidth(content)))));
			}
		}

		const available = Math.max(1, fillWidth - 2);
		this.thread.forEach((message, index) => {
			const labelRow = rows.length;
			rows.push(this.label(theme, message.role, fillWidth, this.messageSelection === index));
			const actionStart = message.role === "ether" ? fillWidth - CHAT_ACTION_WIDTH : 0;
			this.actionRows.set(labelRow, {
				index,
				copyX: actionStart + 1,
				replyX: actionStart + 3,
			});
			const streaming = this.busy && index === this.thread.length - 1 && message.role === "ether";
			const body = streaming ? `${message.text}${theme.fg("toolTitle", "▌")}` : message.text;
			const bubble = this.bubble(theme, message.role, body, available);
			const bubbleWidth = Math.max(...bubble.map((line) => visibleWidth(line)));
			const leftPad = 1;
			const rightPad = Math.max(0, fillWidth - leftPad - bubbleWidth);
			for (const line of bubble) {
				rows.push(this.matte(theme, " ".repeat(leftPad)) + line + this.matte(theme, " ".repeat(rightPad)));
			}
			if (index < this.thread.length - 1) rows.push(this.matte(theme, " ".repeat(fillWidth)));
		});

		if (this.busy && this.activity) {
			const label = truncateToWidth(`⌕ ${this.activity}`, Math.max(1, fillWidth - 2), "…");
			const content = ` ${theme.fg("dim", label)}`;
			rows.push(this.matte(theme, content + " ".repeat(Math.max(0, fillWidth - visibleWidth(content)))));
		}

		if (this.error) {
			const wrapped = wrapTextWithAnsi(`! ${this.error}`, Math.max(1, fillWidth - 2));
			for (const line of wrapped) {
				const content = ` ${theme.fg("error", line)}`;
				rows.push(this.matte(theme, content + " ".repeat(Math.max(0, fillWidth - visibleWidth(content)))));
			}
		}
		const maxScroll = Math.max(0, rows.length - viewportRows);
		if (this.follow) this.scrollOffset = maxScroll;
		else this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxScroll));
		this.maxScroll = maxScroll;
		this.actionAtScroll = this.scrollOffset;
		const visible = rows.slice(this.scrollOffset, this.scrollOffset + viewportRows);
		while (visible.length < viewportRows) visible.push(this.matte(theme, " ".repeat(fillWidth)));
		return { lines: visible, maxScroll };
	}

	/** Sticky masthead: identity, breathing row, status, then a pinned rule above the scroll area. */
	private masthead(theme: ThemeLike, fillWidth: number, overflow: boolean, detached: boolean): string[] {
		const width = Math.max(1, fillWidth);
		const prefix = ` ${theme.fg("toolTitle", "●")} ${theme.fg("accent", "ETHER")} ${theme.fg("dim", "// ")}`;
		const room = Math.max(3, width - visibleWidth(prefix) - 2);
		let label = "LOOPBACK";
		if (this.recentPath) {
			const cwd = this.getCtx()?.cwd ?? process.cwd();
			try {
				label = relative(cwd, this.recentPath).replace(/\\/g, "/") || ".";
			} catch {
				label = this.recentPath;
			}
		}
		const shown = visibleWidth(label) > room ? `…${label.slice(Math.max(0, label.length - (room - 1)))}` : label;
		const title = prefix + theme.fg("dim", shown);
		const link = theme.fg("dim", "⌁");
		const titleGap = Math.max(1, width - visibleWidth(title) - visibleWidth(link));
		const titleRow = title + " ".repeat(titleGap) + link;

		const hint = overflow ? theme.fg("muted", detached ? "↓" : "↕") : "";
		const left = ` ${theme.fg("dim", "AUX-01")}`;
		const statusDot = this.busy || this.unseen ? theme.fg("toolTitle", "●") : theme.fg("success", "●");
		const statusText = this.busy ? "WORK" : this.unseen ? "NEW" : "IDLE";
		const rightStatus = `${statusDot} ${theme.fg(this.unseen && !this.busy ? "accent" : "dim", statusText)}`;
		const right = hint ? `${rightStatus} ${hint}` : rightStatus;
		const gap = Math.max(1, width - visibleWidth(left) - visibleWidth(right));
		const statusRow = left + " ".repeat(gap) + right;

		const ctx = `${theme.fg("dim", "CTX")} ${theme.fg("muted", this.ctxLabel())}`;
		const modelRoom = Math.max(1, width - visibleWidth(ctx) - " MODEL ".length - 1);
		const modelName = truncateToWidth(this.getSideModel()?.id ?? "—", modelRoom, "…");
		const model = ` ${theme.fg("dim", "MODEL")} ${theme.fg("muted", modelName)}`;
		const metricsGap = Math.max(1, width - visibleWidth(model) - visibleWidth(ctx));
		const metricsRow = model + " ".repeat(metricsGap) + ctx;

		return [titleRow, metricsRow, statusRow].map((line) =>
			this.matte(theme, line + " ".repeat(Math.max(0, width - visibleWidth(line)))),
		);
	}

	private compose(theme: ThemeLike, fillWidth: number, focused: boolean): string[] {
		const boxWidth = Math.max(16, fillWidth - 2);
		const inset = Math.max(0, Math.floor((fillWidth - boxWidth) / 2));
		const rightInset = Math.max(0, fillWidth - inset - boxWidth);
		const innerWidth = Math.max(1, boxWidth - 2);
		const frameColor = focused ? "toolTitle" : "borderMuted";
		const frame = (text: string) => theme.fg(frameColor, text);
		const pad = (line: string) => " ".repeat(inset) + line + " ".repeat(rightInset);
		const [tl, tr, bl, br, bar, side] = focused
			? ["╔", "╗", "╚", "╝", "═", "║"]
			: ["┏", "┓", "┗", "┛", "━", "┃"];

		const dot = theme.fg(this.busy ? "toolTitle" : focused ? "accent" : "success", "●");
		const title = theme.fg(focused ? "toolTitle" : "muted", "ASK ETHER");
		const label = `${dot} ${title}`;
		const topFill = Math.max(0, boxWidth - visibleWidth(label) - 7);
		const top = frame(`${tl}${bar}[ `) + label + frame(` ]${bar.repeat(topFill)}${tr}`);
		const bottom = frame(bl + bar.repeat(Math.max(0, boxWidth - 2)) + br);

		const notice = this.notice && this.notice.until > Date.now() ? this.notice : null;
		const hintText = notice ? "  ✓ " : focused ? "esc" : "⏎ TX";
		const hint = notice
			? theme.fg(notice.error ? "error" : "success", notice.error ? "  ✕ " : "  ✓ ")
			: theme.fg(focused ? "muted" : "dim", hintText);
		const hintWidth = visibleWidth(hintText);
		const inputWidth = Math.max(4, innerWidth - 3 - hintWidth);
		let inputLine: string;
		if (focused) {
			this.input.focused = true;
			inputLine = this.input.render(inputWidth)[0] ?? "";
		} else {
			this.input.focused = false;
			const draft = this.input.getValue();
			const hasDraft = draft.length > 0;
			const labelText = truncateToWidth(hasDraft ? draft : CHAT_PLACEHOLDER, Math.max(1, inputWidth - 3), "…");
			inputLine = ` ${theme.fg("dim", "▸")} ${theme.fg(hasDraft ? "text" : "dim", labelText)}`;
		}
		if (visibleWidth(inputLine) < inputWidth) inputLine += " ".repeat(inputWidth - visibleWidth(inputLine));
		if (visibleWidth(inputLine) > inputWidth) inputLine = truncateToWidth(inputLine, inputWidth, "");
		const inner = " " + inputLine + " " + hint + " ";
		const inputRow = frame(side) + inner + frame(side);

		return [top, inputRow, bottom].map((line) => this.matte(theme, pad(line)));
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.getTheme();
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const fillWidth = Math.max(0, width - 1);
		// Fixed masthead (3) + pinned rule (1) + composer (3).
		const transcriptRows = Math.max(0, rows - 7);
		const transcript = this.transcript(theme, fillWidth, transcriptRows);
		const edge = this.matte(theme, theme.fg("borderMuted", "│"));
		const detached = this.scrollOffset < transcript.maxScroll;
		const masthead = this.masthead(theme, fillWidth, transcript.maxScroll > 0, detached);
		const composer = this.compose(theme, fillWidth, this.focused);
		const lines: string[] = [];
		for (const line of masthead) lines.push(edge + line);
		lines.push(this.matte(theme, theme.fg("border", "├" + "─".repeat(Math.max(0, fillWidth)))));
		for (const line of transcript.lines) lines.push(edge + line);
		for (const line of composer) lines.push(edge + line);
		return lines;
	}
}

/* --------------------------------------------------------------- files rail */

/** LeftSidebarB: "Files" heading plus a collapsible file tree. */
class EtherFilesSidebar implements Component {
	private readonly tui: TUI;
	private readonly getCtx: () => ExtensionContextLike | undefined;
	private readonly getTheme: () => ThemeLike;
	private readonly getActiveFile: () => string | null;
	private readonly onFileClick: (path: string, viaKeyboard: boolean) => void;
	private readonly nav: RailNav;
	focused = false;
	private tree: FileNode[] = [];
	private treeCwd = "";
	private treeAt = 0;
	private readonly collapsed = new Set<string>();
	private scrollOffset = 0;
	private rowTargets = new Map<number, FileNode>();
	private selectedPath: string | null = null;

	constructor(
		tui: TUI,
		getCtx: () => ExtensionContextLike | undefined,
		getTheme: () => ThemeLike,
		getActiveFile: () => string | null,
		onFileClick: (path: string, viaKeyboard: boolean) => void,
		nav: RailNav,
	) {
		this.tui = tui;
		this.getCtx = getCtx;
		this.getTheme = getTheme;
		this.getActiveFile = getActiveFile;
		this.onFileClick = onFileClick;
		this.nav = nav;
	}

	invalidate(): void {
		// the filesystem cache is intentional; the ticker re-renders the rows
	}

	private getTree(cwd: string): FileNode[] {
		const now = Date.now();
		if (this.treeCwd !== cwd) {
			this.treeCwd = cwd;
			this.tree = readFileTree(cwd);
			this.treeAt = now;
			this.collapsed.clear();
			this.scrollOffset = 0;
			this.selectedPath = null;
		} else if (now - this.treeAt >= FILE_TREE_REFRESH_MS) {
			this.tree = readFileTree(cwd);
			this.treeAt = now;
		}
		return this.tree;
	}

	private flatten(nodes: readonly FileNode[], depth: number, out: Array<{ node: FileNode; depth: number }>): void {
		for (const node of nodes) {
			out.push({ node, depth });
			if (node.isDir && node.children && !this.collapsed.has(node.path)) {
				this.flatten(node.children, depth + 1, out);
			}
		}
	}

	private flatList(): Array<{ node: FileNode; depth: number }> {
		const cwd = this.getCtx()?.cwd ?? process.cwd();
		const flat: Array<{ node: FileNode; depth: number }> = [];
		this.flatten(this.getTree(cwd), 0, flat);
		return flat;
	}

	/** Resolve the selected row; fall back to the active file, then the first row. */
	private selectionIndex(flat: readonly { node: FileNode }[]): number {
		if (flat.length === 0) return -1;
		if (this.selectedPath) {
			const found = flat.findIndex((entry) => entry.node.path === this.selectedPath);
			if (found >= 0) return found;
		}
		const active = this.getActiveFile();
		if (active) {
			const found = flat.findIndex((entry) => entry.node.path === active);
			if (found >= 0) return found;
		}
		return 0;
	}

	private ensureVisible(index: number, total: number): void {
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const visible = Math.max(1, rows - 1);
		if (index < this.scrollOffset) this.scrollOffset = index;
		else if (index >= this.scrollOffset + visible) this.scrollOffset = index - visible + 1;
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, Math.max(0, total - visible)));
	}

	private select(index: number, flat: readonly { node: FileNode }[]): void {
		const entry = flat[Math.max(0, Math.min(flat.length - 1, index))];
		if (!entry) return;
		this.selectedPath = entry.node.path;
		this.ensureVisible(index, flat.length);
		this.tui.requestRender();
	}

	/** Collapse/expand a folder and keep the selection on it if a child was selected. */
	private toggleFolder(node: FileNode): void {
		if (this.collapsed.has(node.path)) {
			this.collapsed.delete(node.path);
		} else {
			this.collapsed.add(node.path);
			if (this.selectedPath && this.selectedPath.startsWith(`${node.path}${sep}`)) {
				this.selectedPath = node.path;
			}
		}
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "tab")) {
			this.nav.cycle(1);
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.nav.cycle(-1);
			return;
		}
		if (matchesKey(data, "escape")) {
			this.nav.leave();
			return;
		}
		const flat = this.flatList();
		if (flat.length === 0) return;
		const index = this.selectionIndex(flat);
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.select(index - 1, flat);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.select(index + 1, flat);
			return;
		}
		if (matchesKey(data, "home")) {
			this.select(0, flat);
			return;
		}
		if (matchesKey(data, "end")) {
			this.select(flat.length - 1, flat);
			return;
		}
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const page = Math.max(1, rows - 3);
		if (matchesKey(data, "pageUp")) {
			this.select(index - page, flat);
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.select(index + page, flat);
			return;
		}
		const entry = flat[index];
		if (!entry) return;
		if (matchesKey(data, "left")) {
			if (entry.node.isDir && !this.collapsed.has(entry.node.path)) {
				this.toggleFolder(entry.node);
				return;
			}
			for (let parent = index - 1; parent >= 0; parent--) {
				if (flat[parent]?.depth === entry.depth - 1) {
					this.select(parent, flat);
					return;
				}
			}
			return;
		}
		if (matchesKey(data, "right")) {
			if (entry.node.isDir && this.collapsed.has(entry.node.path)) {
				this.toggleFolder(entry.node);
				return;
			}
			if (entry.node.isDir && flat[index + 1]?.depth === entry.depth + 1) {
				this.select(index + 1, flat);
			}
			return;
		}
		if (!matchesKey(data, "enter")) return;
		if (entry.node.isDir) {
			this.toggleFolder(entry.node);
			return;
		}
		this.selectedPath = entry.node.path;
		this.onFileClick(entry.node.path, true);
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			const delta = Math.trunc(event.wheelDelta ?? 0);
			if (delta === 0) return undefined;
			this.scrollOffset = Math.max(0, this.scrollOffset + delta);
			return { handled: true };
		}
		if (event.button !== "left") return undefined;
		if (event.x < 0 || event.x >= Math.max(1, event.width - 1)) return undefined;
		const node = this.rowTargets.get(event.y);
		if (!node) return undefined;
		if (event.type === "press") return { handled: true, render: false };
		if (event.type !== "click") return undefined;
		// Pointer clicks do not steal focus; they only sync the selection.
		this.selectedPath = node.path;
		if (node.isDir) this.toggleFolder(node);
		else this.onFileClick(node.path, false);
		return { handled: true };
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const theme = this.getTheme();
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const fillWidth = Math.max(0, width - 1);
		const edge = theme.bg("toolPendingBg", theme.fg("borderMuted", "│"));
		const cwd = this.getCtx()?.cwd ?? process.cwd();
		const flat: Array<{ node: FileNode; depth: number }> = [];
		this.flatten(this.getTree(cwd), 0, flat);

		const visibleRows = Math.max(0, rows - 1);
		const maxOffset = Math.max(0, flat.length - visibleRows);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, maxOffset));

		const selectedIndex = this.focused ? this.selectionIndex(flat) : -1;
		if (this.focused && selectedIndex >= 0) this.selectedPath = flat[selectedIndex]!.node.path;

		const headingText = ` ${theme.fg("accent", "Files")}`;
		const headings: string[] = [];
		if (flat.length > visibleRows) headings.push("↕");
		if (this.focused) headings.push("esc");
		const scrollHint = headings.length > 0 ? theme.fg("dim", headings.join(" ")) : "";
		const headingGap = Math.max(1, fillWidth - visibleWidth(headingText) - visibleWidth(scrollHint));
		const heading = headingText + " ".repeat(headingGap) + scrollHint;
		const lines = [theme.bg("toolPendingBg", heading) + edge];

		this.rowTargets.clear();
		for (let row = 0; row < visibleRows; row++) {
			const flatIndex = this.scrollOffset + row;
			const item = flat[flatIndex];
			let content = "";
			if (item) {
				const selected = this.focused && flatIndex === selectedIndex;
				const indent = " ".repeat(Math.min(item.depth * FILE_TREE_INDENT_STEP, FILE_TREE_MAX_INDENT));
				if (item.node.isDir) {
					const marker = this.collapsed.has(item.node.path) ? "▸ " : "▾ ";
					// Harness blue: the same toolTitle hue as tool output and the active-file dot.
					content = ` ${indent}${theme.fg("toolTitle", marker)}${theme.fg("toolTitle", item.node.name)}`;
				} else {
					const active = this.getActiveFile() === item.node.path;
					const marker = active ? `${theme.fg("toolTitle", "●")} ` : "  ";
					const name = selected ? "accent" : active ? "text" : "dim";
					content = ` ${indent}${marker}${theme.fg(name, item.node.name)}`;
				}
				this.rowTargets.set(row + 1, item.node);
				if (visibleWidth(content) > fillWidth) content = truncateToWidth(content, fillWidth, "…");
			} else if (flat.length === 0 && row === 0) {
				content = ` ${theme.fg("dim", "(empty)")}`;
			}
			const selected = this.focused && flatIndex === selectedIndex && !!item;
			const padded = content + " ".repeat(Math.max(0, fillWidth - visibleWidth(content)));
			lines.push(theme.bg(selected ? "selectedBg" : "toolPendingBg", padded) + edge);
		}
		return lines;
	}
}

/* ------------------------------------------------------------- preview rail */

/** Foreground escape for the Dracula palette, matching the terminal's color mode. */
function ansiColor(hex: string, mode: "truecolor" | "256color"): string {
	const value = hex.replace("#", "");
	const r = parseInt(value.slice(0, 2), 16);
	const g = parseInt(value.slice(2, 4), 16);
	const b = parseInt(value.slice(4, 6), 16);
	if (mode === "truecolor") return `\x1b[38;2;${r};${g};${b}m`;
	const level = (channel: number) => Math.round((channel / 255) * 5);
	const index =
		r === g && g === b
			? r < 8
				? 16
				: r > 248
					? 231
					: Math.round(((r - 8) / 247) * 24) + 232
			: 16 + 36 * level(r) + 6 * level(g) + level(b);
	return `\x1b[38;5;${index}m`;
}

/** RightsidebarB: file preview with line numbers, soft wrap, auto-refresh, and Dracula code colors. */
class EtherPreviewSidebar implements Component {
	private readonly tui: TUI;
	private readonly getTheme: () => ThemeLike;
	private readonly getCtx: () => ExtensionContextLike | undefined;
	private readonly getActiveFile: () => string | null;
	private readonly onClose: (viaKeyboard: boolean) => void;
	private readonly nav: RailNav;
	focused = false;

	private path = "";
	private mtimeMs = 0;
	private size = 0;
	private checkedAt = 0;
	private lastWidth = 0;
	private scrollOffset = 0;
	private maxScroll = 0;
	private gutterWidth = 3;
	private totalLines = 0;
	private sourceLines: string[] = [];
	private display: string[] = [];
	private notice: string | null = null;
	private truncated = false;

	constructor(
		tui: TUI,
		getTheme: () => ThemeLike,
		getCtx: () => ExtensionContextLike | undefined,
		getActiveFile: () => string | null,
		onClose: (viaKeyboard: boolean) => void,
		nav: RailNav,
	) {
		this.tui = tui;
		this.getTheme = getTheme;
		this.getCtx = getCtx;
		this.getActiveFile = getActiveFile;
		this.onClose = onClose;
		this.nav = nav;
	}

	invalidate(): void {
		// Theme changes must re-run highlighting and re-wrap.
		this.lastWidth = 0;
		this.path = "";
		this.checkedAt = 0;
	}

	private matte(theme: ThemeLike, text: string): string {
		return theme.bg("toolPendingBg", text);
	}

	private remapDracula(theme: ThemeLike, lines: string[]): string[] {
		const mode = theme.getColorMode?.() ?? "truecolor";
		const map = new Map<string, string>();
		const add = (token: string, hex: string) => {
			const source = theme.getFgAnsi?.(token);
			if (source && !map.has(source)) map.set(source, ansiColor(hex, mode));
		};
		add("syntaxComment", DRACULA.comment);
		add("syntaxPunctuation", DRACULA.punctuation);
		add("syntaxKeyword", DRACULA.keyword);
		add("syntaxFunction", DRACULA.function);
		add("syntaxString", DRACULA.string);
		add("syntaxNumber", DRACULA.number);
		add("syntaxType", DRACULA.type);
		add("syntaxVariable", DRACULA.variable);
		add("syntaxOperator", DRACULA.operator);
		add("text", DRACULA.text);
		add("muted", DRACULA.muted);
		add("toolDiffAdded", DRACULA.added);
		add("toolDiffRemoved", DRACULA.removed);
		if (map.size === 0) return lines;
		return lines.map((line) => {
			let out = line;
			for (const [source, target] of map) out = out.split(source).join(target);
			return out;
		});
	}

	private load(theme: ThemeLike, file: string): void {
		const sameFile = this.path === file;
		if (!sameFile) this.scrollOffset = 0;
		this.path = file;
		this.checkedAt = Date.now();
		this.notice = null;
		this.truncated = false;

		try {
			const stat = statSync(file);
			this.mtimeMs = stat.mtimeMs;
			this.size = stat.size;

			let buffer: Buffer;
			if (stat.size > PREVIEW_MAX_BYTES) {
				const fd = openSync(file, "r");
				try {
					const chunk = Buffer.alloc(PREVIEW_MAX_BYTES);
					const read = readSync(fd, chunk, 0, chunk.length, 0);
					buffer = chunk.subarray(0, read);
				} finally {
					closeSync(fd);
				}
				this.truncated = true;
			} else {
				buffer = readFileSync(file);
			}

			if (buffer.subarray(0, 8192).includes(0)) {
				this.notice = "binary file — preview unavailable";
				this.sourceLines = [];
				this.display = [];
				this.lastWidth = 0;
				return;
			}

			let text = buffer.toString("utf8");
			if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
			text = text.replace(/\r\n?/g, "\n");
			if (text.length === 0) {
				this.notice = "empty file";
				this.sourceLines = [];
				this.display = [];
				this.lastWidth = 0;
				return;
			}

			let lines = text.split("\n");
			if (lines.length > PREVIEW_MAX_LINES) {
				lines = lines.slice(0, PREVIEW_MAX_LINES);
				this.truncated = true;
			}
			const expanded = lines.map((line) => line.replace(/\t/g, " ".repeat(PREVIEW_TAB_SIZE)));
			const dot = file.lastIndexOf(".");
			const ext = dot >= 0 ? file.slice(dot).toLowerCase() : "";
			const prose = PROSE_EXTENSIONS.has(ext);
			const lang = prose ? undefined : getLanguageFromPath(file);

			// Prose and unhighlighted text: one dim-white tone for every source line.
			const paintProse = (line: string) => theme.fg("dim", line);
			let rendered: string[];
			if (lang) {
				const highlighted = highlightCode(expanded.join("\n"), lang);
				rendered = this.remapDracula(theme, highlighted);
				if (rendered.length !== expanded.length) {
					rendered = expanded.map(paintProse);
				}
			} else {
				rendered = expanded.map(paintProse);
			}

			this.sourceLines = rendered;
			this.totalLines = expanded.length;
			this.gutterWidth = Math.max(3, String(this.totalLines).length);
			this.lastWidth = 0;
		} catch (error) {
			this.notice = `cannot read file${error instanceof Error ? `: ${error.message}` : ""}`;
			this.sourceLines = [];
			this.display = [];
			this.lastWidth = 0;
		}
	}

	private refreshIfNeeded(theme: ThemeLike): void {
		const file = this.getActiveFile();
		if (!file) return;
		if (this.path !== file) {
			this.load(theme, file);
			return;
		}
		const now = Date.now();
		if (now - this.checkedAt < PREVIEW_REFRESH_MS) return;
		this.checkedAt = now;
		try {
			const stat = statSync(file);
			if (stat.mtimeMs !== this.mtimeMs || stat.size !== this.size) this.load(theme, file);
		} catch {
			this.notice = "file unavailable";
			this.sourceLines = [];
			this.display = [];
			this.lastWidth = 0;
		}
	}

	private buildDisplay(theme: ThemeLike, width: number): void {
		const fillWidth = Math.max(1, width - 1);
		const rows: string[] = [];

		if (this.notice) {
			let message = ` ${theme.fg("dim", this.notice)}`;
			if (visibleWidth(message) > fillWidth) message = truncateToWidth(message, fillWidth, "…");
			rows.push(this.matte(theme, message + " ".repeat(Math.max(0, fillWidth - visibleWidth(message)))));
			this.display = rows;
			this.lastWidth = width;
			return;
		}

		const gutter = this.gutterWidth;
		const textWidth = Math.max(1, fillWidth - (gutter + 4));
		const number = (value: number) => String(value).padStart(gutter, " ");

		for (let index = 0; index < this.sourceLines.length; index++) {
			const wrapped = wrapTextWithAnsi(this.sourceLines[index], textWidth);
			const visual = wrapped.length > 0 ? wrapped : [""];
			for (let row = 0; row < visual.length; row++) {
				const numberCell = row === 0 ? number(index + 1) : "↳".padStart(gutter, " ");
				const clipped = truncateToWidth(visual[row], textWidth, "…");
				const content =
					` ${theme.fg("dim", numberCell)} ${theme.fg("borderMuted", "│")} ${clipped}`;
				rows.push(
					this.matte(theme, content + " ".repeat(Math.max(0, fillWidth - visibleWidth(content)))),
				);
			}
		}

		if (this.truncated) {
			let message = ` ${theme.fg("dim", `… truncated at ${PREVIEW_MAX_LINES} lines / ${Math.round(PREVIEW_MAX_BYTES / 1000)} KB`)}`;
			if (visibleWidth(message) > fillWidth) message = truncateToWidth(message, fillWidth, "…");
			rows.push(this.matte(theme, message + " ".repeat(Math.max(0, fillWidth - visibleWidth(message)))));
		}

		this.display = rows;
		this.lastWidth = width;
	}

	private header(theme: ThemeLike, fillWidth: number, overflow: boolean): string {
		const file = this.getActiveFile() ?? "";
		const cwd = this.getCtx()?.cwd ?? process.cwd();
		let rel = file;
		try {
			rel = relative(cwd, file).replace(/\\/g, "/");
		} catch {
			rel = file.replace(/\\/g, "/");
		}
		if (!rel) rel = file.split(/[\\/]/).pop() ?? file;

		const close = theme.fg("muted", "✕");
		const hints: string[] = [];
		if (overflow) hints.push("↕");
		if (this.focused) hints.push("esc");
		const hint = hints.length > 0 ? theme.fg("dim", hints.join(" ")) : "";
		const right = hint ? `${hint} ${close}` : close;
		const rightWidth = visibleWidth(right);
		const pathMax = Math.max(1, fillWidth - 1 - rightWidth - 1);
		let shown = rel;
		if (visibleWidth(shown) > pathMax) {
			shown = `…${shown.slice(Math.max(0, shown.length - (pathMax - 1)))}`;
		}
		const slash = shown.lastIndexOf("/");
		const dir = slash >= 0 ? shown.slice(0, slash + 1) : "";
		const base = slash >= 0 ? shown.slice(slash + 1) : shown;
		const label = theme.fg("dim", dir) + theme.fg("text", base);
		const gap = Math.max(1, fillWidth - 1 - visibleWidth(label) - rightWidth);
		let content = ` ${label}${ " ".repeat(gap)}${right}`;
		if (visibleWidth(content) > fillWidth) content = truncateToWidth(content, fillWidth, "");
		content += " ".repeat(Math.max(0, fillWidth - visibleWidth(content)));
		return this.matte(theme, content);
	}

	private scrollBy(delta: number): void {
		this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset + delta));
		this.tui.requestRender();
	}

	handleInput(data: string): void {
		if (matchesKey(data, "tab")) {
			this.nav.cycle(1);
			return;
		}
		if (matchesKey(data, "shift+tab")) {
			this.nav.cycle(-1);
			return;
		}
		if (matchesKey(data, "escape")) {
			this.onClose(true);
			return;
		}
		if (matchesKey(data, "up") || matchesKey(data, "k")) {
			this.scrollBy(-1);
			return;
		}
		if (matchesKey(data, "down") || matchesKey(data, "j")) {
			this.scrollBy(1);
			return;
		}
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const page = Math.max(1, rows - 4);
		if (matchesKey(data, "pageUp")) {
			this.scrollBy(-page);
			return;
		}
		if (matchesKey(data, "pageDown")) {
			this.scrollBy(page);
			return;
		}
		if (matchesKey(data, "home")) {
			this.scrollBy(-this.maxScroll);
			return;
		}
		if (matchesKey(data, "end")) {
			this.scrollBy(this.maxScroll);
		}
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type === "wheel") {
			const delta = Math.trunc(event.wheelDelta ?? 0);
			if (delta === 0) return undefined;
			this.scrollOffset = Math.max(0, Math.min(this.maxScroll, this.scrollOffset + delta));
			return { handled: true };
		}
		if (event.button !== "left" || event.y !== 0) return undefined;
		if (event.x < Math.max(0, event.width - 3)) return undefined;
		if (event.type === "press") return { handled: true, render: false };
		if (event.type !== "click") return undefined;
		this.onClose(false);
		return { handled: true };
	}

	render(width: number): string[] {
		if (width <= 0) return [];
		const file = this.getActiveFile();
		if (!file) return [];
		const theme = this.getTheme();
		this.refreshIfNeeded(theme);
		if (this.lastWidth !== width) this.buildDisplay(theme, width);

		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		const fillWidth = Math.max(0, width - 1);
		const contentRows = Math.max(0, rows - 2);
		this.maxScroll = Math.max(0, this.display.length - contentRows);
		this.scrollOffset = Math.max(0, Math.min(this.scrollOffset, this.maxScroll));
		const header = this.header(theme, fillWidth, this.display.length > contentRows);
		const edge = this.matte(theme, theme.fg("borderMuted", "│"));
		const rule = this.matte(theme, theme.fg("border", "─".repeat(Math.max(0, fillWidth)) + "┤"));
		const visible = this.display.slice(this.scrollOffset, this.scrollOffset + contentRows);
		while (visible.length < contentRows) visible.push(this.matte(theme, " ".repeat(fillWidth)));
		const lines = [header + edge, rule];
		for (const line of visible) lines.push(line + edge);
		return lines;
	}
}

/* ------------------------------------------------------------------ footer */

interface FooterDataLike {
	getGitBranch(): string | null;
	getExtensionStatuses(): ReadonlyMap<string, string>;
}

type ColorValue = Parameters<typeof mixColors>[0];

function sanitizeStatus(text: string): string {
	return text.replace(/[\r\n\t]/g, " ").replace(/ +/g, " ").trim();
}

/** One-line sci-fi HUD spanning the chat column, directly under the editor. */
class EtherFooter implements Component {
	private readonly tui: TUI;
	private readonly getCtx: () => ExtensionContextLike | undefined;
	private readonly getTheme: () => ThemeLike;
	private readonly getRails: () => { left: boolean; right: boolean };
	private readonly data: FooterDataLike;

	constructor(
		tui: TUI,
		getCtx: () => ExtensionContextLike | undefined,
		getTheme: () => ThemeLike,
		getRails: () => { left: boolean; right: boolean },
		data: FooterDataLike,
	) {
		this.tui = tui;
		this.getCtx = getCtx;
		this.getTheme = getTheme;
		this.getRails = getRails;
		this.data = data;
	}

	invalidate(): void {
		// no cache: the ticker re-renders the whole HUD
	}

	render(width: number): string[] {
		const theme = this.getTheme();
		const w = Math.max(1, width);
		const borderBase = theme.colors?.borderMuted as ColorValue | undefined;
		const borderBackground = theme.colors?.toolPendingBg as ColorValue | undefined;
		const footerBorder = borderBase && borderBackground ? mixColors(borderBase, borderBackground, 0.24) : undefined;
		const border = (text: string) =>
			footerBorder ? theme.style(text, { fg: footerBorder }) : theme.fg("borderMuted", text);
		const rails = this.getRails();
		const leftCap = rails.left ? "├─" : "┌─";
		const rightCap = rails.right ? "─┤" : "─┐";
		const bracket = (text: string) => `${border("[")}${text}${border("]")}`;
		const field = (name: string, value: string) => bracket(`${theme.fg("muted", name)} ${value}`);
		const stat = (name: string, value: string) => `${theme.fg("muted", name)} ${value}`;
		const ctx = this.getCtx();
		const busy = ctx?.isIdle ? !ctx.isIdle() : false;
		const left: string[] = [bracket(theme.fg("muted", "SYS"))];

		left.push(bracket(`${activityGlyph(theme, busy)} ${theme.fg(busy ? "accent" : "success", busy ? "WORK" : "READY")}`));

		let stats: SessionStats | undefined;
		try {
			stats = ctx ? readStats(ctx) : undefined;
		} catch {
			stats = undefined;
		}

		const usage = (() => {
			try {
				return ctx?.getContextUsage?.();
			} catch {
				return undefined;
			}
		})();

		const right: string[] = [];
		if (usage && usage.percent !== null && usage.percent !== undefined) {
			const window = usage.contextWindow || ctx?.model?.contextWindow || 0;
			right.push(field("CTX", toolBlueText(theme, `${usage.percent.toFixed(1)}%/${formatTokens(window)}`)));
		} else if (ctx?.model?.contextWindow) {
			right.push(field("CTX", toolBlueText(theme, `?/${formatTokens(ctx.model.contextWindow)}`)));
		}

		if (stats?.cacheHit !== undefined && (stats.totals.cacheRead > 0 || stats.totals.cacheWrite > 0)) {
			right.push(field("CH", toolBlueText(theme, `${stats.cacheHit.toFixed(0)}%`)));
		}

		const details: string[] = [];
		try {
			if (ctx?.cwd) details.push(stat("CWD", theme.fg("dim", shortenPath(ctx.cwd, 16))));
		} catch {
			// ignore
		}
		if (ctx?.model?.provider) details.push(stat("PROV", theme.fg("dim", ctx.model.provider)));
		const branch = this.data.getGitBranch();
		if (branch) details.push(stat("BR", theme.fg("dim", branch)));
		try {
			const name = ctx?.sessionManager.getSessionName();
			if (name) details.push(stat("SESS", theme.fg("dim", name)));
		} catch {
			// ignore
		}
		const statuses = Array.from(this.data.getExtensionStatuses().entries())
			.map(([key, text]) => `${key}: ${sanitizeStatus(text)}`)
			.filter((text) => !text.endsWith(":"));
		if (statuses.length > 0) details.push(stat("STS", theme.fg("dim", statuses.join(" · "))));

		const buildTop = () => {
			const l = `${border(leftCap)}${left.join(border("─"))}${border("─")}`;
			const r = right.length > 0 ? `${right.join(border("─"))}${border(rightCap)}` : border(rails.right ? "┤" : "┐");
			return { l, r, used: visibleWidth(l) + visibleWidth(r) };
		};

		let top = buildTop();
		while (left.length > 2 && top.used > w) {
			left.pop();
			top = buildTop();
		}
		while (right.length > 0 && top.used > w) {
			right.pop();
			top = buildTop();
		}
		while (left.length > 1 && top.used > w) {
			left.pop();
			top = buildTop();
		}
		const topLine =
			top.used > w
				? truncateToWidth(top.l + top.r, w, "")
				: top.l + border("─".repeat(Math.max(0, w - top.used))) + top.r;

		const metrics: string[] = [];
		if (stats && (stats.totals.input || stats.totals.output)) {
			metrics.push(stat("TOK", theme.fg("dim", `↑${formatTokens(stats.totals.input)} ↓${formatTokens(stats.totals.output)}`)));
		}
		if (stats) metrics.push(stat("COST", toolBlueText(theme, formatCost(stats.totals.cost))));
		if (ctx?.model?.id) {
			const thinking = ctx.model.reasoning && ctx.thinkingLevel ? ` · ${ctx.thinkingLevel}` : "";
			metrics.push(stat("MODEL", theme.fg("dim", `${ctx.model.id}${thinking}`)));
		}
		try {
			if (ctx?.hasPendingMessages?.()) metrics.push(stat("QUEUE", theme.fg("warning", "pending")));
		} catch {
			// ignore
		}
		metrics.push(stat("UP", theme.fg("dim", formatDuration(Date.now() - startedAt))));
		if (stats?.messages) metrics.push(stat("MSG", theme.fg("dim", `${stats.messages}`)));
		if (stats?.tools) metrics.push(stat("TOOL", theme.fg("dim", `${stats.tools}`)));

		const inner = Math.max(0, w - 4);
		const renderContentRow = (parts: string[]) => {
			while (parts.length > 1 && visibleWidth(parts.join("  ")) > inner) parts.pop();
			let content = parts.join("  ");
			if (visibleWidth(content) > inner) content = truncateToWidth(content, inner, "");
			return `${border("│")} ${content}${ " ".repeat(Math.max(0, inner - visibleWidth(content)))} ${border("│")}`;
		};

		const detailsLine = renderContentRow(details);
		const metricsLine = renderContentRow(metrics);
		const bottomLine = border(`└${"─".repeat(Math.max(0, w - 2))}┘`);

		return [topLine, detailsLine, metricsLine, bottomLine];
	}
}

/* ------------------------------------------------------------------ install */

/** Minimal shapes for the provider-neutral stream the side chat consumes. */
interface ChatModelLike {
	provider: string;
	id: string;
	contextWindow?: number;
}

interface ChatStreamEventLike {
	type: string;
	delta?: string;
	error?: { errorMessage?: string };
	toolCall?: ChatToolCallLike;
}

interface ChatStreamLike extends AsyncIterable<ChatStreamEventLike> {
	result(): Promise<unknown>;
}

interface LiveChrome {
	tui?: TUI;
	ctx?: ExtensionContextLike;
	theme?: ThemeLike;
	ticker?: ReturnType<typeof setInterval>;
	sidebarsCollapsed?: boolean;
	chatCollapsed?: boolean;
	activeFile?: string | null;
	chatModel?: ChatModelRef | null;
	chatSidebar?: { syncVisibility(): void };
	railNav?: RailNav;
	focusRail?: (kind: RailKind) => void;
	toggleLayout?: () => void;
}

/** A model chosen for the side chat. Providers are resolved at call time. */
interface ChatModelRef {
	provider: string;
	id: string;
}

function installChrome(live: LiveChrome): void {
	const tui = live.tui;
	if (!tui) return;
	const t = tui as unknown as TUI & {
		setLayoutRoot?: (component: Component | undefined) => void;
		layoutRoot?: Component;
		__etherChromeOwner?: unknown;
		__etherBaseRoot?: Component;
	};
	// Take the prototype method so a previous install's instance patch is bypassed.
	const proto = Object.getPrototypeOf(t) as { setLayoutRoot?: (c: Component | undefined) => void } | null;
	if (typeof proto?.setLayoutRoot !== "function") return; // regular mode renderer
	// Reinstall whenever a new extension runtime drives the same renderer (/reload).
	// A version number is not enough: the old components keep a stale, invalidated ctx.
	if (t.__etherChromeOwner === live) return;

	const original = proto.setLayoutRoot.bind(t);
	// Older versions wrapped as HStack([rail, appRoot]); adopt the inner root instead of nesting.
	const unwrap = (candidate: Component | undefined): Component | undefined => {
		const stack = candidate as unknown as { entries?: { component: Component }[] } | undefined;
		const entries = stack?.entries;
		if (!entries?.length) return candidate;
		const isRail = (component: Component | undefined): boolean => {
			const name = component?.constructor?.name;
			return name === "EtherSidebar" || name === "EtherFilesSidebar" || name === "EtherChatSidebar" || name === "EtherPreviewSidebar";
		};
		if (isRail(entries[0]?.component)) return entries.find((entry) => !isRail(entry.component))?.component ?? candidate;
		return candidate;
	};
	// Keep the app's own root so a later reinstall swaps the chrome instead of nesting it.
	const baseRoot = t.__etherBaseRoot ?? unwrap(t.layoutRoot);
	t.__etherBaseRoot = baseRoot;
	t.__etherChromeOwner = live;

	const getTheme = (): ThemeLike => {
		try {
			return live.ctx?.ui?.theme ?? live.theme!;
		} catch {
			return live.theme!;
		}
	};
	const getCtx = () => live.ctx;

	const getActiveFile = () => live.activeFile ?? null;
	const setActiveFile = (file: string | null): void => {
		live.activeFile = file;
		if (baseRoot) t.setLayoutRoot(baseRoot);
	};

	// Focus coordination is shared by every rail. The editor focus is captured once on
	// entry, so esc from any rail always returns to the main editor.
	let taskbarSidebar: EtherSidebar | null = null;
	let filesSidebar: EtherFilesSidebar | null = null;
	let chatSidebar: EtherChatSidebar | null = null;
	let previewSidebar: EtherPreviewSidebar | null = null;
	let editorFocus: Component | null = null;

	const isRail = (component: Component | null | undefined): boolean =>
		!!component &&
		(component === taskbarSidebar ||
			component === filesSidebar ||
			component === chatSidebar ||
			component === previewSidebar);

	const focusedComponent = (): Component | null =>
		(tui as unknown as { getFocusedComponent?: () => Component | null }).getFocusedComponent?.() ?? null;
	const focusComponent = (component: Component | null): void => {
		(tui as unknown as { setFocus?: (target: Component | null) => void }).setFocus?.(component);
	};

	const railVisible = (rail: Component | null): boolean => {
		if (!rail) return false;
		const width = tui.terminal?.columns ?? 0;
		if (rail === taskbarSidebar) return true;
		if (live.sidebarsCollapsed) return false;
		if (rail === chatSidebar) return !live.chatCollapsed && width >= CHAT_MIN_TERMINAL;
		if (rail === previewSidebar) return !!live.activeFile && width >= PREVIEW_MIN_TERMINAL;
		if (rail === filesSidebar) {
			const previewVisible = !!live.activeFile && width >= PREVIEW_MIN_TERMINAL;
			return width >= FILES_MIN_TERMINAL && !previewVisible;
		}
		return false;
	};

	const railOrder = (): Component[] => {
		const order: Component[] = [];
		if (taskbarSidebar) order.push(taskbarSidebar);
		if (previewSidebar && railVisible(previewSidebar)) order.push(previewSidebar);
		if (filesSidebar && railVisible(filesSidebar)) order.push(filesSidebar);
		if (chatSidebar && railVisible(chatSidebar)) order.push(chatSidebar);
		return order;
	};

	const nav: RailNav = {
		captureEditor(): void {
			const focused = focusedComponent();
			if (!isRail(focused)) editorFocus = focused;
		},
		enter(target: Component): void {
			nav.captureEditor();
			if (!railVisible(target)) return;
			focusComponent(target);
			tui.requestRender();
		},
		leave(): void {
			focusComponent(editorFocus);
			tui.requestRender();
		},
		cycle(delta: number): void {
			const order = railOrder();
			if (order.length === 0) return;
			const focused = focusedComponent();
			const current = focused ? order.indexOf(focused) : -1;
			const step = delta >= 0 ? 1 : -1;
			const next =
				current < 0
					? step > 0
						? 0
						: order.length - 1
					: (current + step + order.length) % order.length;
			nav.enter(order[next]!);
		},
		ensureFocusVisible(): void {
			const focused = focusedComponent();
			if (focused && isRail(focused) && !railVisible(focused)) nav.leave();
		},
	};
	live.railNav = nav;

	const notify = (message: string): void => {
		try {
			live.ctx?.ui?.notify?.(message, "info");
		} catch {
			// a notification is a hint, not a dependency
		}
	};

	/** Open/close a file. Keyboard opens move focus into the preview; mouse opens do not. */
	const openFile = (file: string, viaKeyboard: boolean): void => {
		const opening = live.activeFile !== file;
		setActiveFile(opening ? file : null);
		if (!viaKeyboard || !opening) return;
		if (live.sidebarsCollapsed) {
			notify("preview needs the side rails — press alt+l");
			return;
		}
		if ((tui.terminal?.columns ?? 0) >= PREVIEW_MIN_TERMINAL && previewSidebar) {
			nav.enter(previewSidebar);
			return;
		}
		notify(`preview needs at least ${PREVIEW_MIN_TERMINAL} columns`);
	};

	const toggleLayout = (): void => {
		const focused = focusedComponent();
		live.sidebarsCollapsed = !live.sidebarsCollapsed;
		if (baseRoot) t.setLayoutRoot(baseRoot);
		if (focused && isRail(focused) && !railVisible(focused)) nav.leave();
		tui.requestRender();
	};
	live.toggleLayout = toggleLayout;

	/** Toggle only the side chat, based on whether it is actually visible right now. */
	const toggleChat = (): void => {
		const focused = focusedComponent();
		const width = tui.terminal?.columns ?? 0;
		const chatVisible = !live.sidebarsCollapsed && !live.chatCollapsed && width >= CHAT_MIN_TERMINAL;
		if (chatVisible) {
			live.chatCollapsed = true;
		} else {
			if (width < CHAT_MIN_TERMINAL) {
				notify(`chat needs at least ${CHAT_MIN_TERMINAL} columns`);
				return;
			}
			live.chatCollapsed = false;
			// AI brings the chat back even when all rails were hidden with ◫.
			live.sidebarsCollapsed = false;
		}
		if (baseRoot) t.setLayoutRoot(baseRoot);
		if (focused && isRail(focused) && !railVisible(focused)) nav.leave();
		tui.requestRender();
	};

	const handleTaskbarAction = (action: TaskbarAction): void => {
		if (action === "chat") toggleChat();
		else toggleLayout();
	};
	const handleInertIcon = (item: TaskbarIcon): void => {
		notify(`${item.label} is not wired yet`);
	};

	const focusRailByName = (kind: RailKind): void => {
		const width = tui.terminal?.columns ?? 0;
		if (kind === "preview" && !live.activeFile) {
			notify("preview: no file open — choose one in Files");
			return;
		}
		if (kind === "files" && live.activeFile && width >= PREVIEW_MIN_TERMINAL) {
			notify("Files is hidden while the preview is open — esc closes it");
			return;
		}
		if (kind === "chat" && width < CHAT_MIN_TERMINAL) {
			notify(`chat needs at least ${CHAT_MIN_TERMINAL} columns`);
			return;
		}
		if (kind === "files" && width < FILES_MIN_TERMINAL) {
			notify(`Files needs at least ${FILES_MIN_TERMINAL} columns`);
			return;
		}
		if (kind === "preview" && width < PREVIEW_MIN_TERMINAL) {
			notify(`preview needs at least ${PREVIEW_MIN_TERMINAL} columns`);
			return;
		}
		let changed = false;
		if (kind === "chat" && live.chatCollapsed) {
			live.chatCollapsed = false;
			changed = true;
		}
		if (kind !== "taskbar" && live.sidebarsCollapsed) {
			live.sidebarsCollapsed = false;
			changed = true;
		}
		if (changed && baseRoot) t.setLayoutRoot(baseRoot);
		const target =
			kind === "taskbar"
				? taskbarSidebar
				: kind === "files"
					? filesSidebar
					: kind === "preview"
						? previewSidebar
						: chatSidebar;
		if (!target || !railVisible(target)) {
			notify(`${kind}: rail is not available`);
			return;
		}
		nav.enter(target);
	};
	live.focusRail = focusRailByName;

	// Created once per install so tree expansion and scroll survive layout toggles.
	filesSidebar = new EtherFilesSidebar(tui, getCtx, getTheme, getActiveFile, openFile, nav);
	chatSidebar = new EtherChatSidebar(
		tui,
		getTheme,
		() => live.ctx,
		() => live.chatModel ?? null,
		() => !live.sidebarsCollapsed && !live.chatCollapsed && (tui.terminal?.columns ?? 0) >= CHAT_MIN_TERMINAL,
		nav,
	);
	live.chatSidebar = chatSidebar;
	previewSidebar = new EtherPreviewSidebar(
		tui,
		getTheme,
		getCtx,
		getActiveFile,
		(viaKeyboard: boolean) => {
			const hadFocus = previewSidebar?.focused === true;
			setActiveFile(null);
			if (!viaKeyboard && !hadFocus) return;
			if (!live.sidebarsCollapsed && (tui.terminal?.columns ?? 0) >= FILES_MIN_TERMINAL && filesSidebar) {
				nav.enter(filesSidebar);
			} else {
				nav.leave();
			}
		},
		nav,
	);
	taskbarSidebar = new EtherSidebar(tui, getTheme, "left", nav, true, handleTaskbarAction, handleInertIcon);

	const wrap = (root: Component): Component => {
		const chatColumn = new VStack([
			{ component: new EtherHeader(getCtx, getTheme), basis: HEADER_ROWS, grow: 0, shrink: 0, minSize: HEADER_ROWS },
			{ component: root, basis: 0, grow: 1, shrink: 1, minSize: 1 },
		]);
		const filesRail = {
			// LeftSidebarB: the Files tree; hidden while RightsidebarB is actually visible.
			component: filesSidebar!,
			basis: SIDEBAR_WIDTH,
			grow: 0,
			shrink: 0,
			minSize: 0,
			visible: (viewport: { width: number }) => {
				const previewVisible = !!live.activeFile && viewport.width >= PREVIEW_MIN_TERMINAL;
				return viewport.width >= FILES_MIN_TERMINAL && !previewVisible;
			},
		};
		const chatRail = {
			// RightsidebarA (RightSidebarA): fixed 40-col side chat, 36 while the preview is open.
			component: chatSidebar!,
			basis: live.activeFile ? CHAT_SIDEBAR_COMPACT_WIDTH : CHAT_SIDEBAR_WIDTH,
			grow: 0,
			shrink: 0,
			minSize: 0,
			visible: (viewport: { width: number }) =>
				!live.chatCollapsed && viewport.width >= CHAT_MIN_TERMINAL,
		};
		const previewRail = {
			// RightsidebarB: file preview, now in the left slot where Files lives.
			component: previewSidebar!,
			basis: PREVIEW_SIDEBAR_WIDTH,
			grow: 0,
			shrink: 0,
			minSize: 0,
			visible: (viewport: { width: number }) => !!live.activeFile && viewport.width >= PREVIEW_MIN_TERMINAL,
		};
		// Side rails toggle with ◫; LeftSidebarA always survives. The AI icon toggles chat alone.
		const showRails = !live.sidebarsCollapsed;
		const showChat = showRails && !live.chatCollapsed;
		return new HStack([
			{
				// LeftSidebarA: far-left taskbar, always visible even when the other rails hide.
				component: taskbarSidebar!,
				basis: LEFT_SIDEBAR_A_WIDTH,
				grow: 0,
				shrink: 0,
				minSize: 0,
			},
			// Preview takes the Files slot; only one of them is ever visible.
			...(showRails && live.activeFile ? [previewRail] : []),
			...(showRails ? [filesRail] : []),
			{ component: chatColumn, basis: 0, grow: 1, shrink: 1, minSize: 1 },
			...(showChat ? [chatRail] : []),
		]);
	};

	t.setLayoutRoot = (root) => {
		if (root) t.__etherBaseRoot = root;
		original(root ? wrap(root) : undefined);
	};
	if (baseRoot) t.setLayoutRoot(baseRoot);
}

/**
 * Scrollable model picker. Pi's stock extension selector renders every option and
 * only listens for arrow keys, so long model lists overflow with no way to reach
 * the rest. This one keeps a viewport, follows the selection, and handles wheel.
 */
class ChatModelPicker implements Component {
	private index = 0;
	private offset = 0;

	constructor(
		private readonly tui: TUI,
		private readonly theme: ThemeLike,
		private readonly options: readonly string[],
		private readonly finish: (choice: string | null) => void,
	) {}

	private viewport(): number {
		const rows = Math.max(1, this.tui.terminal?.rows ?? 24);
		return Math.max(3, Math.min(12, rows - 14));
	}

	private clamp(): void {
		const visible = this.viewport();
		this.index = Math.max(0, Math.min(this.options.length - 1, this.index));
		if (this.index < this.offset) this.offset = this.index;
		if (this.index >= this.offset + visible) this.offset = this.index - visible + 1;
		this.offset = Math.max(0, Math.min(this.offset, Math.max(0, this.options.length - visible)));
	}

	handleInput(data: string): void {
		if (data === "\x1b" || data === "\x03") {
			this.finish(null);
			return;
		}
		if (data === "\r" || data === "\n") {
			this.finish(this.options[this.index] ?? null);
			return;
		}
		const page = Math.max(1, this.viewport() - 1);
		if (data === "\x1b[A" || data === "k") this.index -= 1;
		else if (data === "\x1b[B" || data === "j") this.index += 1;
		else if (data === "\x1b[5~") this.index -= page;
		else if (data === "\x1b[6~") this.index += page;
		else if (data === "\x1b[H" || data === "g") this.index = 0;
		else if (data === "\x1b[F" || data === "G") this.index = this.options.length - 1;
		else return;
		this.clamp();
	}

	handleMouse(event: TuiMouseEvent): TuiMouseEventResult | undefined {
		if (event.type !== "wheel") return undefined;
		const delta = Math.trunc(event.wheelDelta ?? 0);
		if (delta === 0) return undefined;
		this.index += delta;
		this.clamp();
		return { handled: true };
	}

	render(width: number): string[] {
		const theme = this.theme;
		const total = this.options.length;
		const inner = Math.max(1, width - 2);
		const border = (text: string) => theme.fg("borderMuted", text);
		const pad = (text: string) => text + " ".repeat(Math.max(0, inner - visibleWidth(text)));

		const title = " SIDE MODEL ";
		const top =
			border("┌─[") +
			theme.fg("dim", title) +
			border("]") +
			border("─".repeat(Math.max(0, inner - title.length - 3))) +
			border("┐");

		const visible = Math.min(this.viewport(), total);
		this.offset = Math.max(0, Math.min(this.offset, Math.max(0, total - visible)));
		const rows: string[] = [];
		for (let row = 0; row < visible; row++) {
			const index = this.offset + row;
			const option = this.options[index] ?? "";
			const line =
				index === this.index
					? theme.fg("toolTitle", "→ ") + theme.fg("accent", option)
					: "  " + theme.fg("text", option);
			rows.push(border("│") + pad(" " + line) + border("│"));
		}
		while (rows.length < this.viewport()) rows.push(border("│") + " ".repeat(inner) + border("│"));

		const rule = border("├" + "─".repeat(inner) + "┤");
		const position = total > visible ? `${this.index + 1}/${total} ↕` : `${total} models`;
		const hint = ` ${theme.fg("dim", position)}${theme.fg("dim", "  ↑↓ wheel  ⏎  esc ")}`;
		const hintRow = border("│") + pad(hint) + border("│");
		const bottom = border("└" + "─".repeat(inner) + "┘");
		return [top, ...rows, rule, hintRow, bottom];
	}
}

function compactCount(value: number): string {
	if (value >= 1_000_000) {
		const millions = value / 1_000_000;
		return `${Number.isInteger(millions) ? millions : millions.toFixed(1)}M`;
	}
	if (value >= 1_000) return `${Math.round(value / 1_000)}k`;
	return String(value);
}

/** Read the persisted side-chat model. Missing or malformed config means "none chosen". */
function readChatConfig(): ChatModelRef | null {
	try {
		const raw = JSON.parse(readFileSync(CHAT_CONFIG_PATH, "utf8")) as { provider?: unknown; model?: unknown };
		if (typeof raw.provider === "string" && typeof raw.model === "string") {
			return { provider: raw.provider, id: raw.model };
		}
	} catch {
		// no config yet
	}
	return null;
}

function writeChatConfig(model: ChatModelRef): void {
	try {
		mkdirSync(dirname(CHAT_CONFIG_PATH), { recursive: true });
		const body = JSON.stringify({ provider: model.provider, model: model.id }, null, 2);
		writeFileSync(CHAT_CONFIG_PATH, `${body}\n`, "utf8");
	} catch {
		// config is a convenience; the current runtime keeps its in-memory choice
	}
}

function dayStamp(date = new Date()): string {
	return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function clockStamp(date = new Date()): string {
	return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

/** Append one turn to today's Markdown log. Best-effort: a failure never blocks the chat. */
function appendChatEntry(role: ChatBubble["role"], text: string): void {
	const body = text.trim();
	if (!body) return;
	try {
		mkdirSync(CHAT_HISTORY_DIR, { recursive: true });
		const file = join(CHAT_HISTORY_DIR, `${dayStamp()}.md`);
		if (!existsSync(file)) writeFileSync(file, `# Side chat — ${dayStamp()}\n`, "utf8");
		appendFileSync(file, `\n## ${clockStamp()} · ${role}\n\n${body}\n`, "utf8");
	} catch {
		// history is best-effort
	}
}

/** Parse today's Markdown log back into plain turns. Tool activity is not stored. */
function readChatDay(): ChatBubble[] {
	return readChatLog(dayStamp());
}

/** Parse any day's Markdown log. Tool activity is not stored. */
function readChatLog(date: string): ChatBubble[] {
	try {
		const file = join(CHAT_HISTORY_DIR, `${date}.md`);
		if (!existsSync(file)) return [];
		const lines = readFileSync(file, "utf8").replace(/\r\n?/g, "\n").split("\n");
		const turns: ChatBubble[] = [];
		let current: ChatBubble | null = null;
		const flush = () => {
			if (!current) return;
			const text = current.text.replace(/\n{3,}/g, "\n\n").trim();
			if (text) turns.push({ role: current.role, text });
		};
		for (const line of lines) {
			const match = /^## \d{2}:\d{2} · (you|ether)$/.exec(line.trim());
			if (match) {
				flush();
				current = { role: match[1] as ChatBubble["role"], text: "" };
				continue;
			}
			if (current) current.text += `${line}\n`;
		}
		flush();
		return turns;
	} catch {
		return [];
	}
}

interface ChatDayInfo {
	date: string;
	turns: number;
}

/** List saved days, newest first. */
function listChatDays(): ChatDayInfo[] {
	try {
		return readdirSync(CHAT_HISTORY_DIR)
			.filter((name) => /^\d{4}-\d{2}-\d{2}\.md$/.test(name))
			.sort()
			.reverse()
			.map((name) => ({
				date: name.slice(0, -3),
				turns: readChatLog(name.slice(0, -3)).length,
			}));
	} catch {
		return [];
	}
}

function runReadHistory(args: Record<string, unknown>): SideToolOutcome {
	const requested = typeof args.date === "string" ? args.date.trim() : "";
	const days = listChatDays();
	if (!requested) {
		if (days.length === 0) return { text: "no saved side-chat days yet", isError: false };
		const listing = days.slice(0, 30).map((day) => `${day.date} — ${day.turns} turns`).join("\n");
		return { text: `saved days (newest first):\n${listing}`, isError: false };
	}
	if (!/^\d{4}-\d{2}-\d{2}$/.test(requested)) {
		return { text: "date must be YYYY-MM-DD", isError: true };
	}
	const turns = readChatLog(requested);
	if (turns.length === 0) {
		const known = days.map((day) => day.date).join(", ") || "none";
		return { text: `no turns saved for ${requested}; available: ${known}`, isError: true };
	}
	const text = turns.map((turn) => `## ${turn.role}\n\n${turn.text}`).join("\n\n");
	return { text: webClip(`# ${requested}\n\n${text}`, 20_000), isError: false };
}

export default function etherChrome(pi: ExtensionAPI): void {
	const live: LiveChrome = {};

	// Global rail shortcuts. Pi only dispatches extension shortcuts from the main editor,
	// so every rail also handles its own keys once focused (tab/esc inside the rail).
	const registerShortcut = (
		pi as unknown as {
			registerShortcut?: (key: string, options: { description: string; handler: () => void }) => void;
		}
	).registerShortcut;
	if (registerShortcut) {
		const bind = (key: string, description: string, handler: () => void) =>
			registerShortcut.call(pi, key, { description, handler });
		bind(Key.alt("1"), "Focus the taskbar", () => live.focusRail?.("taskbar"));
		bind(Key.alt("2"), "Focus the Files rail", () => live.focusRail?.("files"));
		bind(Key.alt("3"), "Focus the file preview", () => live.focusRail?.("preview"));
		bind(Key.alt("4"), "Focus the side chat", () => live.focusRail?.("chat"));
		bind(Key.alt("l"), "Toggle the side rails", () => live.toggleLayout?.());
	}

	pi.registerCommand("chat-model", {
		description: "Choose the model for the side chat (logged-in providers only)",
		handler: async (args, ctx) => {
			const available = ctx.modelRegistry
				.getAvailable()
				.map((model) => ({ provider: model.provider, id: model.id }))
				.sort((a, b) => a.provider.localeCompare(b.provider) || a.id.localeCompare(b.id));
			if (available.length === 0) {
				ctx.ui.notify("No logged-in models available. Sign in to a provider first.", "error");
				return;
			}

			const labels = available.map((model) => `${model.provider}/${model.id}`);
			const wanted = args.trim();
			let choice: string | undefined;
			if (wanted) {
				const lower = wanted.toLowerCase();
				choice =
					labels.find((label) => label.toLowerCase() === lower) ??
					labels.find((label) => available[labels.indexOf(label)]?.id.toLowerCase() === lower);
				if (!choice && /^\d+$/.test(wanted)) choice = labels[Number(wanted) - 1];
				if (!choice) {
					ctx.ui.notify(`No logged-in model matches "${wanted}".`, "error");
					return;
				}
			} else if (ctx.mode === "tui" && typeof ctx.ui.custom === "function") {
				const picked = await ctx.ui.custom<string | null>(
					(tui, theme, _keybindings, done) => new ChatModelPicker(tui, theme, labels, done),
					{ overlay: true, overlayOptions: { width: 46, maxHeight: "80%", anchor: "center", margin: 1 } },
				);
				choice = picked ?? undefined;
			} else {
				choice = await ctx.ui.select("Side chat model", labels);
			}
			if (!choice) return;

			const index = labels.indexOf(choice);
			const selected = available[index];
			if (!selected) return;
			live.chatModel = selected;
			writeChatConfig(selected);
			live.tui?.requestRender();
			ctx.ui.notify(`Side chat model: ${choice}`, "info");
		},
	});

	pi.on("session_start", (_event, ctx) => {
		if (ctx.mode !== "tui") return;
		live.ctx = ctx as unknown as ExtensionContextLike;
		live.chatModel = readChatConfig();
		startedAt = Date.now();
		statsCache = undefined;

		ctx.ui.setWidget("ether-sidebar-boot", (tui, theme) => {
			live.tui = tui;
			live.theme = theme;
			installChrome(live);
			return new Empty();
		});

		ctx.ui.setFooter((tui, theme, footerData) =>
			new EtherFooter(
				tui,
				() => live.ctx,
				() => {
					try {
						return live.ctx?.ui?.theme ?? theme;
					} catch {
						return theme;
					}
				},
				() => {
					const width = tui.terminal?.columns ?? 0;
					const shown = !live.sidebarsCollapsed;
					const previewVisible = !!live.activeFile && width >= PREVIEW_MIN_TERMINAL;
					return {
						left: shown && (previewVisible || width >= FILES_MIN_TERMINAL),
						right: shown && !live.chatCollapsed && width >= CHAT_MIN_TERMINAL,
					};
				},
				footerData,
			),
		);

		// Animation clock: the header re-renders every tick, and only while a TUI exists.
		if (!live.ticker) {
			live.ticker = setInterval(() => {
				tick += 1;
				live.chatSidebar?.syncVisibility();
				live.railNav?.ensureFocusVisible();
				live.tui?.requestRender();
			}, TICK_MS);
		}
	});

	// Keep the header honest: refresh whenever the values it shows can change.
	const refresh = (_event: unknown, ctx: unknown) => {
		live.ctx = ctx as ExtensionContextLike;
		live.tui?.requestRender();
	};
	const anyPi = pi as unknown as { on(event: string, handler: (event: unknown, ctx: unknown) => void): void };
	for (const event of [
		"model_select",
		"thinking_level_select",
		"message_start",
		"message_end",
		"turn_end",
		"agent_end",
		"agent_settled",
		"tool_execution_end",
		"session_compact",
		"session_info_changed",
	]) {
		anyPi.on(event, refresh);
	}

	anyPi.on("session_shutdown", () => {
		if (live.ticker) clearInterval(live.ticker);
		live.ticker = undefined;
		try {
			live.ctx?.ui?.setFooter?.(undefined);
		} catch {
			// ignore
		}
	});
}
