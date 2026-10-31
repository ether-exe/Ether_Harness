# Ether Harness — Specification

Status: **0.2.3**, tested with pi **1.4.0**. Fullscreen only.

## 1. Purpose

Ether is the terminal chrome for pi: an animated 7-row header, a far-left taskbar, a Files rail, a file preview, an isolated side chat, and a GitHub HUD fed by the connected `gh` CLI. This folder is the source of truth. `~/.pi/agent` (or `$PI_CODING_AGENT_DIR`) is an install target.

Non-goals:

- regular (scrollback) mode
- editing or mutating files from the side chat
- sharing context with the main transcript
- writing to GitHub or running mutating `gh` commands
- a terminal emulator or `node-pty`
- memory/brain/self-modifying systems

## 2. Installation model

`install.mjs` copies:

```
extensions/ether-sidebar.ts   -> <agent-dir>/extensions/ether-sidebar.ts
qa/ether-qa-agent.ts           -> <agent-dir>/qa/ether-qa-agent.ts
extensions/web-tools.ts       -> <agent-dir>/extensions/web-tools.ts
themes/Ether.json             -> <agent-dir>/themes/Ether.json
themes/Bluether.json          -> <agent-dir>/themes/Bluether.json
themes/ETHEREX.json           -> <agent-dir>/themes/ETHEREX.json
themes/𝞢𝝉𝜢𝜺𝜞.json            -> <agent-dir>/themes/𝞢𝝉𝜢𝜺𝜞.json
assets/fonts/Isometra-*.ttf   -> <agent-dir>/assets/fonts/
```

It merges only `theme` into `<agent-dir>/settings.json`, backs up replaced files under `<agent-dir>/ether-harness-backups/<timestamp>/`, and never copies `auth.json`, sessions, `chat-sidebar.json`, or side-chat history.

Agent directory resolution: `$PI_CODING_AGENT_DIR`, then `~/.pi/agent`. `--target` overrides both.

There is no build step. Pi loads the TypeScript extensions with jiti. The core harness has no
runtime npm dependencies: pi supplies `@earendil-works/pi-coding-agent`,
`@earendil-works/pi-tui`, and `typebox`. The QA rail fetches Playwright MCP through `npx` on demand
and uses a system browser (Edge on Windows, Chrome elsewhere by default).

## 3. Layout

```
HStack
├─ LeftSidebarA  5 cols, full height, taskbar
├─ Left slot, one of:
│  ├─ RightsidebarB  47 cols, full height, file preview
│  └─ LeftSidebarB   24 cols, full height, Files tree
├─ VStack
│  ├─ header 7 rows
│  └─ app root (transcript + dock)
├─ RightsidebarA  40 cols (36 while preview open), full height, chat
├─ RightSidebarQ  40 cols, full height, QA (shares the chat slot)
├─ RightSidebarN  38 cols, full height, Notes (shares the GitHub slot)
└─ RightSidebarC  38 cols, full height, GitHub HUD
```

The preview takes the left slot; Files hides while it is open. Only one left rail is visible. Chat
and QA share one slot; Notes and GitHub share the other. Chat/GitHub are independent of Notes/QA.
Each taskbar icon toggles its own rail. The Files rail additionally has a manual open/closed choice (`▤`
or `alt+6`) that overrides the width cutoff in both directions and survives resizes, layout
toggles, and renderer swaps.

Constants:

| Constant | Value |
|---|---|
| `HEADER_ROWS` | 7 |
| `HEADER_PAD_X` / `HEADER_PAD_Y` | 2 / 1 |
| `LEFT_SIDEBAR_A_WIDTH` | 5 |
| `SIDEBAR_WIDTH` (Files) | 24 |
| `FILES_MIN_TERMINAL` | 110 |
| `CHAT_SIDEBAR_WIDTH` | 40 |
| `CHAT_SIDEBAR_COMPACT_WIDTH` | 36 |
| `CHAT_MIN_TERMINAL` | 85 |
| `PREVIEW_SIDEBAR_WIDTH` | 47 |
| `PREVIEW_MIN_TERMINAL` | 132 |
| `GITHUB_SIDEBAR_WIDTH` | 38 |
| `GITHUB_MIN_TERMINAL` | 92 |
| `QA_SIDEBAR_WIDTH` | 40 (shares the chat slot) |
| `QA_MIN_TERMINAL` | 85 |
| `NOTES_SIDEBAR_WIDTH` | 38 (shares the GitHub slot) |
| `NOTES_MIN_TERMINAL` | 92 |

Width math:

- Preview open: `5 + 47 + 36 = 88` fixed → 140 leaves 52, 132 leaves 44.
- Preview closed: Files + chat `5 + 24 + 40 = 69` → 140 leaves 71.
- Chat only: `5 + 40 = 45` → 95.
- Nothing: `5` → 135.
- Both right rails: chat 40 + GitHub 38 → `5 + 24 + 40 + 38 = 107` → 140 leaves 33. Chat and
  GitHub never auto-collapse each other; the user reclaims space with `✦` or `⑂`.
- QA + Notes is also 107 (QA replaces chat, Notes replaces GitHub). A third independent right
  rail does not fit at 140; it would need a much wider terminal.

The 110-column cutoff is the auto default. The Files icon is an explicit override: it can force the
tree open below 110 columns and closed above it, in which case the transcript takes the remainder.

The footer is not part of the wrapper. `ctx.ui.setFooter` replaces the built-in footer inside the app root's dock.

## 4. Header

Left: activity glyph + Isometra braille `ETHER` (38×3 cells = 76×12 dots), `accent` white.

Top metrics (right-aligned): `model · context bar + percent/window · $spend · ↑input ↓output · thinking`.

Bottom metrics (right-aligned): `working/idle · queued · session name · CH% · message count · tool count · uptime · cwd · #session id`.

Fields drop whole from the right when space runs out; model, context, and spend have priority. Model and spend use the tool blue. The context bar is `success` at 70% or below, `warning` above 70%, `error` above 90%, with `?` after compaction.

## 5. Footer

Four-row HUD spanning the chat column:

```
├─[SYS]─[● READY]──────────────────────────────[CTX 9.6%/128k]─[CH 98%]─┤
│ CWD …  PROV deepseek  BR main  SESS right-rail  STS build: ok          │
│ TOK ↑45k ↓23k  COST $0.052  MODEL deepseek-flash · max  QUEUE pending  UP 2m07s  MSG 51  TOOL 49 │
└────────────────────────────────────────────────────────────────────────┘
```

Border and caps use a darker derivative of `borderMuted`. Left cap is `├` when Files or preview is adjacent, `┌` otherwise; right cap is `├` while chat, QA, Notes, or GitHub is visible. Optional fields drop whole as width shrinks.

## 6. LeftSidebarA — taskbar

Top icons (rows 1,3,5,7,9,11): `▤ ◫ ✦ ⑂ ✓ ✎`. Bottom icon (row 38): `⚙` Settings, a deliberate placeholder.

`▤` toggles `filesState` for the Files tree; `◫` toggles `sidebarsCollapsed` for Files/preview, chat, and GitHub; `✦` (AI) toggles `chatCollapsed` for the side chat alone; `⑂` (GitHub) toggles `githubCollapsed` for the GitHub rail alone; `✓` (QA) toggles the QA rail and collapses chat; `✎` (Notes) toggles the Notes rail and collapses GitHub. Chat and QA share a slot; Notes and GitHub share the other. The taskbar always remains. An icon is tinted `toolTitle` (blue) while its rail is open or, for `◫`, while the rails are expanded; inactive icons keep the `muted` tone. `⚙` is inert and reports that Settings is not wired yet.

Keyboard: `↑↓`/`j k`, `home`/`end`, `enter`, `tab`/`shift+tab`; focused selection uses `selectedBg` and an `accent` glyph. Mouse clicks use the same action and sync the selection without taking focus. `alt+6` performs the same Files toggle globally and `alt+7` the QA toggle.

## 7. LeftSidebarB — Files

Row 0 is the `Files` heading. Tree starts at row 1 from the session cwd.

Visibility is `auto | open | closed`. `auto` (the initial state) shows the tree at width >= `FILES_MIN_TERMINAL`; `open` and `closed` are explicit choices and win at every width. The state is kept in the extension runtime, so resizes, `◫`, preview opens/closes, and fullscreen renderer swaps do not reset it. An actually-visible preview displaces the tree in the left slot regardless of state; toggling Files while the preview is open reports that `esc` closes it.

- folders first, then files, alphabetically
- folders render in the harness blue (`toolTitle`); files stay `dim`/`text`
- `▾` expanded / `▸` collapsed; all start expanded
- indent 2 per level, capped at 6
- refresh every 10 s and on cwd change
- skips VCS metadata and generated dirs: `.git`, `.hg`, `.svn`, `node_modules`, `.cache`, `.next`, `.turbo`, `dist`, `build`, `out`, `target`, `__pycache__`, `.pytest_cache`, `.mypy_cache`, `.ruff_cache`, `.venv`, `venv`, `__MACOSX`, `$RECYCLE.BIN`, `System Volume Information`
- skips OS/editor noise files: `.DS_Store`, `.localized`, `Thumbs.db`, `ehthumbs.db`, `desktop.ini`, `._*`, `.#*`, `#*#`, `*~`, `*.swp`, `*.swo`, `*.swx`, `*.pyc`, `*.log`, `*.tmp`
- symlinks are skipped, so the tree never leaves the workspace
- cap depth 8 / 500 nodes

Mouse: click folder to toggle, click file to open the preview, wheel scrolls.

Keyboard: `alt+2` to focus; `↑↓`/`j k` select, `home`/`end` jump, `pgup`/`pgdn` page, `←` collapse or move to parent, `→` expand or move to first child, `enter` toggle/open, `tab` cycle, `esc` leave. `alt+6` toggles the rail. Keyboard-opening a file moves focus into the preview. Selected row uses `selectedBg`; heading shows `esc` while focused.

## 8. RightsidebarB — preview

Header: relative path (dirs `dim`, basename `text`), right side `↕` when overflowing, `esc` while focused, `✕` to close. Body: IDE line numbers (`dim` numbers, `borderMuted` separator, `↳` continuation rows).

- UTF-8, CRLF normalized, tabs to 4 spaces
- caps 1 MB / 5,000 lines; truncation note
- binary → notice; empty → `empty file`
- auto-refresh every 2 s on mtime/size change
- long lines soft-wrap; no horizontal scroll
- prose and unknown text: every line `dim`
- code: `getLanguageFromPath` + `highlightCode`; Ether/Bluether remap to Dracula, ETHEREX and
  𝞢𝝉𝜢𝜺𝜞 keep their native syntax tokens

Dracula palette used by Ether/Bluether (foreground only):

| Token | Color |
|---|---|
| comment / punctuation | `#6272a4` |
| keyword / operator | `#ff79c6` |
| string | `#f1fa8c` |
| number | `#bd93f9` |
| function | `#50fa7b` |
| type | `#8be9fd` |
| variable / default | `#f8f8f2` |
| added / removed | `#50fa7b` / `#ff5555` |

Preview escape codes follow the theme's color mode: truecolor, or xterm-256 when the theme reports
256 colors. ETHEREX uses the same path with its gray syntax palette, and 𝞢𝝉𝜢𝜺𝜞 with its
azure, gold, emerald, and amethyst palette.

Keyboard: `↑↓`/`j k` one line, `pgup`/`pgdn` page, `home`/`end` top/bottom, `esc` close and return focus to Files (or the editor below 110 cols), `tab` cycle.

## 9. RightsidebarA — side chat

Fixed 40 cols normally, 36 while the preview is open; hidden below 85 cols. Content: sticky masthead (3 rows + pinned rule), transcript, 3-row composer.

- masthead: `● ETHER // <recent folder>`, `MODEL`, `CTX percent/window`, `AUX-01`, `● IDLE` / `WORK` / `NEW`
- bubbles full width; Ether fill `toolPendingBg`, body `customMessageText`; You fill
  `userMessageBg`, body `userMessageText`
- labels carry `⧉` copy and `↳` reply; copy uses pi's clipboard helper
- composer: `┏━[ ● ASK ETHER ]` resting, `╔═` focused, `⏎ TX` / `esc`
- Enter sends; streaming ends with `▌`
- unread `NEW` sets a footer `STS` badge while hidden

Model selection: `/chat-model` custom scrollable picker, persisted to `<agent-dir>/chat-sidebar.json` (`ETHER_CHAT_CONFIG` overrides). Only logged-in models are listed. Calls use `streamSimple(..., { reasoning: "max" })`.

Read-only tools: `list_dir`, `read_file`, `grep_workspace`, `read_history`, `web_search`, `fetch_url`. Paths are jailed to the session cwd. No shell/write/edit path. Max 6 model→tool rounds per question.

Persistence: one Markdown log per day in `~/Ether/chat_rightsidebarA/` (`ETHER_CHAT_HISTORY_DIR` overrides). Today's last 60 turns are restored on startup as text only.

Keyboard: typing/Enter unchanged; `pgup`/`pgdn`, `ctrl+home`/`ctrl+end`, `ctrl+↑`/`ctrl+↓` select, `ctrl+x` copy, `ctrl+r` quote; `esc` clears selection first, then leaves.

## 10. RightSidebarC — GitHub

Read-only GitHub HUD in the rightmost slot, backed by the connected `gh` CLI (tested with `gh`
2.102.0). Opens with the `⑂` taskbar icon or `alt+5`; each icon toggles only its own rail, so chat
and GitHub can be open at once.

Data is fetched lazily when the rail becomes visible and cached for 5 minutes:

| Block | Source | Cap |
|---|---|---|
| `OPERATOR` | `gh api user` | card with bold, letter-spaced name; `@login`; public repo count; followers; bio (3 lines) |
| `REPOS` | `gh repo list --limit 20 --json …` | up to 20 repos; 10 shown by default, `⊞`/`⊟` expands the rest |
| `CONTRIBUTIONS` | `gh api graphql` → `contributionsCollection` (12 mo) | 12-month total, month total, streak, 7×6 heatmap, exact active days |
| `ACTIVITY` | `gh api repos/<owner>/<repo>/commits?per_page=1` | latest commit for up to 12 repos; 10 shown by default, `⊞`/`⊟` expands |
| `FEED` | `https://github.com/trending` (scraped; `ETHER_TRENDING_JSON` overrides) | 5 repos: name, total stars, 2-line README excerpt, stars today, language; `⊞`/`⊟` expands the full README |

Contributions use `viewer.contributionsCollection` over the last 12 months; GraphQL caps a range at
one year, so the total is labelled `12 MO`. The heatmap is 7 day columns × up to 6 week rows with a
`· ▁ ▃ ▅ █` intensity legend, and `ACTIVE` lists the current month's positive days with exact
counts. Streaks are computed from the same 365-day payload.

Calls use `execFile` with a 12 s timeout, no shell, `windowsHide`, and a 4 MB buffer. Every command
is read-only: no token is read, printed, or stored.

States:

- **syncing** — spinner in the header and footer; old data stays visible during a refresh.
- **no GitHub CLI** — centered `No GitHub CLI connected` plus a cause-specific hint: `gh` missing
  from PATH, `gh auth login`, or the raw API error. `r` retries.
- **partial** — if the repo list fails but the profile succeeds, identity still renders with a
  `repo list unavailable` note; a failed contribution query shows `contributions unavailable`
  inside the section without hiding the rest of the rail.
- **stale** — `LINK <age>` in the header. The ticker retries 20 s after a failure and keeps a
  successful snapshot for 5 min.

Keyboard when focused: `↑↓`/`j k` scroll, `pgup`/`pgdn`, `home`/`end`, `r` refresh, `tab` cycle,
`esc` leave. Mouse wheel scrolls. REPOS and ACTIVITY show ten rows by default; when there are more,
a `⊞ N MORE` row ends the section, and clicking it expands the rest with a `⊟ LESS` row. Click the
`⊞`/`⊟` icon at the right edge of a FEED row to expand or collapse its README; the icon is the only
click target there. The empty/error state is centered both ways.

The FEED scrapes the public trending page because GitHub has no trending API; a markup change shows
`trending unavailable` instead of failing the rail. READMEs are prefetched in the background after a
sync through `gh api repos/<owner>/<repo>/readme` (raw accept), stripped to text, and cached for the
session. Collapsed rows show the first two non-empty lines; expanding shows up to 8,000 chars / 80
lines.

Colors use theme tokens only (`accent`, `toolTitle`, `muted`, `dim`, `text`, `success`,
`borderMuted`, `toolPendingBg`), so every theme applies. `ETHER_GH_BIN` overrides the binary for
tests and sandboxes; the harness points it at `tests/fixtures/fake-gh.mjs`.

## 10b. RightSidebarQ — QA

40 cols. Shares the side-chat slot: opening QA collapses chat; opening chat closes QA. GitHub stays
independent. The rail is toggled by `✓` or `alt+7` and stays mounted while hidden, so a running task
keeps going when the rail is closed or the layout is collapsed.

Layout, top to bottom:

- header: `✓ QA`, state (`idle`, `running 0:42`, `stopping`, `stopped`, `done`, `error`)
- `ADDRESS` label + single-line input; `localhost` or `public site` on the right
- `TASK` label + multi-line editor; `paste supported` on the right
- one `START`/`STOP` button; `RESET` appears after stop/done/error
- `DONE`: the last few completed browser actions with ✓/✗
- `NOW`: the action currently running, or `thinking…`
- `NEXT`: the model's latest `NEXT:` line, falling back to its last sentence
- `REPORT`: the plain-English report; `REPORT PASS`/`FAIL`/`BLOCKED` once a verdict is present
- footer: elapsed time, action count, cost, and the keyboard hint

The address accepts `http://`, `https://`, or a bare host and is normalized to `http://`. Localhost
and any public host are accepted; a local address does not grant access to unrelated public sites.
The task is capped at 8,000 characters; an empty task, an invalid address, or a missing QA
extension is rejected before a child starts. Fields are editable while idle/stopped and locked while running. Opening the rail focuses the first
empty field. If ADDRESS is empty and TASK is only a URL, START focuses ADDRESS and explains that
the URL belongs there. `alt+enter` starts or stops the run; `pageUp`/`pageDown` scroll the report;
`tab`/`shift+tab` cycle rails and `esc` leaves.

States: `idle → running → done` or `running → stopping → stopped`; model/spawn errors become
`error`. `agent_settled` finishes the run; `aborted: true` marks it stopped. A successful assistant
message clears a transient model error from an earlier retry. `RESET` clears the address, task,
progress, report, verdict, usage, and the run's artifact directory. Closing the rail never stops a
run; `session_shutdown` disposes the child.

### Runner

The rail spawns a separate process with the same pi CLI:

```text
pi --mode json -p --no-session
   -ne
   -e builtin:mcp
   -e <agent-dir>/qa/ether-qa-agent.ts
   --no-builtin-tools
   --model <main model>
   --thinking <main level>
   --append-system-prompt <run>/persona.md
   "Address: …\nTask:\n…"
```

The child cwd is the run's artifact directory. It does not receive the main chat, workspace tools,
read/write/edit/bash, or MCP servers other than the private one registered by
`ether-qa-agent.ts`. JSONL events stream into the rail: `message_update` supplies the live text and
`NEXT:` lines, `message_end` supplies authoritative text/usage, `tool_execution_start/end` supply
DONE/NOW, and `agent_settled` finishes. A 10-minute timeout and a 65-action parent guard stop
runaway tasks; the child wrapper blocks after 60 actions.

### Browser extension

`ether-qa-agent.ts` registers a private `ether_qa` Playwright MCP server:

```text
npx -y @playwright/mcp@latest --headless --isolated --viewport-size 1280x800
   [--browser msedge|chrome|firefox|webkit] [--output-dir <run>]
```

Windows defaults to `--browser msedge`; other platforms default to the MCP server's Chrome
channel. `ETHER_QA_BROWSER` overrides. The server is registered with `exposure: "hidden"` and
`toolExposure` direct only for: navigate, snapshot, find, click, type, fill form, press key, select,
hover, wait, handle dialog, console, network requests, screenshot, close. Evaluate/run-code,
uploads, drops, tabs, media emulation, resize, and request-detail tools stay hidden. The MCP
server cwd and `--output-dir` are the run directory, so explicit screenshot/snapshot filenames stay
inside the run; the `tool_call` gate rejects absolute paths that would escape it.

### Flutter CanvasKit

Flutter web draws into a canvas and keeps its accessibility tree disabled until its 1×1 offscreen
`flt-semantics-placeholder` button is clicked. That button sits at `-1,-1`, so Playwright refuses
the click as outside the viewport and snapshots stay empty or show only "Enable accessibility".
`ether-qa-agent.ts` registers `enable_flutter_accessibility`; it runs one fixed
`browser_evaluate` snippet that searches the document and shadow roots for the placeholder, clicks
it, and waits for the tree. The model cannot call `browser_evaluate` directly, so arbitrary JS
stays unavailable. After the helper, a fresh snapshot exposes the app text, buttons, and links.

`browser_navigate` is gated to the supplied host and its subdomains. A local address can use
loopback but not public sites; a public address can use its own host/subdomains but not loopback.
A local address does not grant navigation to unrelated public sites. The gate cannot police a link
clicked inside the page or a redirect, so the persona prompt also tells the agent to stay on the
site. The server uses an isolated profile, so it never logs in with the user's existing browser
session; a test account or storage state would be needed for authenticated flows. Public sites
are therefore usable, but this is browser automation, not a security sandbox.

### Artifacts and cleanup

Artifacts live under `<agent-dir>/qa-artifacts/<timestamp>-<run>/` (override root with
`ETHER_QA_ARTIFACTS_ROOT`). Screenshots, snapshots saved by the model, and console logs stay there.
RESET removes the run directory (best effort if a browser still holds a handle). A session
shutdown kills the child process tree and lets pi close the MCP server; artifacts remain for
inspection.

Colors use `toolTitle` for the QA mark/running state, `success` for done/PASS, `warning` for
stopped/BLOCKED, `error` for STOP/FAIL, and the same matte `toolPendingBg` as the chat rail.

## 10c. RightSidebarN — Notes

38 cols. Shares the GitHub slot: opening Notes hides GitHub; opening GitHub hides Notes. Chat/QA
are independent, so QA + Notes can be open together at 140 cols. Toggled by `✎` or `alt+8`.

A plain multi-line editor: `Enter` inserts a newline, paste is supported, and the editor scrolls
with the cursor. The header shows `✎ NOTES` and `session only`; the footer says `esc back · not
saved`. The text lives only in the component. Closing the rail, hiding it, `◫`, and renderer swaps
keep it; `session_shutdown` (including `/new`, `/resume`, `/reload`, and quit) calls `clear()`.
Nothing is written to disk, localStorage, or the transcript.

```
RightSidebarN width: 38 (GITHUB_SIDEBAR_WIDTH)
NOTES_MIN_TERMINAL: 92
```

## 11. Focus model

Global shortcuts use `pi.registerShortcut` and only fire while the main editor is focused:

| Key | Action |
|---|---|
| `alt+1` | taskbar |
| `alt+2` | Files |
| `alt+3` | preview (needs active file) |
| `alt+4` | chat |
| `alt+5` | GitHub rail |
| `alt+6` | toggle the Files rail |
| `alt+7` | toggle the QA rail |
| `alt+8` | toggle the Notes rail |
| `alt+l` | toggle side rails |

A shared `RailNav` captures the editor on first entry. Inside any rail, `tab`/`shift+tab` cycles visible rails and `esc` returns to the editor. If a focused rail disappears through resize or `◫`, focus is released on the next 150 ms tick. Non-taskbar shortcuts expand collapsed rails before focusing. `alt+2` also reopens a manually closed tree when the width allows; below 110 columns use the Files icon or `alt+6` to force it open. Unavailable rails report why (85/92/110/132-col cutoffs, no active file, Files hidden behind preview).

Mouse behavior is unchanged; clicks do not take focus except the chat composer.

## 12. Themes

All four are 56-token dark themes.

Ether: one hue (`245`), saturation ≤ ~11%, hierarchy by lightness. `accent` near-white, `muted`/`dim` for secondary text, matte `#040405` tool panels, tool blue `#3a7bcb`. Reasoning text `okhsl(245 4% 36%)`.

Bluether: navy panels (`#050b18`), royal structure (`#5b8cff`), ice text (`#dbe7ff`), cyan telemetry (`#67e8f9`), amber warning, coral error, mint strings, violet types.

ETHEREX: strict grayscale with no hue. `text` (`#ffffff`) is the main agent message; `toolTitle`
(`#c0c0c0`) is the folder tone; `dim` (`#808080`) is the file/secondary tone; `thinkingText`
(`#4a4a4a`) is the thinking tone. Panels are black, accents are `#d8d8d8`, and syntax tokens are a
ladder of grays. The preview skips the Dracula remap for ETHEREX so code stays monochrome. The
header cost/model accent and side-chat user bubble use theme tokens rather than fixed blue.

𝞢𝝉𝜢𝜺𝜞: electric azure (`#076BF0`) over a deep blue night canvas (`#020814`). `accent` is the requested azure (`#076BF0`), `toolTitle` a lighter azure (`#5b9df8`) for folders and chrome, `text` pearl ice (`#e8f1ff`), and user bubbles/selection are deep azure panels (`#0a2f6b` / `#0b3d8c`). Champagne gold carries headings and functions, amber (`#f6b26b`) carries numbers, and gold (`#f2c66d`) carries warnings; emerald strings, amethyst types, rose diffs, and steel/slate secondary text complete the jewel palette. The preview keeps these native syntax tokens instead of the Dracula remap.

Theme files are installed to `<agent-dir>/themes/`. Selection lives in `settings.json` → `theme`.
Ether is the default; Bluether, ETHEREX, and 𝞢𝝉𝜢𝜺𝜞 are opt-in.

## 13. Animation and wordmark

One 150 ms ticker re-renders while a TUI exists. Busy: braille spinner to the left of the wordmark. Idle: breathing `●` between `borderMuted` and `success`. Uptime updates live.

Wordmark pipeline: Isometra Regular 400 → PowerShell `System.Drawing` at 96 px → faux-bold 9 stamps `(0,2,4)×(0,1,2)` → crop/threshold 0.22 → sample 76×12 → pack into braille 2×4 cells → embed as `ETHER_ART`. The font is source only; runtime uses the embedded strings.

## 14. Verification

`tests/env.mjs` resolves the installed pi package (`PI_ROOT` or `npm root -g`) and loads pi's bundled jiti, pi-tui, and theme loader. It points `ETHER_CHAT_CONFIG` at a temp file.

`npm test` runs:

| Harness | Covers |
|---|---|
| `ether-harness` | widths 160→60, taskbar, footer, Files, `◫`, wordmark, reload |
| `chat-model` | `/chat-model`, picker, config, args, cancel |
| `chat-send` | streaming, persona, tools, web, persistence, unread, fills, bubble text |
| `chat-actions` | `⧉`/`↳`, scrolled messages, draft append, composer focus |
| `left-preview` | left slot geometry, 36-col chat, 131↔132 cutoff, close |
| `prose-preview` | dim prose, no blue bleed, Dracula truecolor and 256-color |
| `mono-theme` | ETHEREX 56-token grayscale palette, white agent text/dimmer folder-file-thinking ladder, monochrome chrome and code preview |
| `azure-theme` | 𝞢𝝉𝜢𝜺𝜞 schema validity, 56-token azure/gold jewel palette, exact #076BF0 accent, contrast, azure chrome, native syntax preview, 256-color load |
| `keyboard` | shortcuts, focus cycle, taskbar/Files/preview/chat keys, notices |
| `github-rail` | click/alt+5 toggles, gh sync, identity/repos/activity, auth and missing-binary states, both-rail layout |
| `files-rail` | Files icon placement, width override, layout toggle state, `alt+6`, focus, renderer reattachment |
| `qa-rail` | form/state flow, JSON progress, stop/reset, chat/QA slot sharing, active tint, browser-tool policy |
| `notes-rail` | pen icon, session-only notepad, typing, hide/reopen persistence, Notes/GitHub slot sharing, layout toggles, shutdown wipe |

The `qa-rail` harness uses a fake JSON child and a stub MCP registrar, so it proves the plumbing
without a model or browser. These prove layout math, ANSI colors, focus, and key routing. They do
not judge aesthetics, real terminal key delivery, or browser flakiness.

## 15. Portability

- All filesystem code uses `node:path` and `node:fs`; no Windows-only APIs.
- `gh` calls use `execFile` with an argv array, so spaces and non-ASCII paths are safe; `gh.exe`
  resolves on Windows and the brew binary on macOS. `ETHER_GH_BIN` overrides the command.
- Tests resolve `PI_ROOT`; they must not hardcode a machine path.
- Side-chat config honors `ETHER_CHAT_CONFIG` and `PI_CODING_AGENT_DIR`.
- Preview output honors theme color mode (truecolor / 256-color); ETHEREX and 𝞢𝝉𝜢𝜺𝜞 keep their
  own syntax tokens instead of the Dracula remap.
- Clipboard: macOS `pbcopy`, Windows `clip`, Linux `wl-copy`/`xclip`/`xsel`, OSC 52 fallback.
- QA browser: Windows defaults to Edge; other platforms use the Playwright MCP Chrome channel or
  `ETHER_QA_BROWSER`. The first run may download the MCP package. The browser profile is isolated.
- macOS Terminal.app needs **Option as Meta** for `alt+` shortcuts; Home/End/PgUp/PgDn may require `fn`.
- Braille/box-drawing glyph coverage is font-dependent.
- `setLayoutRoot` is pi-internal; a future pi release may break the chrome. The prototype wrapper
  reattaches the rails when pi mounts a new fullscreen renderer, but a change to that method's
  contract can still break the reattach.

## 16. Known limits

- fullscreen only; regular mode has no chrome, and the chrome reattaches when fullscreen returns
- side-chat history is text-only; tool calls are not persisted
- the GitHub rail needs `gh` 2.x on PATH and an authenticated account; it caches for 5 minutes and
  shows at most 20 repos / 12 latest commits (ten of each by default)
- the FEED depends on github.com/trending markup; READMEs are cached in memory for the session only
- unread state and drafts are in-memory
- QA shares the chat slot; chat and QA cannot be visible together; Notes shares the GitHub slot
- Notes is session-only and never persisted; session replacement/reload wipes it
- QA accepts public sites as well as localhost; it can fill forms and log in/out with test data,
  but CAPTCHA/OTP/magic-link flows remain unsupported, and link clicks/redirects are not a hard
  security boundary
- QA is an LLM browser tester: results can be non-deterministic, and the isolated profile has no
  existing logins; use a test account for authenticated flows
- QA requires `npx` and a browser (Edge on Windows, Chrome elsewhere by default)
- `/chat-history` rail view deferred
- fixed 38-col wordmark forces metric eviction at 120 cols
- constant 150 ms re-render even when idle
- screenshots/visual QA require a human
