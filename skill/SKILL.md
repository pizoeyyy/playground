---
name: playground
description: Open an HTML prototype or a running app in a Figma-like review editor where you can recolour, move and add buttons, pin comments and change requests, and click through pages as slides. "Save and send" hands the round to Claude, which applies it and redeploys the revision for you to confirm.
disable-model-invocation: true
---

# Playground

## Initial Response

When this skill is first invoked without a file, URL, or subcommand, respond only with:

> I'm ready to open an HTML file or a running app in the playground, so you can comment, request changes, and send them back for me to apply.

Do not provide any other information until the user asks a question.

## What it is

A local review editor around any HTML: a `/prototype` file, a static page, or a live dev server. The user selects elements, recolours them, drags and adds buttons, and right-clicks for **Click this button** (the real click fires and the page behaves normally) or **Request change** (a pinned comment). A click that leads to another page makes that page slide 2, 3, and so on. **Save and send** submits a round to Claude. Claude edits the real source, the editor reloads the revised page, and the user confirms or reopens each item.

The tool lives in `~/dev/playground` inside WSL Ubuntu (Node and `gh` exist only there). This skill drives it; never reimplement it.

## Hard Rules

1. **Never edit source until a round is submitted** (Save and send, or `apply`). Exploring, commenting and dragging only touch `.playground/session.json`.
2. **Interpret intent, not pixels.** Recorded moves are rough hints. Never write `position: absolute`, `translate`, or magic margins to reproduce a drag (see Auto-align).
3. **Never guess.** If an item is ambiguous or can't be mapped to the source, record it as a `question`.
4. **Snapshot before editing** with `playground snapshot`, so the round can be rolled back.
5. **Write results through the CLI**, never by editing `session.json` by hand: the CLI goes through the running server so the editor updates live.
6. **Report honestly.** `applied` is Claude's claim; the developer's Confirm is the proof.

## Running commands

All commands run in WSL. From the Bash tool on Windows, prefix `MSYS_NO_PATHCONV=1` so Git Bash doesn't rewrite `/tmp` or `/mnt` paths, and use a login shell so Node is on the PATH:

```bash
MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc "cd ~/dev/playground && node dist/cli.js <command> ..."
```

Below, `pg <command>` is short for that. Every command after `serve` takes `--session DIR`: the folder holding `.playground/`. For a file target it is the file's folder; for a URL target it is the project folder you pass to `serve`.

| Command | Use |
| --- | --- |
| `pg serve <file \| http://localhost:N> [--session DIR]` | Start the editor. Prints `PLAYGROUND editor=URL frame=URL session=PATH` |
| `pg wait --session DIR` | Blocks until a round is sent, prints it, exits 0. Exits 3 with `STOPPED` if the server is gone |
| `pg show --session DIR [--round N] [--json]` | Print a round |
| `pg snapshot --session DIR --round N <files...>` | Copy files to `.playground/revisions/rN/` before editing |
| `pg result --session DIR --round N --item ID --state applied\|question --note "..."` | Record one item's outcome |
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

- `pg` must exist: `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- bash -lc "test -f ~/dev/playground/dist/cli.js && echo ok"`. If not, tell the user to run `~/dev/playground/scripts/install.sh` in WSL, and stop.
- File target: convert the Windows path with `MSYS_NO_PATHCONV=1 wsl.exe -d Ubuntu -- wslpath -u 'C:\path\to\file.html'`.
- URL target: only `localhost` / `127.0.0.1` / `[::1]`. The dev server must run **inside WSL**; a server on Windows isn't reachable from there. Pass `--session` with the project's WSL path.

### 2. Start (two background Bash tasks)

1. `pg serve <wsl-path-or-url> [--session DIR]` in the background. Read its output file for the `PLAYGROUND editor=…` line; the port may not be 4800 if that was busy.
2. `pg wait --session DIR` in the background. Its exit is what wakes you when the user presses Save and send. Don't poll.

Open the editor URL in the built-in browser pane (`preview_start` with `url`). Tell the user in one line where it is and the keys: `V` select, `I` interact, `B` add button, `C` comment, `'` grid, `Ctrl+Z` undo, `Ctrl+Enter` send.

### 3. A round arrives

The `wait` task's output is the round: slides, how each slide was reached, and every item with its id, selector, element and details. Work through each item:

- **CHANGE REQUEST**: implement what it asks, following the project's conventions (file layout, naming, tokens).
- **STYLE**: change the style where it is defined (class, token, CSS variable; inline only if the file already works that way). If the new colour is close to an existing token, use the token and say so in the note.
- **TEXT**: change the copy in the source.
- **INSERT / DUPLICATE**: add a real element in that position, matching its nearest sibling's markup and classes. Drop `data-pg-id`.
- **DELETE**: remove the element (or the condition that renders it).
- **MOVE**: see Auto-align.
- **COMMENT**: no code change. Answer it in the note if it asks something, otherwise acknowledge it.

Order: `pg snapshot` the files you'll touch, edit them, then one `pg result` per item, then `pg finish`. Notes are one plain sentence naming the file and what changed. Use `--state question` with the question as the note when you can't proceed. Questions come back to the user as open change requests.

### 4. Auto-align

The user drops things roughly and the editor snaps to a grid, but the code must come out clean.

- Read a move's **intent** from its neighbours ("now below Pay", "now right of Back") and its direction. It may be a reorder within a row or column, a spacing change, or a move into another container.
- Use the existing layout system: flex/grid order and gap, the project's spacing tokens, existing alignment utilities.
- An element dropped "roughly right of Pay" becomes a sibling in Pay's row with the same height, radius and gap, aligned to its neighbours' edges and baselines. Equalise gaps within a group.
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
