# playground

A Figma-like review editor for HTML, built for Claude Code. Open a `/prototype` file or your running app, click around it, mark it up, and hand the changes to Claude in one batch. Works on Windows, macOS and Linux.

- **Select, recolour, edit text, drag and resize.** Moves and resizes snap to an 8px grid, to neighbouring edges and to sibling sizes, with guides. Shift keeps proportions while resizing; hold Alt to place freely.
- **Things can overlap while you sketch.** New and duplicated elements float where you put them, and resizes grow over neighbours instead of pushing them, so nothing else moves by accident.
- **Auto align** (toolbar button, `Shift+A`) tidies everything you moved, resized or added: lines up edges and centres with neighbours, evens out gaps, and steps things off overlaps. One `Ctrl+Z` undoes it. Claude aligns properly in the real code either way, and fixes clearly misaligned spacing in the containers it touches.
- **Add things from a palette** (`A`): button, card, dropdown, menu, popup, input, toggle, tabs, banner, badge, heading, text, list, image. Pick one, then click the page to drop it.
- **Say what it should do.** Right-click any new or existing element → **Describe behavior…** ("on click, open the confirm popup; Cancel closes it"). Claude builds the real interaction from that note.
- **Undo everything** with `Ctrl+Z` / `Ctrl+Shift+Z`, or the toolbar buttons.
- **Right-click any element:**
  - **Click this button** fires the real click, so the page behaves normally.
  - **Request change…** and **Comment…** pin a note to the element.
- **Comments freeze the page.** When you comment, the page as it looks right then (an open menu, a filled form, a revealed message) is saved as a frozen slide with your comment pinned to it, so it never moves, however the live page changes afterwards. The pin also shows on the live page while its element is still there. Comments made without changing the page in between share one frozen copy.
- **Slides.** When a click opens another page, that page becomes slide 2. The slide records which button led there and can replay the path.
- **Save and send.** Edits and comments go to Claude as a numbered round. Claude edits the real source, turning rough drags and sizes into clean layout, and the editor reloads the revision. You **Confirm** or **Reopen** each item, with a side-by-side of your edits and Claude's result.
- **Undo one change Claude made.** Right-click a comment pin, a comment card or a revision item → **Undo change on this comment** (or **Undo this change**). Claude's changes are recorded item by item, so the undo restores exactly the lines that item changed, even when later items edited the same file. Only when a later change touched those same lines does the undo go to Claude to untangle by hand.

## Install

You need [Node.js 20+](https://nodejs.org) and git.

**macOS / Linux / WSL / Git Bash on Windows**

```bash
git clone https://github.com/pizoeyyy/playground
./playground/scripts/install.sh
```

**Windows PowerShell**

```powershell
git clone https://github.com/pizoeyyy/playground
powershell -ExecutionPolicy Bypass -File playground\scripts\install.ps1
```

The script builds the tool and copies the skill to `~/.claude/skills/playground`: `SKILL.md` plus `dist/` (the tool itself), so the skill runs without the repo. To update, `git pull` and run the script again.

On WSL the script also installs to the Windows user's `.claude/skills`, for Claude Code on the Windows side. If Windows has no Node of its own, the skill runs the tool through WSL's Node.

## Use

In Claude Code:

```
/playground path/to/page.html
/playground http://localhost:5173
/playground status
/playground stop
```

Or run the CLI directly:

```bash
node dist/cli.js serve examples/two-page/index.html   # prints: PLAYGROUND editor=http://localhost:4800 ... session=DIR
node dist/cli.js wait --session DIR                    # blocks until "Save and send"
node dist/cli.js show --session DIR
node dist/cli.js result --session DIR --round 1 --item <id> --state applied --note "..."
node dist/cli.js finish --session DIR --round 1
```

Without `--session`, commands use the most recently started session.

### Keys

| Key | |
| --- | --- |
| `V` / `I` / `C` | Select · Interact · Comment |
| `A` / `B` | Add menu · Add a button |
| `'` | Grid |
| `Ctrl Z` / `Ctrl Shift Z` | Undo / redo |
| Arrows | Nudge 8px (Shift: 1px) |
| Handles | Resize (Shift: keep proportions, Alt: no snapping) |
| `Enter` / `Shift Enter` | Edit text / select parent |
| `Del`, `Ctrl D` | Delete, duplicate |
| `Ctrl Enter` | Save and send |

## How it works

- **`src/server`**
  - The editor runs on port N. The page runs on N+1: a static server for files, or a reverse proxy for a dev server, with WebSockets passed through for HMR.
  - Every HTML response gets `/__playground/agent.js` injected.
  - Session state, thumbnails and snapshots live in `~/.playground/sessions/<name>/`, outside your project, so they never trip a file watcher. Changes stream to the editor over SSE.
  - Live reload for files watches only the files the page actually loaded.
- **`src/agent`** runs inside the page. It handles selection, dragging and resizing with snapping, ops and undo, navigation detection and thumbnails. It talks to the editor over `postMessage`.
- **`src/editor`** is the React UI: slides rail, stage, inspector, comments and the review card.
- **`src/shared`** holds the session model and a pure reducer, used by the server, the editor and the CLI.

The page's own clicks are intercepted only in Select, Add and Comment modes. Interact mode (`I`) and **Click this button** let them through.

## Troubleshooting

**"This page keeps reloading itself."** If the page reloads 4 times in 10 seconds on its own, the editor pauses live reload and thumbnails and shows this banner. Something outside the playground is reloading the page. Usually that's a dev tool that reloads on any file change in the folder (VS Code Live Server, browser-sync, a static server with live reload), or a redirect loop in the app. Fix the tool's ignore list, or open the HTML file directly with `/playground file.html` instead of through that server.

**The skill can't find the tool.** The skill folder needs `dist/` next to `SKILL.md`. Copying only `SKILL.md` isn't enough; run the install script.

Limits:
- With the WSL fallback on Windows, a dev server on the Windows side isn't reachable from WSL. Run it inside WSL, or install Node on Windows.
- Edits made in the editor are re-applied by selector. A framework that re-renders a component can drop them until the next reload.

## Develop

```bash
npm install
npm run build
npm test
npm run typecheck
```
