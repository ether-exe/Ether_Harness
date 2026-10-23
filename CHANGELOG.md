# Changelog

All notable changes to the Ether Harness.

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
