// Per-item file changes, so one change Claude made can be undone exactly.
//
// When a round starts, the whole project folder is recorded as a git tree (the "base"), without
// touching the user's index or files. `snapshot` adds files to a checkpoint too. Each `result`
// compares the tracked files, plus every file git sees changed since the base, against the
// checkpoint, saves what changed as that item's patch, and moves the checkpoint on. Because the
// base is taken before Claude edits anything, a late `snapshot` no longer loses the "before". Undo restores an item's files, or reverse-applies its diff when later items edited the same
// file elsewhere. Overlapping edits are a conflict, and the undo goes to Claude instead.
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { diffArrays } from 'diff';
import { writeFileAtomic } from './store.ts';

export type FileChange = { path: string; before: string | null; after: string | null }; // null = file absent
export type ItemPatch = { id: string; round: number; items: string[]; files: FileChange[] };
type Checkpoint = Record<string, string | null>;

const checkpointFile = (dataDir: string, round: number) => path.join(dataDir, `checkpoint-r${round}.json`);
export const patchFile = (dataDir: string, id: string) => path.join(dataDir, 'patches', `${id}.json`);

const readOrNull = (f: string): string | null => {
  try {
    return fs.readFileSync(f, 'utf8');
  } catch {
    return null;
  }
};

function readCheckpoint(dataDir: string, round: number): Checkpoint {
  try {
    return JSON.parse(fs.readFileSync(checkpointFile(dataDir, round), 'utf8')) as Checkpoint;
  } catch {
    return {};
  }
}

// ---------- round base (git) ----------

type Base = { top: string; tree: string };
const baseFile = (dataDir: string, round: number) => path.join(dataDir, `base-r${round}.json`);

function git(cwd: string, args: string[], env?: Record<string, string>): string {
  return execFileSync('git', args, {
    cwd,
    encoding: 'utf8',
    env: { ...process.env, ...env },
    stdio: ['ignore', 'pipe', 'ignore'],
    maxBuffer: 512 * 1024 * 1024,
  });
}

/** The project folder as it is now (tracked and untracked, minus ignored) as a git tree. Leaves the user's index alone. */
function workTree(root: string): Base | null {
  let tmp = '';
  try {
    const top = path.resolve(git(root, ['rev-parse', '--show-toplevel']).trim());
    const index = path.resolve(top, git(top, ['rev-parse', '--git-path', 'index']).trim());
    tmp = path.join(os.tmpdir(), `playground-index-${process.pid}-${Date.now()}`);
    if (fs.existsSync(index)) fs.copyFileSync(index, tmp); // reuse its stat cache: much faster
    git(top, ['add', '-A', '.'], { GIT_INDEX_FILE: tmp });
    return { top, tree: git(top, ['write-tree'], { GIT_INDEX_FILE: tmp }).trim() };
  } catch {
    return null; // not a git project, or git missing: `snapshot` still works
  } finally {
    if (tmp) fs.rmSync(tmp, { force: true });
  }
}

function readBase(dataDir: string, round: number): Base | null {
  try {
    return JSON.parse(fs.readFileSync(baseFile(dataDir, round), 'utf8')) as Base;
  } catch {
    return null;
  }
}

/** Record the project as it is at the start of a round, once. Returns false when there's no git to use. */
export function ensureBase(dataDir: string, round: number, root: string | undefined): boolean {
  if (readBase(dataDir, round)) return true;
  if (!root) return false;
  const base = workTree(root);
  if (!base) return false;
  writeFileAtomic(baseFile(dataDir, round), JSON.stringify(base));
  return true;
}

/** Every file changed since the round's base, with its contents at the base (null = didn't exist). */
function changedSinceBase(dataDir: string, round: number): Map<string, string | null> {
  const out = new Map<string, string | null>();
  const base = readBase(dataDir, round);
  if (!base) return out;
  const now = workTree(base.top);
  if (!now || now.tree === base.tree) return out;
  let names: string[];
  try {
    names = git(base.top, ['diff-tree', '-r', '--name-only', '-z', base.tree, now.tree]).split('\0').filter(Boolean);
  } catch {
    return out;
  }
  for (const rel of names) {
    if (rel.split('/').includes('.playground')) continue; // legacy session folder inside the project
    let before: string | null = null;
    try {
      before = git(base.top, ['cat-file', 'blob', `${base.tree}:${rel}`]);
    } catch {
      /* created during the round */
    }
    out.set(path.resolve(base.top, rel), before);
  }
  return out;
}

/** Start (or extend) tracking these files for the round, recording their contents before the round's edits. */
export function writeCheckpoint(dataDir: string, round: number, files: string[]) {
  const cp = readCheckpoint(dataDir, round);
  const changed = files.some((f) => !(path.resolve(f) in cp)) ? changedSinceBase(dataDir, round) : new Map();
  for (const f of files.map((x) => path.resolve(x))) {
    if (f in cp) continue;
    // Already edited before the snapshot: those edits are still unrecorded, so start from the base.
    cp[f] = changed.has(f) ? changed.get(f)! : readOrNull(f);
  }
  writeFileAtomic(checkpointFile(dataDir, round), JSON.stringify(cp));
}

/**
 * Record what changed in the tracked files since the last checkpoint as the patch for `items`.
 * Returns the patch id, or null when nothing changed (or nothing is tracked).
 */
export function recordItemPatch(dataDir: string, round: number, items: string[]): ItemPatch | null {
  const cp = readCheckpoint(dataDir, round);
  // Files edited since the round started that were never snapshotted are tracked from the base.
  for (const [f, before] of changedSinceBase(dataDir, round)) if (!(f in cp)) cp[f] = before;
  const files: FileChange[] = [];
  for (const [f, before] of Object.entries(cp)) {
    const after = readOrNull(f);
    if (after !== before) {
      files.push({ path: f, before, after });
      cp[f] = after;
    }
  }
  if (!files.length) return null;
  const patch: ItemPatch = { id: `r${round}-${items.join('+')}`, round, items, files };
  writeFileAtomic(patchFile(dataDir, patch.id), JSON.stringify(patch));
  writeFileAtomic(checkpointFile(dataDir, round), JSON.stringify(cp));
  return patch;
}

export function readPatch(dataDir: string, id: string): ItemPatch | null {
  try {
    return JSON.parse(fs.readFileSync(patchFile(dataDir, id), 'utf8')) as ItemPatch;
  } catch {
    return null;
  }
}

/** What a file should become to undo one change, given its current contents. null = conflict. */
export function revertContent(change: FileChange, current: string | null): { content: string | null } | null {
  if (current === change.after) return { content: change.before }; // untouched since: exact restore
  if (change.before === null || change.after === null || current === null) return null; // created/deleted, then changed
  // Three-way merge on lines, with the item's result as the base: keep everything changed since
  // (base -> current) and take back this item's change (base -> before). Only touching lines conflict.
  const merged = merge3(splitLines(change.after), splitLines(current), splitLines(change.before));
  return merged === null ? null : { content: merged.join('') };
}

const splitLines = (s: string) => s.split(/(?<=\n)/).filter((l) => l !== '');

/** A replacement of base[start, end) with `lines`. start === end is a pure insertion. */
type Hunk = { start: number; end: number; lines: string[] };

function hunks(base: string[], other: string[]): Hunk[] {
  const out: Hunk[] = [];
  let i = 0;
  let open: Hunk | null = null;
  for (const part of diffArrays(base, other)) {
    if (!part.added && !part.removed) {
      if (open) out.push(open);
      open = null;
      i += part.count ?? part.value.length;
      continue;
    }
    open ??= { start: i, end: i, lines: [] };
    if (part.removed) {
      i += part.value.length;
      open.end = i;
    } else open.lines.push(...part.value);
  }
  if (open) out.push(open);
  return out;
}

function merge3(base: string[], ours: string[], theirs: string[]): string[] | null {
  const a = hunks(base, ours);
  const b = hunks(base, theirs);
  for (const x of a)
    for (const y of b) {
      const overlap = x.start < y.end && y.start < x.end;
      const samePoint = x.start === y.start; // two edits at one spot: order unknowable
      const insideOther = (x.start === x.end && y.start < x.start && x.start < y.end) || (y.start === y.end && x.start < y.start && y.start < x.end);
      if (overlap || samePoint || insideOther) return null;
    }
  const all = [...a, ...b].sort((x, y) => x.start - y.start || x.end - y.end);
  const out: string[] = [];
  let i = 0;
  for (const h of all) {
    out.push(...base.slice(i, h.start), ...h.lines);
    i = h.end;
  }
  out.push(...base.slice(i));
  return out;
}

export type UndoOutcome = { ok: true; files: string[] } | { ok: false; reason: string };

/** Undo one recorded change. All or nothing: every file is worked out before any is written. */
export function undoPatch(patch: ItemPatch): UndoOutcome {
  const plan: { path: string; content: string | null }[] = [];
  for (const change of patch.files) {
    const r = revertContent(change, readOrNull(change.path));
    if (!r) return { ok: false, reason: `${path.basename(change.path)} was changed again in the same place since` };
    plan.push({ path: change.path, content: r.content });
  }
  for (const p of plan) {
    if (p.content === null) fs.rmSync(p.path, { force: true });
    else writeFileAtomic(p.path, p.content);
  }
  return { ok: true, files: plan.map((p) => p.path) };
}
