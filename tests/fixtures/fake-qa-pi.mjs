/**
 * Fake QA child for the rail harness. Emits the same JSONL envelope as
 * `pi --mode json`, without a model or a browser.
 */
import fs from "node:fs";

const argsFile = process.env.FAKE_QA_ARGS;
if (argsFile) {
	fs.writeFileSync(
		argsFile,
		JSON.stringify(
			{
				args: process.argv.slice(2),
				env: {
					ETHER_QA_ORIGIN: process.env.ETHER_QA_ORIGIN ?? null,
					ETHER_QA_ARTIFACTS: process.env.ETHER_QA_ARTIFACTS ?? null,
					ETHER_QA_MAX_ACTIONS: process.env.ETHER_QA_MAX_ACTIONS ?? null,
				},
			},
			null,
			2,
		),
	);
}

const mode = process.env.FAKE_QA_MODE ?? "ok";
const emit = (event) => process.stdout.write(`${JSON.stringify(event)}\n`);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const text = (value) => ({ type: "text", text: value });

const plan = "PLAN: 1. Open the app. 2. Find the signup link. 3. Click it.\nNEXT: open the app";
const afterOpen = "NEXT: click the signup link";
const report =
	"I opened the local app, found the signup link, and clicked it. The page responded with the expected welcome panel. I did not submit any real credentials.\nVERDICT: PASS";

async function ok() {
	emit({ type: "agent_start" });
	emit({ type: "message_start", message: { role: "assistant", content: [] } });
	emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: plan } });
	emit({
		type: "message_end",
		message: {
			role: "assistant",
			content: [text(plan)],
			usage: { input: 120, output: 40, cost: { total: 0.0004 } },
		},
	});
	await sleep(30);
	emit({
		type: "tool_execution_start",
		toolCallId: "qa-1",
		toolName: "mcp__ether_qa__browser_navigate",
		args: { url: "http://localhost:3000" },
	});
	emit({
		type: "tool_execution_end",
		toolCallId: "qa-1",
		toolName: "mcp__ether_qa__browser_navigate",
		args: { url: "http://localhost:3000" },
		isError: false,
		durationMs: 12,
		result: { content: [{ type: "text", text: "done" }] },
	});
	emit({ type: "message_start", message: { role: "assistant", content: [] } });
	emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: afterOpen } });
	emit({
		type: "message_end",
		message: { role: "assistant", content: [text(afterOpen)], usage: { input: 80, output: 20 } },
	});
	await sleep(30);
	emit({
		type: "tool_execution_start",
		toolCallId: "qa-2",
		toolName: "mcp__ether_qa__browser_click",
		args: { target: "e12", element: "Sign up" },
	});
	emit({
		type: "tool_execution_end",
		toolCallId: "qa-2",
		toolName: "mcp__ether_qa__browser_click",
		args: { target: "e12", element: "Sign up" },
		isError: false,
		durationMs: 25,
		result: { content: [{ type: "text", text: "done" }] },
	});
	emit({ type: "message_start", message: { role: "assistant", content: [] } });
	emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: report } });
	emit({
		type: "message_end",
		message: { role: "assistant", content: [text(report)], usage: { input: 200, output: 80, cost: 0.0006 } },
	});
	emit({ type: "agent_settled", aborted: false });
	await sleep(30);
	process.exit(0);
}

async function hang() {
	emit({ type: "agent_start" });
	emit({ type: "message_start", message: { role: "assistant", content: [] } });
	emit({ type: "message_update", assistantMessageEvent: { type: "text_delta", delta: plan } });
	emit({
		type: "message_end",
		message: { role: "assistant", content: [text(plan)] },
	});
	emit({
		type: "tool_execution_start",
		toolCallId: "qa-hang",
		toolName: "mcp__ether_qa__browser_snapshot",
		args: {},
	});
	// The rail should kill this process tree on Stop/Reset/reload.
	setInterval(() => {}, 1000);
	await new Promise(() => {});
}

async function fail() {
	process.stderr.write("Playwright MCP failed to start: fixture failure\n");
	await sleep(20);
	process.exit(1);
}

if (mode === "hang") await hang();
else if (mode === "fail") await fail();
else await ok();
