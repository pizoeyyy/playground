// Per-item file changes, so one change Claude made can be undone exactly.
//
// `snapshot` writes a checkpoint of the files Claude is about to edit. Each `result` compares those
// files against the checkpoint, saves what changed as that item's patch, and moves the checkpoint
// on. Undo restores an item's files, or reverse-applies its diff when later items edited the same
// file elsewhere. Overlapping edits are a conflict, and the undo goes to Claude instead.
import fs from 'node:fs';
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

/** Start (or extend) tracking these files for the round, recording their current contents. */
export function writeCheckpoint(dataDir: string, round: number, files: string[]) {
  const cp = readCheckpoint(dataDir, round);
  for (const f of files) if (!(f in cp)) cp[f] = readOrNull(f);
  writeFileAtomic(checkpointFile(dataDir, round), JSON.stringify(cp));
}

/**
 * Record what changed in the tracked files since the last checkpoint as the patch for `items`.
 * Returns the patch id, or null when nothing changed (or nothing is tracked).
 */
export function recordItemPatch(dataDir: string, round: number, items: string[]): ItemPatch | null {
  const cp = readCheckpoint(dataDir, round);
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
