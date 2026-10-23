/**
 * Web tools for Pi: `web_search` and `fetch_url`.
 *
 * Search uses Bing's HTML endpoint (no API key); DuckDuckGo currently serves a
 * bot challenge from this network, Mojeek does too. Parsing is best-effort, so a
 * markup change can break it — the failure mode is an empty result list, not silent
 * wrong data. If you later add a Brave/Google/Serper key, swapping the backend is
 * a single function.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

const UA =
	"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36";
const MAX_SEARCH_CHARS = 14000;
const MAX_FETCH_CHARS = 18000;
const REQUEST_TIMEOUT_MS = 20000;

const SEARCH_PARAMS = Type.Object({
	query: Type.String({ description: "Search query" }),
	count: Type.Optional(Type.Integer({ minimum: 1, maximum: 20, description: "Number of results (default 8)" })),
});

const FETCH_PARAMS = Type.Object({
	url: Type.String({ description: "Absolute http(s) URL to read" }),
	maxChars: Type.Optional(
		Type.Integer({ minimum: 500, maximum: 60000, description: "Truncate extracted text (default 12000)" }),
	),
});

/* ------------------------------------------------------------------ helpers */

function decodeEntities(input: string): string {
	const named: Record<string, string> = {
		amp: "&",
		lt: "<",
		gt: ">",
		quot: '"',
		apos: "'",
		nbsp: " ",
		mdash: "—",
		ndash: "–",
		hellip: "…",
		rsquo: "’",
		lsquo: "‘",
		ldquo: "“",
		rdquo: "”",
	};
	return input
		.replace(/&#x([0-9a-f]+);/gi, (_, hex: string) => String.fromCodePoint(Number.parseInt(hex, 16)))
		.replace(/&#(\d+);/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10)))
		.replace(/&([a-z]+;?)/gi, (match, name: string) => named[name] ?? named[name.replace(/;$/, "")] ?? match);
}

function cleanText(input: string): string {
	return decodeEntities(input.replace(/<[^>]*>/g, " "))
		.replace(/[ \t\u00a0]+/g, " ")
		.replace(/\s*\n\s*/g, "\n")
		.trim();
}

function decodeBingHref(href: string): string {
	const decoded = decodeEntities(href);
	const match = /[?&](?:amp;)?u=a1([^&]+)/.exec(decoded);
	if (!match) return decoded;
	try {
		const base64 = match[1].replace(/-/g, "+").replace(/_/g, "/");
		const url = Buffer.from(base64, "base64").toString("utf8");
		if (/^https?:\/\//i.test(url)) return url;
	} catch {
		// fall through
	}
	return decoded;
}

function htmlToText(html: string): string {
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
	return cleanText(withBreaks)
		.replace(/[ ]*\n[ ]*/g, "\n")
		.replace(/\n{3,}/g, "\n\n")
		.trim();
}

async function httpGet(url: string): Promise<{ body: string; contentType: string; finalUrl: string }> {
	const response = await fetch(url, {
		redirect: "follow",
		signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
		headers: {
			"user-agent": UA,
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

function truncate(text: string, max: number): string {
	if (text.length <= max) return text;
	return `${text.slice(0, max)}\n\n[… truncated ${text.length - max} characters]`;
}

/* ------------------------------------------------------------------- search */

interface SearchResult {
	title: string;
	url: string;
	snippet: string;
}

async function searchBing(query: string, count: number): Promise<SearchResult[]> {
	const url = `https://www.bing.com/search?q=${encodeURIComponent(query)}&setlang=en&count=${Math.min(20, Math.max(1, count))}`;
	const { body } = await httpGet(url);
	const blocks = body.split('<li class="b_algo"').slice(1);
	const results: SearchResult[] = [];
	for (const block of blocks) {
		const title = cleanText(/<h2[^>]*>([\s\S]*?)<\/h2>/.exec(block)?.[1] ?? "");
		const rawHref = /<h2[^>]*>\s*<a[^>]*href="([^"]+)"/.exec(block)?.[1] ?? "";
		const href = decodeBingHref(rawHref);
		const snippet = cleanText(
			/<div class="b_caption"[^>]*>[\s\S]*?<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ??
				/<p[^>]*>([\s\S]*?)<\/p>/.exec(block)?.[1] ??
				"",
		);
		if (title && /^https?:\/\//i.test(href)) results.push({ title, url: href, snippet });
		if (results.length >= count) break;
	}
	// Bing serves unrelated trending results for queries with no matches; require a query
	// term to appear in the result so that fallback noise is reported as "no results".
	const tokens = [...new Set(query.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((token) => token.length > 2))];
	if (tokens.length === 0) return results;
	const relevant = results.filter((result) => {
		const haystack = `${result.title} ${result.snippet} ${result.url}`.toLowerCase();
		return tokens.some((token) => haystack.includes(token));
	});
	return relevant;
}

/* ---------------------------------------------------------------- extension */

export default function webTools(pi: ExtensionAPI): void {
	pi.registerTool({
		name: "web_search",
		label: "Web Search",
		description: "Search the web and return titles, URLs and snippets.",
		promptSnippet: "Search the web for current information",
		promptGuidelines: [
			"Use web_search whenever the answer depends on current facts, releases, versions, prices, docs, or anything after your training cutoff.",
			"Follow up with fetch_url to read a promising result in full instead of guessing from the snippet.",
		],
		parameters: SEARCH_PARAMS,
		async execute(_toolCallId, params) {
			const count = params.count ?? 8;
			try {
				const results = await searchBing(params.query, count);
				if (results.length === 0) {
					throw new Error(`No results for "${params.query}" (rate-limited or markup changed)`);
				}
				const text = truncate(
					results
						.map(
							(result, index) =>
								`${index + 1}. ${result.title}\n   ${result.url}${result.snippet ? `\n   ${result.snippet}` : ""}`,
						)
						.join("\n\n"),
					MAX_SEARCH_CHARS,
				);
				return {
					content: [{ type: "text", text }],
					details: { query: params.query, results },
				};
			} catch (error) {
				throw new Error(`web_search failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
	});

	pi.registerTool({
		name: "fetch_url",
		label: "Fetch URL",
		description: "Fetch a URL and return its readable text.",
		promptSnippet: "Read the text content of a web page",
		promptGuidelines: [
			"Use fetch_url for a specific page (docs, changelog, issue) instead of assuming its contents.",
			"If the page is large, raise maxChars or ask for the relevant section; the output is truncated by default.",
		],
		parameters: FETCH_PARAMS,
		async execute(_toolCallId, params) {
			let parsed: URL;
			try {
				parsed = new URL(params.url);
			} catch {
				throw new Error(`Invalid URL: ${params.url}`);
			}
			if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
				throw new Error(`Unsupported protocol: ${parsed.protocol}`);
			}
			const maxChars = params.maxChars ?? 12000;
			try {
				const { body, contentType, finalUrl } = await httpGet(parsed.toString());
				const isTextual = /json|text|xml|javascript/i.test(contentType) || contentType === "";
				if (!isTextual) {
					return {
						content: [{ type: "text", text: `${finalUrl}\n[${contentType}] not a text document` }],
						details: { url: finalUrl, contentType },
					};
				}
				const text = /html/i.test(contentType) ? htmlToText(body) : body;
				return {
					content: [{ type: "text", text: truncate(`${finalUrl}\n${contentType}\n\n${text}`, maxChars) }],
					details: { url: finalUrl, contentType, chars: text.length },
				};
			} catch (error) {
				throw new Error(`fetch_url failed: ${error instanceof Error ? error.message : String(error)}`);
			}
		},
	});
}
