#!/usr/bin/env node
/**
 * Run every harness test in a fresh Node process.
 *
 * Usage:
 *   node tests/run-all.mjs
 *   node tests/run-all.mjs --filter keyboard
 */
import { spawnSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const testsDir = dirname(fileURLToPath(import.meta.url));
const filterArg = process.argv.find((arg) => arg.startsWith("--filter="));
const filter = filterArg ? filterArg.slice("--filter=".length) : "";
const files = readdirSync(testsDir)
	.filter((name) => name.endsWith(".mjs") && name !== "env.mjs" && name !== "run-all.mjs")
	.filter((name) => (filter ? name.includes(filter) : true))
	.sort();

if (files.length === 0) {
	console.error("No tests selected.");
	process.exit(1);
}

let failures = 0;
for (const file of files) {
	console.log(`\n=== ${file}`);
	const result = spawnSync(process.execPath, [join(testsDir, file)], {
		stdio: "inherit",
		env: process.env,
	});
	if (result.status !== 0) {
		failures += 1;
		console.error(`FAILED ${file} (exit ${result.status ?? "signal"})`);
	}
}

console.log(`\n${files.length - failures}/${files.length} harnesses passed`);
process.exitCode = failures === 0 ? 0 : 1;
