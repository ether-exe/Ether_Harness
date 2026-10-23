/**
 * Shared path resolution for the harness installer, doctor, and tests.
 *
 * The harness never vendors pi. It finds the installed `@earendil-works/pi-coding-agent`
 * package and reuses pi's own pi-tui, jiti, and theme loader.
 */
import { execFileSync, execSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** Harness root (the folder containing package.json). */
export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function isPiRoot(dir) {
	try {
		const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
		return pkg.name === "@earendil-works/pi-coding-agent";
	} catch {
		return false;
	}
}

/** Find the installed pi package without requiring a global node_modules layout. */
export function findPiRoot() {
	const candidates = [];
	if (process.env.PI_ROOT) candidates.push(process.env.PI_ROOT);

	const npm = process.platform === "win32" ? "npm.cmd" : "npm";
	try {
		const globalRoot = (
			process.platform === "win32"
				? execSync("npm root -g", { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"], timeout: 5000 })
				: execFileSync(npm, ["root", "-g"], {
						encoding: "utf8",
						stdio: ["ignore", "pipe", "ignore"],
						timeout: 5000,
					})
		).trim();
		if (globalRoot) candidates.push(join(globalRoot, "@earendil-works", "pi-coding-agent"));
	} catch {
		// npm may be missing; fall back to conventional locations
	}

	if (process.env.APPDATA) {
		candidates.push(join(process.env.APPDATA, "npm", "node_modules", "@earendil-works", "pi-coding-agent"));
	}

	// Official installer managed layout:
	// <agent-dir>/install/releases/<version>/node_modules/@earendil-works/pi-coding-agent
	const managedRoots = [];
	if (process.env.PI_MANAGED_INSTALL_ROOT) managedRoots.push(process.env.PI_MANAGED_INSTALL_ROOT);
	managedRoots.push(join(resolveAgentDir(), "install"));
	for (const managedRoot of managedRoots) {
		try {
			const version = readFileSync(join(managedRoot, "current-version"), "utf8").trim();
			if (version) {
				candidates.push(
					join(managedRoot, "releases", version, "node_modules", "@earendil-works", "pi-coding-agent"),
				);
			}
		} catch {
			// not a managed install
		}
		const releases = join(managedRoot, "releases");
		if (existsSync(releases)) {
			for (const version of readdirSync(releases).sort().reverse()) {
				candidates.push(
					join(releases, version, "node_modules", "@earendil-works", "pi-coding-agent"),
				);
			}
		}
		candidates.push(join(managedRoot, "node_modules", "@earendil-works", "pi-coding-agent"));
	}
	if (process.env.npm_config_prefix) {
		candidates.push(join(process.env.npm_config_prefix, "lib", "node_modules", "@earendil-works", "pi-coding-agent"));
		candidates.push(join(process.env.npm_config_prefix, "node_modules", "@earendil-works", "pi-coding-agent"));
	}
	candidates.push(
		join(homedir(), ".npm-global", "lib", "node_modules", "@earendil-works", "pi-coding-agent"),
		"/usr/local/lib/node_modules/@earendil-works/pi-coding-agent",
		"/usr/lib/node_modules/@earendil-works/pi-coding-agent",
		join(homedir(), ".local", "lib", "node_modules", "@earendil-works", "pi-coding-agent"),
		join(homedir(), ".bun", "install", "global", "node_modules", "@earendil-works", "pi-coding-agent"),
	);

	for (const candidate of candidates) {
		if (!candidate) continue;
		const dir = resolve(candidate);
		if (isPiRoot(dir)) return dir;
	}
	return null;
}

/** Resolve pi or fail with an actionable message. */
export function resolvePiRoot() {
	const root = findPiRoot();
	if (root) return root;
	throw new Error(
		"Cannot find @earendil-works/pi-coding-agent. Install pi first, or set PI_ROOT to the package directory.",
	);
}

/** Pi's agent state directory. `PI_CODING_AGENT_DIR` wins, matching pi itself. */
export function resolveAgentDir() {
	return resolve(process.env.PI_CODING_AGENT_DIR ?? join(homedir(), ".pi", "agent"));
}

/** Read the installed pi version, or `unknown`. */
export function readPiVersion(piRoot = findPiRoot()) {
	if (!piRoot) return "unknown";
	try {
		const pkg = JSON.parse(readFileSync(join(piRoot, "package.json"), "utf8"));
		return typeof pkg.version === "string" ? pkg.version : "unknown";
	} catch {
		return "unknown";
	}
}

