/**
 * Ether QA subagent: the only extension loaded by the QA runner.
 *
 * It registers a private Playwright MCP server and exposes a small, browser-only
 * tool set. The parent chrome never loads this file; it is passed to the child
 * with `-e` so the QA persona cannot read files, edit the workspace, or run bash.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { resolve, sep } from "node:path";
import { Type } from "typebox";

/** Server name inside the child only. Tools are `mcp__ether_qa__browser_*`. */
const SERVER = "ether_qa";
const TOOL_PREFIX = `mcp__${SERVER}__`;

/** The safe subset. Evaluate is reachable only from the fixed Flutter helper. */
export const QA_TOOL_EXPOSURE: Record<string, "direct" | "codemode"> = {
	browser_navigate: "direct",
	browser_snapshot: "direct",
	browser_find: "direct",
	browser_click: "direct",
	browser_type: "direct",
	browser_fill_form: "direct",
	browser_press_key: "direct",
	browser_select_option: "direct",
	browser_hover: "direct",
	browser_wait_for: "direct",
	browser_handle_dialog: "direct",
	browser_console_messages: "direct",
	browser_network_requests: "direct",
	browser_take_screenshot: "direct",
	browser_close: "direct",
	browser_evaluate: "codemode",
};

function isLoopbackHost(host: string): boolean {
	const value = host.toLowerCase();
	return value === "localhost" || value === "127.0.0.1" || value === "::1" || value === "[::1]";
}

/** True for http(s) loopback URLs, the supplied host, or one of its subdomains. */
export function isAllowedNavigation(raw: unknown, initialOrigin?: string): boolean {
	if (typeof raw !== "string" || raw.trim() === "") return false;
	let url: URL;
	try {
		url = new URL(raw, initialOrigin);
	} catch {
		return false;
	}
	if (url.protocol !== "http:" && url.protocol !== "https:") return false;
	const host = url.hostname.toLowerCase();
	if (!initialOrigin) return isLoopbackHost(host);
	let initial: URL;
	try {
		initial = new URL(initialOrigin);
	} catch {
		return false;
	}
	const initialHost = initial.hostname.toLowerCase();
	// A local app may not browse public sites, and a public task may not probe
	// services on this machine through loopback.
	if (isLoopbackHost(initialHost)) return isLoopbackHost(host);
	if (isLoopbackHost(host)) return false;
	const base = initialHost.replace(/^www\./, "");
	return host === initialHost || host === base || host.endsWith(`.${base}`);
}

function maxActions(): number {
	const parsed = Number(process.env.ETHER_QA_MAX_ACTIONS ?? 120);
	return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 120;
}

export default function etherQaAgent(pi: ExtensionAPI): void {
	const initialOrigin = process.env.ETHER_QA_ORIGIN;
	const artifacts = process.env.ETHER_QA_ARTIFACTS;
	const args = [
		"-y",
		"@playwright/mcp@latest",
		"--headless",
		"--isolated",
		"--viewport-size",
		"1280x800",
	];
	// Windows ships Edge; the MCP server otherwise expects a Chrome installation.
	const browser =
		process.env.ETHER_QA_BROWSER ?? (process.platform === "win32" ? "msedge" : undefined);
	if (browser) args.push("--browser", browser);
	if (artifacts) args.push("--output-dir", artifacts);

	pi.registerMcpServer(SERVER, {
		command: "npx",
		args,
		...(artifacts ? { cwd: artifacts } : {}),
		exposure: "hidden",
		toolExposure: QA_TOOL_EXPOSURE,
		timeout: 120,
	});

	/**
	 * Flutter CanvasKit hides its semantics tree behind a 1x1 offscreen button.
	 * Playwright cannot click it (outside the viewport), so this fixed snippet does
	 * the click programmatically. No arbitrary JS is exposed to the model.
	 */
	const FLUTTER_SEMANTICS_SCRIPT = `async () => {
		const find = (root) => {
			const direct = root.querySelector && root.querySelector('flt-semantics-placeholder');
			if (direct) return direct;
			for (const element of root.querySelectorAll ? root.querySelectorAll('*') : []) {
				if (element.shadowRoot) {
					const nested = find(element.shadowRoot);
					if (nested) return nested;
				}
			}
			return null;
		};
		const deadline = Date.now() + 2000;
		while (Date.now() < deadline) {
			const placeholder = find(document);
			if (placeholder) {
				placeholder.click();
				await new Promise((resolve) => setTimeout(resolve, 400));
				return true;
			}
			await new Promise((resolve) => setTimeout(resolve, 100));
		}
		return false;
	}`;

	pi.registerTool({
		name: "enable_flutter_accessibility",
		label: "Enable Flutter accessibility",
		description:
			"Enable the accessibility tree of a Flutter web (CanvasKit) page. Use this when browser_snapshot only shows an 'Enable accessibility' button and no app content, then take a fresh snapshot.",
		parameters: Type.Object({}),
		executionMode: "sequential",
		async execute(_toolCallId, _params, _signal, _onUpdate, ctx) {
			const result = await ctx.executeTool(`${TOOL_PREFIX}browser_evaluate`, {
				function: FLUTTER_SEMANTICS_SCRIPT,
			});
			const content = result.result?.content;
			const text = Array.isArray(content)
				? content
						.map((part) => (part.type === "text" && typeof part.text === "string" ? part.text : ""))
						.join("\n")
				: "";
			const value = text.match(/###\s*Result\s*\n\s*([^\n]+)/i)?.[1]?.trim();
			const enabled = !result.isError && value === "true";
			return {
				content: [
					{
						type: "text",
						text: result.isError
							? `Could not enable Flutter accessibility: ${text || "the browser tool failed"}`
							: enabled
								? "Flutter accessibility enabled. Take a fresh browser_snapshot before continuing."
								: "No Flutter accessibility placeholder was found; the page is not a CanvasKit accessibility-gated app.",
					},
				],
				details: { enabled },
			};
		},
	});

	let calls = 0;
	const limit = maxActions();
	pi.on("tool_call", (event) => {
		if (!event.toolName.startsWith(TOOL_PREFIX)) return;
		calls += 1;
		if (calls > limit) {
			return { block: true, reason: `QA action limit (${limit}) reached` };
		}
		const input = event.input as { url?: unknown; filename?: unknown } | undefined;
		if (event.toolName === `${TOOL_PREFIX}browser_navigate`) {
			if (!isAllowedNavigation(input?.url, initialOrigin)) {
				return {
					block: true,
					reason: initialOrigin
						? "QA may only navigate inside the supplied site, its subdomains, or localhost"
						: "QA may only navigate to localhost",
				};
			}
		}
		// Explicit screenshot/snapshot filenames must stay inside the run directory.
		if (typeof input?.filename === "string" && input.filename.trim()) {
			if (!artifacts) return { block: true, reason: "QA has no artifact directory" };
			const artifactsRoot = resolve(artifacts);
			const target = resolve(artifactsRoot, input.filename);
			if (target !== artifactsRoot && !target.startsWith(artifactsRoot + sep)) {
				return { block: true, reason: "QA files must stay inside the run directory" };
			}
		}
		return undefined;
	});
}
