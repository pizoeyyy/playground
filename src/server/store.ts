import fs from 'node:fs';
import path from 'node:path';
import { emptySession, reduce } from '../shared/session.ts';
import type { Action, Session } from '../shared/types.ts';

export const pgDir = (sessionDir: string) => path.join(sessionDir, '.playground');
export const sessionFile = (sessionDir: string) => path.join(pgDir(sessionDir), 'session.json');
export const serverFile = (sessionDir: string) => path.join(pgDir(sessionDir), 'server.json');

export function readSession(sessionDir: string): Session | null {
  try {
    return JSON.parse(fs.readFileSync(sessionFile(sessionDir), 'utf8')) as Session;
  } catch {
    return null;
  }
}

export function writeSession(sessionDir: string, s: Session) {
  fs.mkdirSync(pgDir(sessionDir), { recursive: true });
  const file = sessionFile(sessionDir);
  const tmp = file + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(s, null, 2));
  fs.renameSync(tmp, file);
}

/** The server's single source of truth for the session, persisted on every change. */
export class Store {
  session: Session;
  private lastMtime = 0;
  private listeners = new Set<(s: Session) => void>();
  private timer: NodeJS.Timeout;

  constructor(readonly dir: string, target: string, kind: 'file' | 'url') {
    const existing = readSession(dir);
    this.session = existing ?? emptySession(target, kind);
    this.session.target = target;
    this.session.targetKind = kind;
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
