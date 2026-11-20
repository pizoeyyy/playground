import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { emptySession, reduce } from '../shared/session.ts';
import type { Action, Session } from '../shared/types.ts';

// Session data lives outside the project by default (~/.playground/sessions/<name>), so the
// files the server writes (thumbnails, session.json) never trip a project's file watcher.
export const HOME_DIR = path.join(os.homedir(), '.playground');
export const LAST_FILE = path.join(HOME_DIR, 'last.json');

export const sessionFile = (dataDir: string) => path.join(dataDir, 'session.json');
export const serverFile = (dataDir: string) => path.join(dataDir, 'server.json');

export function defaultDataDir(target: string): string {
  const name = /^https?:\/\//i.test(target) ? new URL(target).host : path.basename(target);
  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'page';
  const hash = crypto.createHash('sha1').update(target).digest('hex').slice(0, 6);
  return path.join(HOME_DIR, 'sessions', `${slug}-${hash}`);
}

/** `--session DIR`: the data folder itself, or (older layout) a folder holding `.playground/`. */
export function resolveDataDir(dir: string): string {
  const legacy = path.join(dir, '.playground');
  return fs.existsSync(path.join(legacy, 'session.json')) ? legacy : dir;
}

export function readSession(dataDir: string): Session | null {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(dataDir), 'utf8')) as Session;
  } catch {
    return null;
  }
}

/** Atomic write. Windows can refuse a rename for a moment while another process reads the file. */
export function writeFileAtomic(file: string, data: string) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, data);
  for (let i = 0; ; i++) {
    try {
      fs.renameSync(tmp, file);
      return;
    } catch (e) {
      const code = (e as NodeJS.ErrnoException).code;
      if (i >= 20 || (code !== 'EPERM' && code !== 'EBUSY' && code !== 'EACCES')) throw e;
      Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 25);
    }
  }
}

export function writeSession(dataDir: string, s: Session) {
  writeFileAtomic(sessionFile(dataDir), JSON.stringify(s, null, 2));
}

/** The server's single source of truth for the session, persisted on every change. */
export class Store {
  session: Session;
  private lastMtime = 0;
  private listeners = new Set<(s: Session) => void>();
  private timer: NodeJS.Timeout;

  constructor(readonly dir: string, target: string, kind: 'file' | 'url', root: string) {
    const existing = readSession(dir);
    this.session = existing ?? emptySession(target, kind);
    this.session.target = target;
    this.session.targetKind = kind;
    this.session.root = root;
    this.persist();
    // Pick up edits made to session.json by something other than this server.
    this.timer = setInterval(() => this.poll(), 600);
  }

  dispatch(a: Action): Session {
    const next = reduce(this.session, a);
    if (next !== this.session) {
      this.session = next;
      this.persist();
      this.emit();
    }
    return this.session;
  }

  subscribe(fn: (s: Session) => void) {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }

  close() {
    clearInterval(this.timer);
  }

  private persist() {
    writeSession(this.dir, this.session);
    this.lastMtime = fs.statSync(sessionFile(this.dir)).mtimeMs;
  }

  private poll() {
    let m = 0;
    try {
      m = fs.statSync(sessionFile(this.dir)).mtimeMs;
    } catch {
      return;
    }
    if (m === this.lastMtime) return;
    const s = readSession(this.dir);
    this.lastMtime = m;
    if (!s) return;
    this.session = s;
    this.emit();
  }

  private emit() {
    for (const fn of this.listeners) fn(this.session);
  }
}
