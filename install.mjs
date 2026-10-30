#!/usr/bin/env node
/**
 * Ether Harness installer.
 *
 * Copies the extensions, all themes, and the source font into pi's agent directory.
 * Merges only `theme` into settings.json. Never copies auth, sessions, chat model
 * choice, or side-chat history.
 *
 * Usage:
 *   node install.mjs [--target DIR] [--theme Ether|Bluether|ETHEREX] [--no-theme] [--dry-run]
 *   node install.mjs restore [--target DIR] [--from TIMESTAMP] [--dry-run]
 *
 * `--target` defaults to $PI_CODING_AGENT_DIR, then ~/.pi/agent.
 */
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { ROOT, readPiVersion, resolveAgentDir } from "./lib/pi-paths.mjs";

const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8"));
const args = process.argv.slice(2);
const command = args[0] === "restore" ? "restore" : "install";
const getArg = (name, fallback) => {
	const index = args.indexOf(name);
	return index >= 0 && args[index + 1] ? args[index + 1] : fallback;
};
const target = resolve(getArg("--target", resolveAgentDir()));
const dryRun = args.includes("--dry-run");
const skipTheme = args.includes("--no-theme");
const themeName = getArg("--theme", "Ether");
const backupRoot = join(target, "ether-harness-backups");
const stamp = getArg("--from", new Date().toISOString().replace(/[:.]/g, "-"));

const FILES = [
	["extensions/ether-sidebar.ts", "extensions/ether-sidebar.ts"],
	["qa/ether-qa-agent.ts", "qa/ether-qa-agent.ts"],
	["extensions/web-tools.ts", "extensions/web-tools.ts"],
	["themes/Ether.json", "themes/Ether.json"],
	["themes/Bluether.json", "themes/Bluether.json"],
	["themes/ETHEREX.json", "themes/ETHEREX.json"],
	["assets/fonts/Isometra-Regular.ttf", "assets/fonts/Isometra-Regular.ttf"],
];

const log = (message) => console.log(`${dryRun ? "[dry-run] " : ""}${message}`);

function fail(message) {
	console.error(`error: ${message}`);
	process.exit(1);
}

function readJson(path) {
	try {
		return JSON.parse(readFileSync(path, "utf8"));
	} catch (error) {
		fail(`cannot read ${path}: ${error instanceof Error ? error.message : String(error)}`);
	}
}

function latestBackup() {
	if (!existsSync(backupRoot)) fail(`no backups found at ${backupRoot}`);
	const entries = readdirSync(backupRoot)
		.filter((name) => existsSync(join(backupRoot, name, "manifest.json")))
		.sort()
		.reverse();
	if (entries.length === 0) fail(`no backups found at ${backupRoot}`);
	return join(backupRoot, entries[0]);
}

function install() {
	const backupDir = join(backupRoot, stamp);
	const manifest = {
		harness: pkg.name,
		version: pkg.version,
		createdAt: new Date().toISOString(),
		target,
		pi: readPiVersion(),
		theme: skipTheme ? null : themeName,
		files: [],
		removed: [],
		settings: null,
	};

	log(`Ether Harness ${pkg.version}`);
	log(`source: ${ROOT}`);
	log(`target: ${target}`);
	log(`pi: ${manifest.pi}`);

	for (const [sourceRelative] of FILES) {
		const source = join(ROOT, sourceRelative);
		if (!existsSync(source)) fail(`missing source file: ${source}`);
	}
	if (!skipTheme && !existsSync(join(ROOT, "themes", `${themeName}.json`))) {
		fail(`unknown theme "${themeName}"; expected a file in themes/`);
	}

	const settingsPath = join(target, "settings.json");
	const settingsExisted = existsSync(settingsPath);
	// Validate before copying anything, so bad JSON never causes a partial install.
	if (settingsExisted) readJson(settingsPath);

	for (const [sourceRelative, destRelative] of FILES) {
		const source = join(ROOT, sourceRelative);
		const dest = join(target, destRelative);
		const existed = existsSync(dest);
		if (existed) {
			const backup = join(backupDir, destRelative);
			if (!dryRun) {
				mkdirSync(dirname(backup), { recursive: true });
				copyFileSync(dest, backup);
			}
			manifest.files.push({ path: destRelative, existed: true, backup: destRelative });
			log(`backup ${destRelative}`);
		} else {
			manifest.files.push({ path: destRelative, existed: false });
		}
		if (!dryRun) {
			mkdirSync(dirname(dest), { recursive: true });
			copyFileSync(source, dest);
		}
		log(`install ${destRelative}`);
	}

	// Older installs put the QA helper in extensions/, where pi discovered and
	// loaded it in the main session. Move it out of discovery.
	for (const relative of ["extensions/ether-qa-agent.ts"]) {
		const dest = join(target, relative);
		if (!existsSync(dest)) continue;
		const backup = join(backupDir, relative);
		if (!dryRun) {
			mkdirSync(dirname(backup), { recursive: true });
			copyFileSync(dest, backup);
			rmSync(dest, { force: true });
		}
		manifest.removed.push({ path: relative, backup: relative });
		log(`remove ${relative} (QA helper now lives under qa/)`);
	}

	if (!skipTheme) {
		const settings = settingsExisted ? readJson(settingsPath) : {};
		if (settingsExisted) {
			if (!dryRun) {
				mkdirSync(backupDir, { recursive: true });
				copyFileSync(settingsPath, join(backupDir, "settings.json"));
			}
		}
		settings.theme = themeName;
		manifest.settings = { existed: settingsExisted, backup: settingsExisted ? "settings.json" : null };
		log(`settings: theme = ${themeName}`);
		if (!dryRun) {
			mkdirSync(target, { recursive: true });
			writeFileSync(settingsPath, `${JSON.stringify(settings, null, 2)}\n`, "utf8");
		}
	} else {
		manifest.settings = null;
		log("settings: left unchanged (--no-theme)");
	}

	if (!dryRun) {
		mkdirSync(backupDir, { recursive: true });
		writeFileSync(join(backupDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
		log(`backup manifest: ${join(backupDir, "manifest.json")}`);
	}
	log("done. Restart pi or run /reload.");
}

function restore() {
	const backupDir = getArg("--from", "") ? join(backupRoot, stamp) : latestBackup();
	const manifestPath = join(backupDir, "manifest.json");
	if (!existsSync(manifestPath)) fail(`missing manifest: ${manifestPath}`);
	const manifest = readJson(manifestPath);
	log(`restore from: ${backupDir}`);
	log(`target: ${target}`);
	if (manifest.target && resolve(manifest.target) !== target) {
		log(`warning: backup target was ${manifest.target}`);
	}

	for (const entry of manifest.files ?? []) {
		const dest = join(target, entry.path);
		if (entry.existed) {
			const backup = join(backupDir, entry.backup ?? entry.path);
			if (!existsSync(backup)) {
				log(`warning: missing backup for ${entry.path}`);
				continue;
			}
			if (!dryRun) {
				mkdirSync(dirname(dest), { recursive: true });
				copyFileSync(backup, dest);
			}
			log(`restore ${entry.path}`);
		} else {
			if (!dryRun && existsSync(dest)) rmSync(dest, { force: true });
			log(`remove ${entry.path} (created by install)`);
		}
	}

	if (manifest.settings) {
		const settingsBackup = manifest.settings.existed ? join(backupDir, "settings.json") : null;
		const settingsPath = join(target, "settings.json");
		if (settingsBackup && existsSync(settingsBackup)) {
			if (!dryRun) {
				mkdirSync(dirname(settingsPath), { recursive: true });
				copyFileSync(settingsBackup, settingsPath);
			}
			log("restore settings.json");
		} else {
			if (!dryRun && existsSync(settingsPath)) rmSync(settingsPath, { force: true });
			log("remove settings.json (created by install)");
		}
	}
	log("done. Restart pi or run /reload.");
}

if (command === "install") install();
else restore();
