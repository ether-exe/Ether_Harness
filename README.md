# Ether Harness

A hand-built terminal chrome for [pi](https://pi.dev).

Out of the box, pi is a single scrolling transcript. Ether turns it into a cockpit: an animated
header with live session telemetry, a taskbar rail on the far left, a file tree, an IDE-style file
preview, an isolated side chat that never mixes with your main conversation, a GitHub HUD fed by
the connected `gh` CLI, and a browser QA persona. Everything works with the mouse or entirely from
the keyboard.

This started as my personal setup and is shared as a working reference, not a polished product. If
you want pi to look and behave differently, the tricks in here — wrapping the layout root, the theme
tokens, the test harness — should transfer easily to your own chrome.

```
┌──┬──────────────────────────────┬───────────────────────────┬────────────────┐
│▤ │  ▄▄▄▄ ▄▄▄ ▄▄   ETHER         │ deepseek · context · $0.05│ Chat           │
│  │  header · 3 rows of wordmark │ ▰▰▰▰▰▰▰▰▱▱ 62%           │ ╭────────────╮ │
│◫ ├──────────────┬───────────────┴───────────────────────────┤ │ you        │ │
│  │ Files        │                                           │ ╰────────────╯ │
│✦ │ ▸ src/       │            transcript                     │                │
│  │ ▸ tests/     │                                           │  ether         │
│⑂ │ ▸ README.md  │                                           │ ╭────────────╮ │
│✓ ├──────────────┴───────────────────────────────────────────┴────────────────┤
│⚙ │ CWD …  TOK ↑45k ↓23k  COST $0.052  QUEUE …  UP 2m07s  MSG 51  TOOL 49    │
└──┴───────────────────────────────────────────────────────────────────────────┘
```

## How it fits together

Pi's TUI has no sidebar or header slots, so the extension does something slightly naughty: it wraps
the fullscreen layout root. Your transcript, dock, and footer keep working untouched inside the
wrapped layout, and the chrome lives around it. That's also why this is **fullscreen mode only** —
regular scrollback mode has no layout root to wrap. When pi remounts the fullscreen renderer, the
chrome reattaches with the same rails and state, so a fullscreen → regular → fullscreen switch no
longer loses it.

Deleting the extension files gets you back to stock pi. No build step, no runtime npm
dependencies: pi loads the TypeScript directly through jiti, and the themes are plain JSON. The QA
rail fetches its browser bridge through `npx` on first use.

The pieces, briefly:

- **Header (7 rows)** — braille wordmark, model, context bar, live spend, input/output tokens,
  session name, uptime. Fields drop whole from the right when the terminal narrows.
- **Taskbar (5 cols)** — an icon rail that is always visible. `▤` collapses or expands the Files
  tree, `◫` collapses all side rails, `✦` toggles just the side chat, `⑂` toggles the GitHub rail
  alone, `✓` toggles the QA rail, and `✎` toggles Notes. An open rail tints its icon blue; a closed one stays muted.
  `⚙` sits at the bottom as a Settings placeholder.
- **Files (24 cols)** — the session directory as a tree, auto-refreshing. Clicking a file opens the
  preview; the tree steps aside while it's open. The taskbar Files icon (or `alt+6`) hides and shows
  the rail by hand, including below the 110-column auto-hide cutoff; that choice survives resizes
  and fullscreen switches.
- **Preview (47 cols)** — opens in the left slot with line numbers and soft-wrapped prose or
  syntax-highlighted code (Dracula on Ether/Bluether, grayscale tokens on ETHEREX). Refreshes on
  file change.
- **Side chat (40 cols)** — a genuinely separate conversation with its own model. It sees its own
  history only, never the main transcript, and cannot touch your files.
- **GitHub (38 cols)** — a read-only HUD from the connected `gh` CLI: a profile card, recent repos
  (ten shown, up to 20 with a `⊞ N MORE` row), a 12-month contribution total with current-month
  heatmap and exact active-day counts, streak, the latest commit per repo (ten shown, up to 12), and
  a FEED of trending repos with total stars and click-to-expand READMEs. Opens with `⑂` or `alt+5`,
  independent of the chat, so you can collapse whichever rail is hogging the transcript. Without
  `gh` it shows a centered "No GitHub CLI connected" notice.
- **Notes (38 cols)** — a session-only notepad. `✎` or `alt+8` opens it; it shares the GitHub
  slot, so opening Notes hides GitHub and vice versa. Type or paste freely; the text survives
  closing/hiding the rail and `◫`, but is wiped on `/new`, `/resume`, `/reload`, or restart.
  Nothing is written to disk.
- **QA (40 cols)** — a browser-testing persona. It has an address field (localhost or any http(s)
  URL), a paste-friendly task box, one START/STOP button, DONE/NOW/NEXT progress, and a
  plain-English REPORT with a PASS/FAIL/BLOCKED verdict. Opening the rail focuses the first empty
  field; if a URL is pasted into TASK with no address, START points it back to ADDRESS. RESET
  appears after a stop or finish and clears the form, progress, report, and the run's artifacts. It
  can enable Flutter CanvasKit's hidden accessibility tree before reading the canvas. It does not
  read the main chat and has no shell or file tools. It shares the side-chat slot, so chat and QA are mutually exclusive;
  GitHub remains independent. The first run fetches Playwright MCP through `npx`; Windows uses
  Edge, other platforms use Chrome (`ETHER_QA_BROWSER` overrides the channel).
- **Footer (4 rows)** — tokens, cost, model, queue, uptime, message and tool counts.

## Try it

You need:

- **Node.js 22.19+** (pi's own requirement) and **pi** installed and logged in.
- A terminal with alt-screen and truecolor or 256 color. Mouse support is optional — every rail has
  full keyboard controls.

Then, from this folder:

```bash
npm run doctor   # checks your environment and prints what's missing
npm run setup    # installs the chrome into your pi agent directory
```

`setup` copies the extensions, all themes, and the font, merges only `theme` into your settings, and
backs up every file it replaces. It never touches your auth, sessions, or chat history.

Start pi (or run `/reload` if it's already open), switch to fullscreen mode, and you're done. To set
another theme, run `/settings` and pick `Bluether` or `ETHEREX`.

```bash
npm run restore              # undo: bring back the previous files
npm test                     # run the thirteen test harnesses
npm test -- --filter keyboard
```

Useful installer flags: `--target <dir>` installs into a sandbox, `--theme ETHEREX` picks a
theme, `--no-theme` copies files without touching settings, `--dry-run` shows the plan without
writing anything.

Once this is a git repo you can also install it as an ordinary pi package, which skips the copy
step entirely:

```bash
pi install git:github.com/ether-exe/Ether_Harness
```

## Keyboard

Global shortcuts work while the editor is focused. Once a rail has focus, `tab` / `shift+tab` cycle
between rails and `esc` returns to the editor.

| Key | Action |
|---|---|
| `alt+1` | Focus taskbar |
| `alt+2` | Focus Files |
| `alt+3` | Focus preview (needs an open file) |
| `alt+4` | Focus side chat |
| `alt+5` | Focus GitHub rail |
| `alt+6` | Toggle the Files rail |
| `alt+7` | Toggle the QA rail |
| `alt+8` | Toggle the Notes rail |
| `alt+l` | Toggle side rails (same as `◫`) |

Inside a rail, arrows or `j k` move, `pgup` / `pgdn` page, `home` / `end` jump, and `enter`
activates. A few rails do more:

- **Files** — `←` collapses or goes to the parent, `→` expands or goes to the first child, `enter`
  toggles folders and opens files. Opening a file by keyboard moves focus into the preview.
- **Preview** — scrolls; `esc` closes it and hands focus back to Files.
- **Chat** — `ctrl+↑` / `ctrl+↓` select messages, `ctrl+x` copies one, `ctrl+r` quotes it into the
  composer. `esc` clears the selection first, then leaves.
- **QA** — click a field to edit it; `alt+enter` starts or stops; `pageUp` / `pageDown` scroll the
  report. `esc` returns to the editor.
- **Notes** — type or paste; `pageUp` / `pageDown` move through the note; `esc` returns to the
  editor. The note is session-only.

## Themes

Three full dark themes ship with the harness, built token-first against the real surfaces:

- **Ether** — monochrome. One hue, hierarchy from lightness, with a single dark blue reserved for
  tool output, the model, and spend. Code previews use a fixed Dracula palette on the matte
  background.
- **Bluether** — deep-space navy panels, royal structure, ice text, cyan telemetry. The creative
  second theme.
- **ETHEREX** — true monochrome. Black panels, a pure-white main agent message, and a dimmer-white
  ladder for folders, files, thinking, headings, and syntax. No hue anywhere; the preview uses the
  theme's gray syntax tokens instead of Dracula.

All three are 56-token files in `themes/` — read one before writing your own; they double as
documentation. The Dracula preview on Ether/Bluether, and ETHEREX's native syntax colors, adapt to
truecolor and 256-color terminals automatically.

## Making it yours

The interesting seams to pull:

- `extensions/ether-sidebar.ts` is the whole chrome. It is one deliberately long file; constants at
  the top control every rail width, row count, and threshold, each with a comment explaining why.
- `themes/*.json` are plain token files. Swap hues, keep the structure.
- `tests/` render the real chrome with pi's own components and assert on layout math and ANSI
  output — start there if you're changing widths or colors, since they'll catch overflow and
  eviction bugs before your eyes have to.
- `install.mjs` and `doctor.mjs` are reusable as-is for any chrome you build on the same idea.

## Known limits

Honest ones:

- Fullscreen only. Regular mode has no chrome.
- The layout-root wrap uses a pi-internal API (`setLayoutRoot`) and may break on a future pi
  release. `doctor.mjs` warns when it finds a pi version this wasn't tested against.
- Side-chat history is text-only; tool calls are not persisted across restarts.
- The GitHub rail needs `gh` 2.x on PATH and a logged-in account. It caches for five minutes,
  fetches up to 20 repos and 12 latest commits (ten of each shown by default), and never writes to
  GitHub.
- The FEED scrapes github.com/trending (no API), so a markup change can empty it; READMEs are
  fetched only when you expand a repo and cached for the session.
- With chat and GitHub both open, the transcript narrows; collapse either rail with `✦` or `⑂`.
- QA shares the side-chat slot, so chat and QA cannot be visible at once.
- Notes is session-only. Closing the rail or collapsing the layout keeps the text; `/new`,
  `/resume`, `/reload`, or restarting pi wipes it. Nothing is persisted to disk.
- QA accepts public websites as well as localhost. It can fill forms, log in/out with test
  credentials, click, and verify UI. It works in an isolated browser profile, so it never inherits
  your existing logins, and it cannot solve CAPTCHA, OTP, or magic-link email flows.
- Navigation is gated to the supplied host and its subdomains. A local address can use loopback;
  a public address cannot probe services on your machine. Link clicks and redirects are not a hard
  security boundary, so don't point it at a site where an autonomous agent could do damage. Use
  test accounts and avoid destructive actions.
- The QA rail needs `npx` and a browser. Windows uses Edge; macOS/Linux need Chrome, or set
  `ETHER_QA_BROWSER` to `chrome`, `msedge`, `firefox`, or `webkit`. The first run may download the
  Playwright MCP package, and the browser is a fresh isolated profile with no existing logins.
- QA is an LLM browser tester: it can miss things or report a false failure. The action log and
  screenshots in `<agent-dir>/qa-artifacts` are the evidence. RESET deletes that run's artifacts.
- Flutter CanvasKit exposes no readable text until accessibility is enabled; the QA helper does
  that when it sees the hidden "Enable accessibility" button. Give the app a few seconds to boot
  before expecting the tree.
- The tests prove layout math, colors, keys, and focus. They cannot judge looks — that part needs
  your eyes.

## Platform notes

- **Windows Terminal** is the reference environment; `alt+1..4` arrive normally.
- **macOS** — iTerm2 works out of the box. In Terminal.app, enable **Option as Meta**, or the
  `alt+` shortcuts will type characters instead. Terminal.app tops out at 256 colors; the themes
  handle that.
- **Linux** — works in modern terminals. Clipboard copy needs `wl-copy` (Wayland) or `xclip` /
  `xsel` (X11); otherwise it falls back to OSC 52.
- **Fonts** — the wordmark uses braille cells, so your terminal font needs braille and
  box-drawing coverage. The bundled Isometra font is for rendering the wordmark as an image asset,
  licensed under the SIL OFL 1.1 (`assets/fonts/OFL.txt`).

## License

Harness code: MIT. Isometra font: SIL Open Font License 1.1. The Dracula palette is used as colors
only.
