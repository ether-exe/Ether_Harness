# Changelog

All notable changes to the Ether Harness.

## 0.2.3 — 2026-10-30

### Added

- New `𝞢𝝉𝜢𝜺𝜞` theme (56 tokens): electric azure (`#076BF0`) enamel and champagne gold filigree
  over a deep blue night canvas. The wordmark, folders, frame accents, selection, and user bubbles
  are azure; pearl text, gilded headings and functions, warm amber numbers, emerald strings,
  amethyst types, and rose diffs keep code legible. The file is `themes/𝞢𝝉𝜢𝜺𝜞.json`; the installer
  and doctor know about it.
- The preview keeps `𝞢𝝉𝜢𝜺𝜞`'s native syntax palette instead of remapping to Dracula. ETHEREX
  already did this; Ether and Bluether keep their deliberate Dracula preview.
- New `azure-theme` harness covering schema validity, the 56-token palette, the exact #076BF0
  accent, contrast, the azure/gold hierarchy, chrome tinting, native syntax preview, and 256-color
  loading.

### Changed

- `install.mjs`, `doctor.mjs`, README, and SPEC now list four themes and fourteen harnesses.
- Ether remains the default theme. `𝞢𝝉𝜢𝜺𝜞` is opt-in through `/settings` or
  `--theme 𝞢𝝉𝜢𝜺𝜞`.
- Version bumped to 0.2.3.

### Verification

- `npm test` — 14/14 harnesses pass.

## 0.2.2 — 2026-10-30

### Added

- Taskbar `▤` Files icon (row 1) toggles the Files tree, and `alt+6` does the same from the
  keyboard.
- Taskbar `⚙` Settings icon anchored at the bottom (row 38). It is a placeholder and reports
  "Settings is not wired yet" when activated.
- The Files toggle is a manual override of the 110-column rule: it opens the tree below the cutoff
  and closes it above it. The choice is independent of the other rails and survives resizes, `◫`,
  preview opens and closes, and TUI mode switches.
- New `files-rail` harness covering icon placement, the width override, layout toggles, `alt+6`,
  focus, and renderer reattachment.
- Taskbar `✓` QA icon (row 9) opening a 40-column QA rail in the side-chat slot. Chat and QA take
  turns; GitHub stays independent. `alt+7` toggles the QA rail.
- QA rail: an address field accepting localhost or any public http(s) URL, a paste-friendly
  multi-line task field, START/STOP, RESET, live DONE/NOW/NEXT sections, a plain-English REPORT, a
  PASS/FAIL/BLOCKED verdict, elapsed time, action count, and cost. Closing or collapsing the rail
  does not stop a running task.
- The task runs in a separate `pi --mode json` subagent with only Playwright MCP browser tools. It
  receives the address and task only, never the main chat or workspace tools.
- `qa/ether-qa-agent.ts` registers `npx @playwright/mcp` with hidden exposure for 15 safe
  browser tools, a host/subdomain navigation gate (loopback only for local tasks), a 120-action
  cap, and artifact-only file writes. Public sites can be tested; forms, login, and logout work
  with test data. Windows uses the installed Edge browser; `ETHER_QA_BROWSER` overrides the channel.
  Flutter CanvasKit pages are supported through the fixed accessibility helper.
- Stop kills the child process tree and closes the MCP/browser; Reset clears the form, progress,
  report, and the run's artifact directory. Artifacts live under `<agent-dir>/qa-artifacts`.
- New `qa-rail` harness covering the form/state flow, JSON event parsing, stop/reset, slot sharing,
  active tint, and the browser-tool policy.
- Taskbar `✎` Notes icon (row 11) opening a 38-column session-only notepad in the GitHub slot.
  Notes and GitHub take turns; `alt+8` toggles the rail.
- The notepad is a multi-line editor with paste support. It survives closing/hiding the rail,
  `◫`, and renderer swaps; `session_shutdown` (`/new`, `/resume`, `/reload`, quit) clears it.
  Nothing is written to disk.
- New `notes-rail` harness covering the pen icon, typing, hide/reopen persistence, Notes/GitHub
  slot sharing, layout toggles, and the shutdown wipe.
- `ETHEREX` theme (56 tokens): strict grayscale, black panels, pure-white main agent text, and a
  dimmer-white ladder for folders, files, thinking, headings, and syntax. Code preview skips the
  Dracula remap so it stays monochrome.
- `mono-theme` harness covering the grayscale palette, the text/folder/file/thinking hierarchy, the
  chrome, and the code preview.
- Flutter CanvasKit support: `enable_flutter_accessibility` runs one fixed `browser_evaluate`
  snippet that clicks the hidden 1×1 `flt-semantics-placeholder`, then a fresh snapshot exposes the
  canvas text, buttons, and links. The helper is the only path to `browser_evaluate`; arbitrary JS
  stays hidden.

### Changed

- The taskbar shows only wired actions plus the Settings placeholder. Removed the inert `⌂`, `⌕`,
  `⌁`, `⎇`, `⬡`, `◷` placeholders and the inert `⟳`, `≡`, `?` footer icons.
- Taskbar top icons are now `▤ ◫ ✦ ⑂ ✓ ✎` at rows 1,3,5,7,9,11, with `⚙` at row 38. `▤` is
  the single Files toggle.
- Taskbar icons for open rails are tinted `toolTitle` blue; collapsed or inactive icons keep the
  muted tone.
- The chrome reattaches when pi mounts a new fullscreen renderer (fullscreen → regular →
  fullscreen). The rails are reused, so tree expansion and the Files open/closed choice survive;
  previously the chrome disappeared until restart.
- The header cost/model accent and the side-chat You bubble now use theme tokens (`toolTitle`,
  `userMessageBg`, `userMessageText`) instead of fixed blue, so a monochrome theme stays monochrome.
- Active Files rows use `muted` instead of `text`, keeping files below folders in the white ladder.

### Fixed

- Replacing a session (`/new`, `/resume`) or reloading no longer crashes pi with “This extension
  ctx is stale after session replacement or reload” from `EtherFilesSidebar.render`. Rails probe
  the ctx before using it, render from the last known working directory while the replacement
  chrome mounts, and drop the invalidated ctx on `session_shutdown`.
- New `session-swap` harness covering the stale-ctx gap, shutdown ordering, late events from a
  replaced runtime, and the reload chrome handoff.
- QA START/STOP and RESET act on the final click, not the mouse release. Previously the release
  started a run and the following click immediately stopped it, so START looked like “stopped by
  user”.
- Opening QA focuses the first empty field. A URL-only task with no address now reports that the
  URL belongs in ADDRESS and focuses that field.
- The QA helper is installed under `qa/` instead of `extensions/`, so pi no longer discovers and
  loads its private MCP server in the main session. The installer removes the old copy.
- The screenshot filename guard resolves the run directory before comparing paths, so relative
  screenshot names work and absolute paths outside the run stay blocked.
- The Files tree skips generated Flutter/IDE/tooling directories and files: `.dart_tool`, `.idea`,
  `.gradle`, `Pods`, `DerivedData`, `.expo`, `.svelte-kit`, `.angular`, `.temp`, `.pub-cache`,
  `.pub`, `coverage`, `.flutter-plugins*`, `.metadata`, `.packages`, and `*.iml`. Flutter's
  `.dart_tool/chrome-device` Edge profile no longer floods the tree with EdgeCoupons,
  BudgetDatabase, Collections, discount databases, or maskable icons.

### Verification

- `npm test` — 13/13 harnesses pass.
- Real Playwright MCP smoke test against a local page: navigate, snapshot, click, find, console,
  network, and screenshot; `VERDICT: PASS`. Screenshots stayed inside the run's artifact directory.

## 0.2.1 — 2026-10-28

### Added

- Taskbar `⑂` GitHub icon (row 19) opening a new 38-column right rail, independent of the side
  chat. `⑂` or `alt+5` toggles it; both right rails can be open, and collapsing either reclaims
  transcript width.
- GitHub HUD fed by the connected `gh` CLI: a profile card with a bold, letter-spaced name, a
  12-month contribution total, current-month heatmap, exact active-day counts, streak, recent repos
  (language, privacy, stars, age), the latest commit per repo, and a FEED of trending repos with
  total stars, stars today, and a two-line README excerpt. Five-minute cache, `r` refreshes.
- REPOS and ACTIVITY show ten rows by default. When there are more, a `⊞ N MORE` row expands the
  section up to 20 repos / 12 activity entries, and `⊟ LESS` collapses it back.
- `FEED` under ACTIVITY: five trending repos from `github.com/trending`. `⊞` expands the full
  README; `⊟` collapses it. READMEs are prefetched in the background, stripped to text, and cached
  for the session. Trending failures degrade to `trending unavailable` and do not affect the rest
  of the rail.
- Read-only `gh` calls through `execFile` (12 s timeout, no shell, no token access). Identity, empty,
  logged-out, missing-binary, and API-error states; failures show a centered "No GitHub CLI
  connected" notice with a cause-specific hint.
- `ETHER_GH_BIN` override plus `tests/fixtures/fake-gh.mjs`, so the rail is tested without network
  or a real account. New `github-rail` harness covers toggles, sync, repo/activity expansion, feed
  README expand/collapse, both-rail layout, `alt+5`, and the auth/missing states.

### Verification

- `npm test` — 8/8 harnesses pass.

## 0.2.0 — 2026-10-27

Installed and refined on macOS with pi 1.4.0.

### Added

- Taskbar `✦` AI icon (row 17), wired to toggle only the side chat. Keyboard `enter` uses the same action; `◫` still toggles all side rails. Below 85 columns the AI icon reports the chat-width requirement.
- Files rail folder rows now use the harness blue (`toolTitle`): `#3a7bcb` in Ether, `#5b8cff` in Bluether.
- File-tree filtering for generated noise: VCS metadata (`.git`, `.hg`, `.svn`), heavy build/cache directories, OS metadata files, editor backups/swaps, `*.pyc`, `*.log`, `*.tmp`, and symlinks. The tree stays rooted at the session workspace.

### Changed

- `lib/pi-paths.mjs`, `doctor.mjs`, and `tests/env.mjs` now resolve pi's dependencies through Node's own resolver, supporting both nested and hoisted (managed-installer) layouts.
- Test rendering is pinned to truecolor, so assertions no longer depend on the host terminal's color mode; the 256-color path is still tested explicitly.
- Side-chat `list_dir`/`grep_workspace` share the same generated-file filter as the Files rail.

### Verification

- `npm test` — 7/7 harnesses pass.
- `npm run doctor` — 0 errors, 0 warnings.
- Installed files match the source tree; theme `Ether` is active.
- Added coverage for AI chat toggling, folder color, generated-file exclusion, symlink containment, and both dependency layouts.

## 0.1.0 — 2026-10-22

Initial portable harness.

### Added

- `install.mjs` with `--target`, `--theme`, `--no-theme`, `--dry-run`, and `restore` from timestamped backups.
- `doctor.mjs` for Node, pi, pi-tui, jiti, theme, and agent-directory checks.
- Portable test environment: `PI_ROOT` resolution, temp `ETHER_CHAT_CONFIG`, no machine-specific paths.
- `tests/run-all.mjs`.
- Ether and Bluether themes, the Isometra font and OFL license.
- Full keyboard control for every rail:
  - global `alt+1` taskbar / `alt+2` Files / `alt+3` preview / `alt+4` chat / `alt+l` layout
  - `tab` / `shift+tab` cycle rails, `esc` returns to the editor
  - taskbar selection and activation, inert-icon notices
  - Files selection, collapse/expand, parent/first-child, keyboard open into the preview
  - preview line/page/home/end scrolling, `esc` close back to Files
  - chat paging, message selection, `ctrl+x` copy, `ctrl+r` quote
- Selected rows in the taskbar and Files use `selectedBg`; preview and Files headings show `esc` while focused.

### Changed

- Side-chat Ether bubble body uses `customMessageText`; You bubbles stay `text`.
- RightsidebarB prose/unhighlighted previews use one `dim` white for every line; the 3-muted/2-blue pattern is removed.
- Dracula preview colors follow the terminal's color mode: truecolor or xterm-256.
- Side-chat config honors `ETHER_CHAT_CONFIG` and `PI_CODING_AGENT_DIR`.

### Verification

- Seven harnesses pass: chrome, chat model, chat send, chat actions, left preview, prose preview, keyboard.
- Tested with pi 1.4.0 on Windows Terminal (developed on 1.3.0). macOS/Linux are supported in code but not yet run on real hardware.
