import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { describeOp } from '../src/shared/describe.ts';
import { defaultDataDir, HOME_DIR, resolveDataDir } from '../src/server/store.ts';

describe('session data folder', () => {
  it('lives outside the project, one folder per target', () => {
    const a = defaultDataDir('/work/site/index.html');
    const b = defaultDataDir('/other/site/index.html');
    expect(a.startsWith(path.join(HOME_DIR, 'sessions'))).toBe(true);
    expect(path.basename(a)).toMatch(/^index-html-[0-9a-f]{6}$/);
    expect(a).not.toBe(b);
    expect(path.basename(defaultDataDir('http://localhost:5173'))).toMatch(/^localhost-5173-[0-9a-f]{6}$/);
  });

  it('still opens the older in-project .playground layout', () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pg-'));
    expect(resolveDataDir(dir)).toBe(dir);
    fs.mkdirSync(path.join(dir, '.playground'));
    fs.writeFileSync(path.join(dir, '.playground', 'session.json'), '{}');
    expect(resolveDataDir(dir)).toBe(path.join(dir, '.playground'));
    fs.rmSync(dir, { recursive: true });
  });
});

describe('describeOp', () => {
  it('spells out a resize for Claude', () => {
    const text = describeOp({
      id: 'o1',
      slide: 's1',
      kind: 'resize',
      selector: '.card',
      element: 'card "Plan"',
      label: 'Resized card "Plan" to 320 × 180 (was 280 × 180), now fills its container width',
      prop: 'size',
      before: '280 × 180',
      after: '320px auto',
      at: 0,
    });
    expect(text).toContain('RESIZE card "Plan"');
    expect(text).toContain('now fills its container width');
    expect(text).toContain('size was 280 × 180; dragged to 320px auto');
  });
});
