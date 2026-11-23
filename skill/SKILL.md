---
name: playground
description: Open an HTML prototype or a running app in a Figma-like review editor where you can recolour, move, resize and add elements, pin comments and change requests, and click through pages as slides. "Save and send" hands the round to Claude, which applies it and redeploys the revision for you to confirm.
disable-model-invocation: true
---

# Playground

## Initial Response

When this skill is first invoked without a file, URL, or subcommand, respond only with:

> I'm ready to open an HTML file or a running app in the playground, so you can comment, request changes, and send them back for me to apply.

Do not provide any other information until the user asks a question.

## What it is

A local review editor around any HTML: a `/prototype` file, a static page, or a live dev server. The user selects elements, recolours them, drags and resizes them, adds things from a palette (buttons, cards, dropdowns, menus, popups, inputs, toggles, tabs, banners, badges, headings, text, lists, images), and right-clicks for **Click this button** (the real click fires and the page behaves normally), **Describe behavior** (what it should do when used), or **Request change** (a pinned comment). A click that leads to another page makes that page slide 2, 3, and so on. **Save and send** submits a round to Claude. Claude edits the real source, the editor reloads the revised page, and the user confirms or reopens each item.

The tool ships inside this skill folder as `dist/cli.js` (a Node script, no dependencies). This skill drives it; never reimplement it. It works on Windows, macOS and Linux.

## Hard Rules

1. **Never edit source until a round is submitted** (Save and send, or `apply`). Exploring, commenting and dragging only touch the session data (kept in `~/.playground/sessions/`, outside the project).
2. **Interpret intent, not pixels.** Recorded moves and resizes are rough hints. Never write `position: absolute`, `translate`, magic margins or one-off pixel widths to reproduce a drag (see Auto-align).
3. **Never guess.** If an item is ambiguous or can't be mapped to the source, record it as a `question`.
4. **One item at a time.** Finish each item and record its `pg result` before starting the next. That is how each change gets recorded on its own, so the user can undo it exactly later.
5. **What the user placed is what they asked for.** An inserted dropdown stays a dropdown, a button stays a button. Build that kind of control in the project's style. If you think a different control would be better, still build theirs and suggest the alternative in the note (or ask with `--state question` before building anything else). Never swap it silently.
6. **Write results through the CLI**, never by editing `session.json` by hand: the CLI goes through the running server so the editor updates live.
7. **Report honestly.** `applied` is Claude's claim; the developer's Confirm is the proof.

## Running commands

`SKILL_DIR` below is this skill's folder: the base directory shown when the skill loads (normally `~/.claude/skills/playground`). Pick a runner once per session, in this order:

1. **Node on this machine** (Windows, macOS, Linux): `node --version` prints v18 or later.
   `pg <command>` means `node "SKILL_DIR/dist/cli.js" <command>`. On Windows, forward slashes in the path are fine.
2. **Windows without Node, but with Node inside WSL**: `MSYS_NO_PATHCONV=1 wsl.exe -- bash -lc 'node --version'` prints v18 or later.
   Write SKILL_DIR as a WSL path: drive letter to `/mnt/<lowercase drive>`, forward slashes (`C:\Users\ana\.claude\skills\playground` becomes `/mnt/c/Users/ana/.claude/skills/playground`). `pg <command>` means:
   ```bash
   MSYS_NO_PATHCONV=1 wsl.exe -- bash -lc 'node /mnt/c/Users/ana/.claude/skills/playground/dist/cli.js <command>'
   ```
   File paths you pass to the CLI can stay Windows-style with forward slashes (`C:/Users/ana/site/index.html`); the CLI converts them. Don't put backslashes inside the `bash -lc` string: they get mangled on the way into WSL. A dev server must run inside WSL to be reachable.
3. **Neither**: tell the user Node.js 20+ is needed (https://nodejs.org) and stop.

If `SKILL_DIR/dist/cli.js` is missing, the skill was copied without its tool: tell the user to run the install script from the playground repo (`scripts/install.sh` on macOS/Linux/WSL/Git Bash, `scripts\install.ps1` in Windows PowerShell), and stop.

`serve` prints `PLAYGROUND editor=URL frame=URL session=DIR`. Pass that `DIR` as `--session DIR` to every later command, so two sessions on one machine never mix. Without it, commands use the most recently started session.

| Command | Use |
| --- | --- |
| `pg serve <file \| http://localhost:N> [--root PROJECT]` | Start the editor. `--root` is the project folder for URL targets (default: current folder) |
| `pg wait --session DIR` | Blocks until a round is sent, prints it, exits 0. Exits 3 with `STOPPED` if the server is gone |
| `pg show --session DIR [--round N] [--json]` | Print a round |
| `pg snapshot --session DIR --round N <files...>` | Copy files to the revision folder and track them. Optional in a git project (every changed file is tracked automatically); needed for files git ignores, and in folders without git |
| `pg result --session DIR --round N --item ID[,ID] --state applied\|question --note "..."` | Record one item's outcome, plus whatever changed since the last result |
| `pg result ... --note-file FILE` | Same, with the note read from a file. Use this on the WSL runner whenever the note has quotes, apostrophes or `$` |
| `pg finish --session DIR --round N` | Mark the round applied; the editor reloads and shows the review |
| `pg status --session DIR` | Per-slide summary |
| `pg stop --session DIR` | Stop the server |

## Invocations

| Invocation | Behavior |
| --- | --- |
| `<file.html>` | Start on that file, start the watcher, open the editor |
| `<http://localhost:3000>` | Same, proxying the running dev server (the actual app) |
| *(no path)* | Use the most recent `/prototype` HTML in the current folder |
| `apply` | Process the round that is waiting, same as after Save and send |
| `status` | Run `pg status` and summarise in a few lines |
| `stop` | Run `pg stop`; the background tasks then end on their own |

## Workflow

### 1. Preflight

- Pick the runner (see Running commands) and check `SKILL_DIR/dist/cli.js` exists.
- File target: an absolute path (on Windows, use forward slashes: `C:/Users/ana/site/index.html`).
- URL target: only `localhost` / `127.0.0.1` / `[::1]`, and the dev server must already be running. Pass `--root` with the project folder.

### 2. Start (two background Bash tasks)

1. `pg serve <path-or-url> [--root PROJECT]` in the background. Read its output file for the `PLAYGROUND editor=… session=…` line; the port may not be 4800 if that was busy.
2. `pg wait --session DIR` in the background. Its exit is what wakes you when the user presses Save and send. Don't poll.

Open the editor URL in the built-in browser pane (`preview_start` with `url`). Tell the user in one line where it is and the keys: `V` select, `I` interact, `A` add menu (`B` for a button), `C` comment, `'` grid, `Ctrl+Z` undo, `Ctrl+Enter` send.

If the editor shows **"This page keeps reloading itself"**, something outside the playground is reloading the page in a loop: usually a dev tool that reloads on any file change (VS Code Live Server, browser-sync), or a redirect loop in the app. Tell the user which, if you can see it from the project; the playground has already paused live reload and thumbnails.

### 3. A round arrives

The `wait` task's output is the round: slides, how each slide was reached, and every item with its id, selector, element and details. It ends with the exact commands for this round. Work through each item:

- **CHANGE REQUEST**: implement what it asks, following the project's conventions (file layout, naming, tokens).
- **STYLE**: change the style where it is defined (class, token, CSS variable; inline only if the file already works that way). If the new colour is close to an existing token, use the token and say so in the note.
- **TEXT**: change the copy in the source.
- **BEHAVIOR**: the user describes what an element should *do* ("on click, open the confirm popup; Cancel closes it"). It can sit on an existing element or on one they just added. Build the real interaction: state, handlers, navigation, show/hide, validation, whatever the description needs, in the project's stack and conventions. The inserted element is only a placeholder look; the behavior comment is the spec. If the description leaves something open (what the dropdown options are, where Confirm goes), use a sensible default and say which in the note, or ask with `--state question` if it changes the design.
- **INSERT / DUPLICATE**: add the real thing in that position. The line after INSERT names the kind: button, card, dropdown, menu, popup, input, toggle, tabs, banner, badge, heading, text, list or image. The kind is a requirement (Hard Rule 5): a placed dropdown becomes a real dropdown, never radio buttons, a toggle or a different layout. The markup shown is a neutral placeholder (inline styles, `data-pg-kind`). Rebuild it with the project's own components, classes and tokens, matching its nearest sibling, and drop `data-pg-id`, `data-pg-kind` and the placeholder inline styles. Kind hints:
  - **popup**: a real modal/dialog (not inline). Hidden until something opens it, unless a BEHAVIOR says otherwise; wire its Cancel and Confirm.
  - **menu**: a trigger that opens a list; **dropdown**: a select with the project's field style. Options are placeholders unless a BEHAVIOR names them.
  - **tabs**: working tabs that switch real panels, or ask what each tab shows.
  - **card**, **banner**, **badge**: use the project's existing card, alert and badge components if there are any.
- **DELETE**: remove the element (or the condition that renders it).
- **MOVE** and **RESIZE**: see Auto-align.
- **COMMENT**: no code change. Answer it in the note if it asks something, otherwise acknowledge it.

An inserted element and a BEHAVIOR on it are one piece of work: build the element and its interaction together, then write a `pg result` for **each** of the two item ids.

Order:
1. In a git project the playground recorded every file when the user pressed Save and send, so nothing is needed before editing. Outside git, or for files git ignores, `pg snapshot` them first (files you'll create count too).
2. For each item, in turn: make that item's edits, then immediately `pg result` for it. Don't start the next item first. The CLI saves exactly what changed since the previous result as this item's change, which lets the user undo it on its own.
3. Items you build together (an inserted popup and the BEHAVIOR on it) get one result: `--item id1,id2`.
4. `pg finish`.

The note is what the user reads in the editor, so write it for them: one or two plain sentences naming the file, what changed, and any choice you made for them ("used the project's Select; options are 1 set and 3 sets"). For `--state question`, the note **is the question**: ask exactly what you need to know, with the options you see ("Should Edit sets go back to choosing A, B and C, or open the print settings?"). Never a single word like "Unclear". Questions come back to the user as open items with your question on them.

On the WSL runner the note travels inside `bash -lc '…'`, so an apostrophe ends the string early. Write the note to a file with your file tool and pass `--note-file C:/path/to/note.txt` instead, or leave apostrophes out.

### Frozen slides

When the user comments on a live page, the editor saves a **frozen copy** of the page as it looked at that moment (an open menu, a filled form, a step in a flow) and pins the comment there, so it stays put however the page changes afterwards. In the round these slides say `FROZEN copy of …` with the live URL and the saved HTML (`frozen/<id>.html` in the session folder). Read that file to see the exact state the comment is about, such as which modal was open or what was typed, then change the **live page's source**. Never edit the frozen copy, and never try to reproduce that state in code unless the comment asks for it.

### Undo requests

The user can right-click anything Claude applied and pick **Undo change on this comment** / **Undo this change**. The editor first undoes it exactly from the recorded change. You only get an **UNDO** item when that wasn't possible: the item had no recorded change, or a later change edited the same lines. The item says which earlier item it was, what you did then, why the exact undo failed, and where the recorded before/after file contents are (`patches/<id>.json` in the session folder).

Revert **only that item's change**, keeping every other item's change (including the later one that overlapped). Follow the same order: `pg snapshot`, edit, `pg result --item <UNDO id>`, `pg finish`. The original item then shows as undone. If you can't separate the two changes cleanly, use `--state question` and say what would be lost.

### 4. Auto-align

The user drops things roughly and the editor snaps to a grid, but the code must come out clean. **Always align, whether or not the user pressed Auto align.** The editor lets elements overlap while you sketch, and new or duplicated elements float freely (absolute in the editor only). None of that is what the user wants shipped.

- **Placed freely** (INSERT/DUPLICATE marked "placed freely") and **Auto-aligned** moves: read where it sits and what it lines up with, then put it into the real layout there (the right flex/grid container, in order), not `position: absolute`.
- **Overlaps** in the editor are never intentional. If something ends up on top of another element, give it its own space in the layout.
- **Heavily misaligned surroundings**: in every container you touch, also fix what is clearly off. Edges a few pixels apart that should line up, uneven gaps between siblings, ragged baselines, mismatched heights in a row. Use the project's spacing scale. Mention it in the note ("also evened the gaps in the actions row to 12px"). Don't restyle containers you didn't touch.

- **Moves of a whole page or large container** (`main`, a page wrapper, a section spanning the page) by a few pixels are almost always accidental drags. Don't change the layout for them: record `applied` with a note that you left it as is, unless the label shows a clear intent.
- Read a move's **intent** from its neighbours ("now below Pay", "now right of Back") and its direction. It may be a reorder within a row or column, a spacing change, or a move into another container.
- Use the existing layout system: flex/grid order and gap, the project's spacing tokens, existing alignment utilities.
- An element dropped "roughly right of Pay" becomes a sibling in Pay's row with the same height, radius and gap, aligned to its neighbours' edges and baselines. Equalise gaps within a group.
- A **resize** says how big the user wants it, roughly. Read the label first: "now fills its container width" means full width (`width: 100%`, `align-self: stretch`, `w-full`, `flex: 1` in a row); "same width as card X" means match X (shared class, equal grid columns, `flex: 1` on both). Otherwise round to the project's size scale or tokens and prefer `min-width`/`max-width`, padding or grid tracks over a fixed width, so it still works at other screen sizes. Fixed heights are rarely right for text content; prefer padding or `min-height`.
- If the container has no layout system (absolutely positioned canvas, image map), ask with `--state question` rather than inventing one.
- If two layouts fit the drag, pick the one that touches less code and mention the other in the note.

### 5. Report and loop

- One or two lines in chat: round number, items applied, items left as questions, and that the revision is in the editor to confirm.
- Start `pg wait` again in the background, so the next Save and send reaches you.
- The user confirms or reopens items in the editor. Reopened items come back in the next round. Repeat until `stop`.
- Don't commit, push, or touch git. The user decides when it's done.

## Notes on `/prototype` files

A `/prototype` picker keeps the variant in `?v=N`, so each variant picked with *Click this button* becomes its own slide. Treat the picker as chrome: never apply comments or edits to it, only to the variant markup.

## Tone

Short and concrete. Name the file and the element in every note ("`checkout.html`: Cancel now sits left of Pay, gap 12px"). No celebration, and no summary of what the user can already see in the editor.
