import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { readPatch, recordItemPatch, revertContent, undoPatch, writeCheckpoint } from '../src/server/patches.ts';

let tmp: string;
let data: string;
let page: string;
let css: string;
const lines = (n: number, tag = 'line') => Array.from({ length: n }, (_, i) => `${tag} ${i + 1}`).join('\n') + '\n';
const read = (f: string) => fs.readFileSync(f, 'utf8');
const edit = (f: string, from: string, to: string) => fs.writeFileSync(f, read(f).replace(from, to));

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-patch-'));
  data = path.join(tmp, 'data');
  page = path.join(tmp, 'site', 'checkout.html');
  css = path.join(tmp, 'site', 'style.css');
  fs.mkdirSync(path.dirname(page), { recursive: true });
  fs.writeFileSync(page, lines(40));
  fs.writeFileSync(css, lines(10, 'rule'));
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('recording per-item changes', () => {
  it('splits a round into one patch per result', () => {
    writeCheckpoint(data, 1, [page, css]);
    edit(page, 'line 3\n', 'line 3 (pay button full width)\n');
    const a = recordItemPatch(data, 1, ['c1'])!;
    edit(page, 'line 30\n', 'line 30 (confirm step)\n');
    edit(css, 'rule 2\n', 'rule 2 changed\n');
    const b = recordItemPatch(data, 1, ['c2', 'o5'])!;
    expect(a.files.map((f) => path.basename(f.path))).toEqual(['checkout.html']);
    expect(b.files.map((f) => path.basename(f.path)).sort()).toEqual(['checkout.html', 'style.css']);
    expect(b.id).toBe('r1-c2+o5');
    expect(readPatch(data, a.id)?.items).toEqual(['c1']);
    expect(recordItemPatch(data, 1, ['c3'])).toBeNull(); // nothing changed since
  });

  it('tracks files created during the round', () => {
    const fresh = path.join(tmp, 'site', 'modal.js');
    writeCheckpoint(data, 1, [fresh]);
    fs.writeFileSync(fresh, 'export {}\n');
    const p = recordItemPatch(data, 1, ['c1'])!;
    expect(p.files[0]).toMatchObject({ before: null, after: 'export {}\n' });
    expect(undoPatch(p)).toMatchObject({ ok: true });
    expect(fs.existsSync(fresh)).toBe(false);
  });
});

describe('undoing one change', () => {
  it('undoes the first item and keeps the second, in the same file', () => {
    writeCheckpoint(data, 1, [page]);
    edit(page, 'line 3\n', 'line 3 (first)\n');
    const first = recordItemPatch(data, 1, ['c1'])!;
    edit(page, 'line 30\n', 'line 30 (second)\n');
    recordItemPatch(data, 1, ['c2']);
    expect(undoPatch(first)).toMatchObject({ ok: true });
    expect(read(page)).toContain('line 3\n');
    expect(read(page)).not.toContain('(first)');
    expect(read(page)).toContain('line 30 (second)');
  });

  it('undoes a change on the line right next to a later change', () => {
    writeCheckpoint(data, 1, [page]);
    edit(page, 'line 33\n', 'line 33 (place order)\n');
    const first = recordItemPatch(data, 1, ['c1'])!;
    edit(page, 'line 32\n', 'line 32 (keep shopping)\n');
    recordItemPatch(data, 1, ['c2']);
    expect(undoPatch(first)).toMatchObject({ ok: true });
    expect(read(page)).toContain('line 32 (keep shopping)\nline 33\n');
  });

  it('keeps lines added or removed elsewhere since', () => {
    writeCheckpoint(data, 1, [page]);
    edit(page, 'line 20\n', 'line 20 (first)\n');
    const first = recordItemPatch(data, 1, ['c1'])!;
    edit(page, 'line 2\n', 'line 2\ninserted a\ninserted b\n');
    edit(page, 'line 38\n', '');
    recordItemPatch(data, 1, ['c2']);
    expect(undoPatch(first)).toMatchObject({ ok: true });
    const out = read(page);
    expect(out).toContain('line 20\n');
    expect(out).toContain('inserted a\ninserted b\n');
    expect(out).not.toContain('line 38\n');
  });

  it('restores exactly when nothing changed since', () => {
    writeCheckpoint(data, 1, [page]);
    const original = read(page);
    fs.writeFileSync(page, 'completely different\n');
    const p = recordItemPatch(data, 1, ['c1'])!;
    expect(undoPatch(p)).toMatchObject({ ok: true });
    expect(read(page)).toBe(original);
  });

  it('reports a conflict when a later change touched the same lines, and writes nothing', () => {
    writeCheckpoint(data, 1, [page, css]);
    edit(page, 'line 3\n', 'line 3 (first)\n');
    edit(css, 'rule 1\n', 'rule 1 (first)\n');
    const first = recordItemPatch(data, 1, ['c1'])!;
    edit(page, 'line 3 (first)\n', 'line 3 (first, then second)\n');
    recordItemPatch(data, 1, ['c2']);
    const cssBefore = read(css);
    const out = undoPatch(first);
    expect(out.ok).toBe(false);
    expect(read(css)).toBe(cssBefore); // all or nothing
  });

  it('revertContent handles an unchanged file directly', () => {
    expect(revertContent({ path: 'x', before: 'a\n', after: 'b\n' }, 'b\n')).toEqual({ content: 'a\n' });
  });
});
