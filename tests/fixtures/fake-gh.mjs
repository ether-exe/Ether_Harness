#!/usr/bin/env node
/**
 * Deterministic stand-in for the GitHub CLI used by the test harness.
 * Select behaviour with FAKE_GH_MODE: ok | auth | fail | slow.
 */
const mode = process.env.FAKE_GH_MODE ?? "ok";
const args = process.argv.slice(2);

const profile = {
	login: "octo-test",
	name: "Octo Test",
	bio: "Testing the GitHub rail.",
	followers: 7,
	public_repos: 3,
};

const repos = [
	{
		nameWithOwner: "octo-test/alpha",
		description: "Alpha demo repository",
		primaryLanguage: { name: "TypeScript" },
		stargazerCount: 12,
		updatedAt: new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString(),
		isPrivate: false,
	},
	{
		nameWithOwner: "octo-test/beta",
		description: "",
		primaryLanguage: { name: "Rust" },
		stargazerCount: 3,
		updatedAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000).toISOString(),
		isPrivate: true,
	},
];

for (let index = 3; index <= 12; index += 1) {
	repos.push({
		nameWithOwner: `octo-test/repo-${String(index).padStart(2, "0")}`,
		description: `Demo repository ${index}`,
		primaryLanguage: { name: index % 2 === 0 ? "TypeScript" : "Rust" },
		stargazerCount: index,
		updatedAt: new Date(Date.now() - index * 60 * 60 * 1000).toISOString(),
		isPrivate: index % 3 === 0,
	});
}

const commit = (message, sha, minutesAgo) => [
	{
		sha,
		commit: {
			message,
			author: { date: new Date(Date.now() - minutesAgo * 60 * 1000).toISOString() },
		},
	},
];

if (mode === "auth") {
	console.error("To get started with GitHub CLI, please run: gh auth login");
	process.exit(4);
}
if (mode === "fail") {
	console.error("HTTP 502: Bad Gateway");
	process.exit(1);
}
if (mode === "slow") {
	await new Promise((resolve) => setTimeout(resolve, 400));
}

if (args[0] === "api" && args[1] === "graphql") {
	const days = [];
	const now = new Date();
	const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
	const start = today - 364 * 24 * 60 * 60 * 1000;
	for (let index = 0; index < 365; index++) {
		const date = new Date(start + index * 24 * 60 * 60 * 1000);
		const count = index % 3 === 0 ? (index % 7) + 1 : 0;
		days.push({ date: date.toISOString().slice(0, 10), contributionCount: count });
	}
	const total = days.reduce((sum, day) => sum + day.contributionCount, 0);
	console.log(
		JSON.stringify({
			data: {
				viewer: {
					login: "octo-test",
					contributionsCollection: {
						restrictedContributionsCount: 0,
						contributionCalendar: {
							totalContributions: total,
							weeks: [{ contributionDays: days }],
						},
					},
				},
			},
		}),
	);
	process.exit(0);
}

if (args[0] === "api" && /\/readme$/.test(args[1] ?? "")) {
	console.log("# Trending Demo\n\nShort readme intro for the feed.\n\nREADME-MARKER: this is the expanded readme.\n\n- first item\n- second item");
	process.exit(0);
}

if (args[0] === "api" && args[1] === "user") {
	console.log(JSON.stringify(profile));
	process.exit(0);
}
if (args[0] === "repo" && args[1] === "list") {
	console.log(JSON.stringify(repos));
	process.exit(0);
}
if (args[0] === "api" && /\/commits\?/.test(args[1] ?? "")) {
	const match = /repos\/([^/]+\/[^/]+)\/commits\?/.exec(args[1]);
	const repo = match?.[1] ?? "octo-test/alpha";
	const order = repo === "octo-test/alpha" ? 1 : repo === "octo-test/beta" ? 2 : Number(repo.split("-").pop()) || 99;
	const message = repo === "octo-test/alpha" ? "Feat: add the GitHub rail" : `Commit for ${repo}`;
	console.log(JSON.stringify(commit(message, repo === "octo-test/alpha" ? "a1b2c3d4e5f6" : "9f8e7d6c5b4a", order)));
	process.exit(0);
}

console.error(`fake-gh: unexpected args ${args.join(" ")}`);
process.exit(2);
