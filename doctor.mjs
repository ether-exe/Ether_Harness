#!/usr/bin/env node
/**
 * Ether Harness doctor.
 *
 * Verifies the requirements the chrome depends on: Node, pi, pi-tui, themes,
 * extension files, and the agent directory. Read-only.
 */
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { ROOT, findPiRoot, readPiVersion, resolveAgentDir, resolvePiDependency } from "./lib/pi-paths.mjs";

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const TESTED_PI = "1.4.0";
const REQUIRED_NODE = [22, 19, 0];
let errors = 0;
let warnings = 0;

const ok = (message) => console.log(`PASS  ${message}`);
const warn = (message) => {
	warnings += 1;
	console.log(`WARN  ${message}`);
};
const fail = (message) => {
	errors += 1;
	console.log(`FAIL  ${message}`);
};

function versionParts(value) {
	return String(value)
		.replace(/^v/, "")
		.split(".")
		.map((part) => Number.parseInt(part, 10) || 0);
}
function atLeast(actual, minimum) {
	const a = versionParts(actual);
	const b = versionParts(minimum.join("."));
	for (let index = 0; index < Math.max(a.length, b.length); index++) {
		if ((a[index] ?? 0) > (b[index] ?? 0)) return true;
		if ((a[index] ?? 0) < (b[index] ?? 0)) return false;
	}
	return true;
}
function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch {
		return null;
	}
}

console.log(`Ether Harness ${pkg.version}`);
console.log(`source: ${ROOT}\n`);

// Node
if (atLeast(process.versions.node, REQUIRED_NODE)) {
	ok(`Node ${process.versions.node} (requires >= ${REQUIRED_NODE.join(".")})`);
} else {
	fail(`Node ${process.versions.node} is too old; requires >= ${REQUIRED_NODE.join(".")}`);
}

// pi
const piRoot = findPiRoot();
if (!piRoot) {
	fail("cannot find @earendil-works/pi-coding-agent; install pi or set PI_ROOT");
} else {
	const version = readPiVersion(piRoot);
	ok(`pi ${version} at ${piRoot}`);
	if (version !== TESTED_PI && version !== "unknown") {
		warn(`chrome is tested with pi ${TESTED_PI}; found ${version}`);
	}
	const tui = resolvePiDependency("@earendil-works/pi-tui/dist/index.js", piRoot);
	if (tui) ok(`pi-tui is present (${tui})`);
	else fail("missing pi-tui; expected it in pi's node_modules");
	const jiti = resolvePiDependency("jiti/lib/jiti.mjs", piRoot);
	if (jiti) ok(`jiti is present (${jiti})`);
	else fail("missing jiti; expected it in pi's node_modules");
}

// Harness files
for (const relative of [
	"extensions/ether-sidebar.ts",
	"qa/ether-qa-agent.ts",
	"extensions/web-tools.ts",
	"themes/Ether.json",
	"themes/Bluether.json",
	"themes/ETHEREX.json",
	"themes/𝞢𝝉𝜢𝜺𝜞.json",
	"assets/fonts/Isometra-Regular.ttf",
	"assets/fonts/OFL.txt",
]) {
	const path = join(ROOT, relative);
	if (existsSync(path)) ok(relative);
	else fail(`missing ${relative}`);
}

// Themes
for (const name of ["Ether", "Bluether", "ETHEREX", "𝞢𝝉𝜢𝜺𝜞"]) {
	const theme = readJson(join(ROOT, "themes", `${name}.json`));
	if (!theme) {
		fail(`themes/${name}.json is not valid JSON`);
		continue;
	}
	const count = theme.colors ? Object.keys(theme.colors).length : 0;
	if (theme.name === name && count >= 50) ok(`theme ${name} (${count} color tokens)`);
	else fail(`theme ${name} is incomplete (name=${theme.name}, tokens=${count})`);
}

// Agent directory
const agentDir = resolveAgentDir();
if (existsSync(agentDir)) {
	ok(`agent directory ${agentDir}`);
} else {
	warn(`agent directory does not exist yet: ${agentDir} (install will create it)`);
}
const settings = readJson(join(agentDir, "settings.json"));
if (settings) {
	ok(`settings.json parses (theme: ${settings.theme ?? "unset"})`);
} else if (existsSync(join(agentDir, "settings.json"))) {
	fail("agent settings.json is not valid JSON");
}

// Optional config override used by tests and sandboxes
if (process.env.ETHER_CHAT_CONFIG) {
	ok(`ETHER_CHAT_CONFIG override: ${process.env.ETHER_CHAT_CONFIG}`);
}

console.log(`\n${errors === 0 ? "OK" : "NOT READY"} (${errors} error(s), ${warnings} warning(s))`);
process.exitCode = errors === 0 ? 0 : 1;
