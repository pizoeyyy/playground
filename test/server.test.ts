import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { resolveInside } from '../src/server/frame.ts';
import { AGENT_PATH, injectAgent } from '../src/server/inject.ts';

describe('injectAgent', () => {
  it('goes first inside <head>', () => {
    const out = injectAgent('<!doctype html><html><head><title>x</title></head><body></body></html>', 'http://localhost:4800');
    expect(out).toMatch(new RegExp(`<head><script src="${AGENT_PATH}\\?editor=http%3A%2F%2Flocalhost%3A4800"></script><title>`));
  });
  it('handles head attributes, missing head, and runs once', () => {
    expect(injectAgent('<head lang="en"><x>', 'e')).toContain('<head lang="en"><script');
    expect(injectAgent('<html><body>hi</body></html>', 'e')).toMatch(/^<html><script/);
    expect(injectAgent('<p>hi</p>', 'e')).toMatch(/^<script/);
    const once = injectAgent('<head></head>', 'e');
    expect(injectAgent(once, 'e')).toBe(once);
  });
});

describe('resolveInside', () => {
  const root = path.resolve('/srv/site');
  it('resolves normal paths', () => {
    expect(resolveInside(root, '/css/a.css')).toBe(path.join(root, 'css/a.css'));
    expect(resolveInside(root, '/My%20Page.html')).toBe(path.join(root, 'My Page.html'));
  });
  it('refuses traversal and the session folder', () => {
    expect(resolveInside(root, '/../secret')).toBeNull();
    expect(resolveInside(root, '/%2e%2e/secret')).toBeNull();
    expect(resolveInside(root, '/.playground/session.json')).toBeNull();
  });
});
