# playground

A Figma-like review editor for HTML, built for Claude Code. Open a `/prototype` file or your running app, click around it, mark it up, and hand the changes to Claude in one batch.

- **Select, recolour, edit text, drag.** Moves snap to an 8px grid and to neighbouring edges, with guides. Hold Alt to place freely.
- **Add things from a palette** (`A`): button, card, dropdown, menu, popup, input, toggle, tabs, banner, badge, heading, text, list, image. Pick one, then click the page to drop it.
- **Say what it should do.** Right-click any new or existing element → **Describe behavior…** ("on click, open the confirm popup; Cancel closes it"). Claude builds the real interaction from that note.
- **Undo everything** with `Ctrl+Z` / `Ctrl+Shift+Z`, or the toolbar buttons.
- **Right-click any element:**
  - **Click this button** fires the real click, so the page behaves normally.
  - **Request change…** and **Comment…** pin a note to the element.
- **Slides.** When a click opens another page, that page becomes slide 2. The slide records which button led there and can replay the path.
- **Save and send.** Edits and comments go to Claude as a numbered round. Claude edits the real source, turning rough drags into clean layout, and the editor reloads the revision. You **Confirm** or **Reopen** each item, with a side-by-side of your edits and Claude's result.

## Install

Run this in WSL (where Node lives):

```bash
git clone https://github.com/pizoeyyy/playground ~/dev/playground
~/dev/playground/scripts/install.sh
```

The script builds `dist/` and copies `skill/SKILL.md` to your Claude skills folder. On WSL that is the Windows user's `~/.claude/skills/playground`.

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
node dist/cli.js serve examples/two-page/index.html     # editor on http://localhost:4800
node dist/cli.js wait --session examples/two-page        # blocks until "Save and send"
node dist/cli.js show --session examples/two-page
node dist/cli.js result --session examples/two-page --round 1 --item <id> --state applied --note "..."
node dist/cli.js finish --session examples/two-page --round 1
```

### Keys

| Key | |
| --- | --- |
| `V` / `I` / `C` | Select · Interact · Comment |
| `A` / `B` | Add menu · Add a button |
| `'` | Grid |
| `Ctrl Z` / `Ctrl Shift Z` | Undo / redo |
| Arrows | Nudge 8px (Shift: 1px) |
| `Enter` / `Shift Enter` | Edit text / select parent |
| `Del`, `Ctrl D` | Delete, duplicate |
| `Ctrl Enter` | Save and send |

## How it works

- **`src/server`**
  - The editor runs on port N. The page runs on N+1: a static server for files, or a reverse proxy for a dev server, with WebSockets passed through for HMR.
  - Every HTML response gets `/__playground/agent.js` injected.
  - State lives in `.playground/session.json` next to the target, and changes stream to the editor over SSE.
- **`src/agent`** runs inside the page. It handles selection, dragging with snapping, ops and undo, navigation detection and thumbnails. It talks to the editor over `postMessage`.
- **`src/editor`** is the React UI: slides rail, stage, inspector, comments and the review card.
- **`src/shared`** holds the session model and a pure reducer, used by the server, the editor and the CLI.

The page's own clicks are intercepted only in Select, Button and Comment modes. Interact mode (`I`) and **Click this button** let them through.

Limits:
- A dev server on Windows isn't reachable from WSL. Run it inside WSL, or serve a built file.
- Edits made in the editor are re-applied by selector. A framework that re-renders a component can drop them until the next reload.

## Develop

```bash
npm install
npm run build
npm test
npm run typecheck
```
