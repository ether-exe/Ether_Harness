# Ether Harness

A hand-built terminal chrome for [pi](https://pi.dev).

Out of the box, pi is a single scrolling transcript. Ether turns it into a cockpit: an animated
header with live session telemetry, a taskbar rail on the far left, a file tree, an IDE-style file
preview, and an isolated side chat that never mixes with your main conversation. Everything works
with the mouse or entirely from the keyboard.

This started as my personal setup and is shared as a working reference, not a polished product. If
you want pi to look and behave differently, the tricks in here — wrapping the layout root, the theme
tokens, the test harness — should transfer easily to your own chrome.

```
┌──┬──────────────────────────────┬───────────────────────────┬────────────────┐
│⌂ │  ▄▄▄▄ ▄▄▄ ▄▄   ETHER         │ deepseek · context · $0.05│ Chat           │
│▤ │  header · 3 rows of wordmark │ ▰▰▰▰▰▰▰▰▱▱ 62%           │ ╭────────────╮ │
│⌕ │                              │ working · session · cwd   │ │ you        │ │
│⌁ ├──────────────┬───────────────┴───────────────────────────┤ ╰────────────╯ │
│⎇ │ Files        │                                           │                │
│◫ │ ▸ src/       │            transcript                     │  ether         │
│⬡ │ ▸ tests/     │                                           │ ╭────────────╮ │
│◷ │ ▸ README.md  │                                           │ ╰────────────╯ │
│⟳ ├──────────────┴───────────────────────────────────────────┴────────────────┤
│≡ │ CWD …  TOK ↑45k ↓23k  COST $0.052  QUEUE …  UP 2m07s  MSG 51  TOOL 49    │
└──┴───────────────────────────────────────────────────────────────────────────┘
```

## How it fits together

Pi's TUI has no sidebar or header slots, so the extension does something slightly naughty: it wraps
the fullscreen layout root. Your transcript, dock, and footer keep working untouched inside the
wrapped layout, and the chrome lives around it. That's also why this is **fullscreen mode only** —
regular scrollback mode has no layout root to wrap.

Deleting the one extension file gets you back to stock pi. No build step, no npm dependencies: pi
loads the TypeScript directly through jiti, and the themes are plain JSON.

The pieces, briefly:

- **Header (7 rows)** — braille wordmark, model, context bar, live spend, input/output tokens,
  session name, uptime. Fields drop whole from the right when the terminal narrows.
- **Taskbar (5 cols)** — an icon rail that is always visible. `◫` collapses all side rails, `✦`
  toggles just the side chat, and most other icons are honest about being inert.
- **Files (24 cols)** — the session directory as a tree, auto-refreshing. Clicking a file opens the
  preview; the tree steps aside while it's open.
- **Preview (47 cols)** — opens in the left slot with line numbers and soft-wrapped prose or
  Dracula-highlighted code. Refreshes on file change.
- **Side chat (40 cols)** — a genuinely separate conversation with its own model. It sees its own
  history only, never the main transcript, and cannot touch your files.
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

`setup` copies the extension, both themes, and the font, merges only `theme` into your settings, and
backs up every file it replaces. It never touches your auth, sessions, or chat history.

Start pi (or run `/reload` if it's already open), switch to fullscreen mode, and you're done. To set
the other theme, run `/settings` and pick `Bluether`.

```bash
npm run restore              # undo: bring back the previous files
npm test                     # run the seven test harnesses
npm test -- --filter keyboard
```

Useful installer flags: `--target <dir>` installs into a sandbox, `--theme Bluether` picks the other
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
| `alt+l` | Toggle side rails (same as `◫`) |

Inside a rail, arrows or `j k` move, `pgup` / `pgdn` page, `home` / `end` jump, and `enter`
activates. A few rails do more:

- **Files** — `←` collapses or goes to the parent, `→` expands or goes to the first child, `enter`
  toggles folders and opens files. Opening a file by keyboard moves focus into the preview.
- **Preview** — scrolls; `esc` closes it and hands focus back to Files.
- **Chat** — `ctrl+↑` / `ctrl+↓` select messages, `ctrl+x` copies one, `ctrl+r` quotes it into the
  composer. `esc` clears the selection first, then leaves.

## Themes

Two full dark themes ship with the harness, built token-first against the real surfaces:

- **Ether** — monochrome. One hue, hierarchy from lightness, with a single dark blue reserved for
  tool output, the model, and spend. Code previews use a fixed Dracula palette on the matte
  background.
- **Bluether** — deep-space navy panels, royal structure, ice text, cyan telemetry. The creative
  second theme.

Both are 56-token files in `themes/` — read one before writing your own; they double as
documentation. Dracula code highlighting adapts to truecolor and 256-color terminals automatically.

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
- A fullscreen → regular → fullscreen switch loses the chrome until restart.
- The layout-root wrap uses a pi-internal API (`setLayoutRoot`) and may break on a future pi
  release. `doctor.mjs` warns when it finds a pi version this wasn't tested against.
- Side-chat history is text-only; tool calls are not persisted across restarts.
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
