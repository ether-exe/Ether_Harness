# Changelog

All notable changes to the Ether Harness.

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
