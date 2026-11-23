import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { parse } from '../src/server/args.ts';
import { ensureBase, recordItemPatch, undoPatch, writeCheckpoint } from '../src/server/patches.ts';

let tmp: string;
let data: string;
let repo: string;
const read = (f: string) => fs.readFileSync(f, 'utf8');
const edit = (f: string, from: string, to: string) => fs.writeFileSync(f, read(f).replace(from, to));
const git = (...args: string[]) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' });

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-base-'));
  data = path.join(tmp, 'data');
  repo = path.join(tmp, 'app');
  fs.mkdirSync(path.join(repo, 'src'), { recursive: true });
  fs.writeFileSync(path.join(repo, 'src', 'form.tsx'), 'a\nb\nc\nd\ne\nf\ng\nh\n');
  fs.writeFileSync(path.join(repo, 'src', 'actions.ts'), 'one\ntwo\nthree\n');
  fs.writeFileSync(path.join(repo, '.gitignore'), 'ignored/\n');
  git('init', '-q');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'add', '-A');
  git('-c', 'user.email=t@t', '-c', 'user.name=t', 'commit', '-qm', 'init');
  fs.writeFileSync(path.join(repo, 'src', 'actions.ts'), 'one\ntwo (uncommitted)\nthree\n'); // dirty before the round
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

describe('round base from git', () => {
  it('records each item without any snapshot, and leaves the index alone', () => {
    const form = path.join(repo, 'src', 'form.tsx');
    const actions = path.join(repo, 'src', 'actions.ts');
    const status = git('status', '--porcelain');
    expect(ensureBase(data, 1, repo)).toBe(true);
    edit(form, 'b\n', 'b (dropdown)\n');
    fs.writeFileSync(path.join(repo, 'src', 'migration.sql'), 'create table x;\n');
    const a = recordItemPatch(data, 1, ['o1'])!;
    expect(a.files.map((f) => path.basename(f.path)).sort()).toEqual(['form.tsx', 'migration.sql']);
    expect(a.files.find((f) => f.path.endsWith('migration.sql'))!.before).toBeNull();
    edit(form, 'g\n', 'g (button)\n');
    edit(actions, 'three\n', 'three (single set)\n');
    const b = recordItemPatch(data, 1, ['o2'])!;
    expect(b.files.map((f) => path.basename(f.path)).sort()).toEqual(['actions.ts', 'form.tsx']);
    // The uncommitted line from before the round is the "before", not HEAD.
    expect(b.files.find((f) => f.path.endsWith('actions.ts'))!.before).toBe('one\ntwo (uncommitted)\nthree\n');
    expect(undoPatch(a).ok).toBe(true);
    expect(read(form)).toBe('a\nb\nc\nd\ne\nf\ng (button)\nh\n');
    expect(fs.existsSync(path.join(repo, 'src', 'migration.sql'))).toBe(false);
    expect(git('diff', '--cached', '--name-only')).toBe(''); // the user's index is untouched
    expect(status).toBe(' M src/actions.ts\n');
  });

  it('keeps the real "before" when the snapshot comes after the edit', () => {
    const form = path.join(repo, 'src', 'form.tsx');
    ensureBase(data, 2, repo);
    edit(form, 'c\n', 'c (radio cards)\n');
    writeCheckpoint(data, 2, [form]); // too late, as in the run that lost its patches
    const p = recordItemPatch(data, 2, ['o1'])!;
    expect(p.files[0].before).toBe('a\nb\nc\nd\ne\nf\ng\nh\n');
  });

  it('ignores files git ignores unless snapshotted', () => {
    ensureBase(data, 3, repo);
    fs.mkdirSync(path.join(repo, 'ignored'));
    fs.writeFileSync(path.join(repo, 'ignored', 'cache.txt'), 'x');
    expect(recordItemPatch(data, 3, ['o1'])).toBeNull();
  });

  it('does nothing outside git', () => {
    const plain = path.join(tmp, 'plain');
    fs.mkdirSync(plain);
    expect(ensureBase(data, 4, plain)).toBe(false);
  });
});

describe('note parsing', () => {
  it('keeps a note whose quotes were stripped on the way into WSL', () => {
    const { flags } = parse(['--round', '1', '--item', 'o1', '--state', 'question', '--note', 'Should', 'Edit', 'sets', 'open', 'print', 'settings?', '--session', '/x']);
    expect(flags.note).toBe('Should Edit sets open print settings?');
    expect(flags.session).toBe('/x');
    expect(flags.state).toBe('question');
  });
  it('keeps words that only look like flags', () => {
    const { flags } = parse(['--note', 'use', '--force-sets', 'carefully', '--round', '2']);
    expect(flags.note).toBe('use --force-sets carefully');
    expect(flags.round).toBe('2');
  });
});
