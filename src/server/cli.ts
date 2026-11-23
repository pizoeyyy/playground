#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.ts';
import {
  defaultDataDir,
  LAST_FILE,
  readSession,
  resolveDataDir,
  serverFile,
  sessionFile,
  writeSession,
} from './store.ts';
import { describeRound, describeStatus } from '../shared/describe.ts';
import { parse } from './args.ts';
import { ensureBase, recordItemPatch, writeCheckpoint } from './patches.ts';
import { latestRound, openRound, reduce } from '../shared/session.ts';
import type { Action, ResultState, Session } from '../shared/types.ts';

const HELP = `playground — review editor for HTML prototypes and live apps

  playground serve <file.html | http://localhost:PORT> [--port 4800] [--root DIR] [--session DIR]
  playground wait     [--session DIR]        block until a round is sent, then print it
  playground show     [--session DIR] [--round N] [--json]
  playground status   [--session DIR]
  playground snapshot [--session DIR] --round N <files...>
  playground result   [--session DIR] --round N --item ID[,ID] --state applied|question --note "..." | --note-file FILE
  playground finish   [--session DIR] --round N
  playground stop     [--session DIR]

serve prints "PLAYGROUND editor=URL frame=URL session=DIR". Pass that DIR as --session to the
other commands; without it they use the most recently started session.
--root is the project folder for URL targets (default: the current folder).`;


/**
 * Accept Windows paths (C:\x or C:/x) when running inside WSL, so Claude Code on Windows can pass
 * paths as it sees them. Elsewhere this is plain path.resolve.
 */
function localPath(p: string): string {
  if (process.platform === 'linux' && /^[A-Za-z]:[\\/]/.test(p)) {
    try {
      return execFileSync('wslpath', ['-u', p.replace(/\//g, '\\')], { encoding: 'utf8' }).trim();
    } catch {
      return `/mnt/${p[0].toLowerCase()}/${p.slice(3).replace(/\\/g, '/')}`;
    }
  }
  return path.resolve(p);
}

const die = (msg: string, code = 1): never => {
  console.error(msg);
  process.exit(code);
};

type ServerInfo = { pid: number; port: number; framePort: number; dataDir?: string };

const alive = (pid: number) => {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
};

function serverInfo(dir: string): ServerInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(serverFile(dir), 'utf8')) as ServerInfo;
    return alive(info.pid) ? info : null;
  } catch {
    return null;
  }
}

/** Send an action through the running server (so the editor updates live), or edit the file directly. */
async function dispatch(dir: string, action: Action): Promise<Session> {
  const info = serverInfo(dir);
  if (info) {
    try {
      const r = await fetch(`http://127.0.0.1:${info.port}/api/action`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(action),
      });
      if (r.ok) return ((await r.json()) as { session: Session }).session;
    } catch {
      /* fall through to the file */
    }
  }
  const s = readSession(dir) ?? die(`No session at ${sessionFile(dir)}`);
  const next = reduce(s, action);
  if (next !== s) writeSession(dir, next);
  return next;
}

function roundArg(s: Session, flags: Record<string, string | true>) {
  const n = flags.round ? Number(flags.round) : (openRound(s) ?? latestRound(s))?.n;
  const r = s.rounds.find((x) => x.n === n);
  return r ?? die(n ? `No round ${n}.` : 'No rounds yet.');
}

/** Record the project at the start of a round (git), so every item's change can be undone exactly. */
function roundBase(dir: string, n: number) {
  ensureBase(dir, n, readSession(dir)?.root);
}

/** --session, else the last session started on this machine. */
function dataDirArg(flags: Record<string, string | true>): string {
  if (typeof flags.session === 'string') return resolveDataDir(localPath(flags.session));
  try {
    const last = JSON.parse(fs.readFileSync(LAST_FILE, 'utf8')) as ServerInfo;
    if (last.dataDir) return last.dataDir;
  } catch {
    /* none yet */
  }
  return die('No session. Start one with "playground serve <file|url>", or pass --session DIR.');
}

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);

  switch (cmd) {
    case 'serve': {
      const raw = pos[0] ?? die(HELP);
      const isUrl = /^https?:\/\//i.test(raw);
      let target = raw;
      if (isUrl) {
        const host = new URL(raw).hostname;
        if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) die('Only localhost URLs can be proxied.');
      } else {
        target = localPath(raw);
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) die(`No such file: ${target}`);
      }
      const root = isUrl ? (typeof flags.root === 'string' ? localPath(flags.root) : process.cwd()) : path.dirname(target);
      const dir = typeof flags.session === 'string' ? resolveDataDir(localPath(flags.session)) : defaultDataDir(target);
      const running = serverInfo(dir);
      if (running) {
        die(`Already running for this target: editor http://localhost:${running.port} (pid ${running.pid}). Run "playground stop --session ${dir}" first.`);
      }
      await serve({
        target,
        dataDir: dir,
        root,
        port: Number(flags.port ?? 4800),
        host: typeof flags.host === 'string' ? flags.host : '127.0.0.1',
        distDir: path.dirname(fileURLToPath(import.meta.url)),
      });
      return;
    }
    case 'wait': {
      const dir = dataDirArg(flags);
      let missing = 0;
      for (;;) {
        const s = readSession(dir);
        const r = s && openRound(s);
        if (s && r) {
          roundBase(dir, r.n);
          console.log(`session: ${dir}`);
          console.log(describeRound(s, r));
          return;
        }
        missing = serverInfo(dir) ? 0 : missing + 1;
        if (missing >= 5) die('STOPPED: the playground server is not running.', 3);
        await new Promise((res) => setTimeout(res, 700));
      }
    }
    case 'show': {
      const dir = dataDirArg(flags);
      const s = readSession(dir) ?? die(`No session at ${sessionFile(dir)}`);
      const r = roundArg(s, flags);
      if (r.status === 'submitted') roundBase(dir, r.n);
      console.log(flags.json ? JSON.stringify(r, null, 2) : describeRound(s, r));
      return;
    }
    case 'status': {
      const dir = dataDirArg(flags);
      const s = readSession(dir) ?? die(`No session at ${sessionFile(dir)}`);
      const info = serverInfo(dir);
      console.log(`session: ${dir}`);
      console.log(info ? `server: running, editor http://localhost:${info.port}` : 'server: not running');
      console.log(describeStatus(s));
      return;
    }
    case 'snapshot': {
      const dir = dataDirArg(flags);
      const s = readSession(dir);
      const root = s?.root ?? process.cwd();
      const n = Number(flags.round ?? die('--round is required'));
      const dest = path.join(dir, 'revisions', `r${n}`);
      roundBase(dir, n);
      // Files that don't exist yet can be tracked too (Claude may create them).
      writeCheckpoint(dir, n, pos.map(localPath));
      for (const f of pos) {
        const src = localPath(f);
        if (!fs.existsSync(src)) {
          console.log(`tracking new file ${src}`);
          continue;
        }
        const rel = path.relative(root, src);
        const to = path.join(dest, rel.startsWith('..') || path.isAbsolute(rel) ? path.basename(src) : rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(src, to);
        console.log(`saved ${to}`);
      }
      return;
    }
    case 'result': {
      const dir = dataDirArg(flags);
      const state = flags.state as ResultState;
      if (state !== 'applied' && state !== 'question') die('--state must be applied or question');
      const items = (typeof flags.item === 'string' ? flags.item : die('--item is required')).split(',').map((x) => x.trim()).filter(Boolean);
      const note =
        typeof flags['note-file'] === 'string'
          ? fs.readFileSync(localPath(flags['note-file']), 'utf8').trim()
          : typeof flags.note === 'string'
            ? flags.note
            : die('--note "..." or --note-file FILE is required');
      if (!note) die('The note is empty.');
      const n = Number(flags.round ?? die('--round is required'));
      roundBase(dir, n);
      // Whatever changed in the snapshotted files since the last result belongs to these items.
      const patch = recordItemPatch(dir, n, items);
      const linked = items.length > 1 ? items : undefined;
      for (const item of items) {
        await dispatch(dir, { type: 'result', round: n, result: { item, state, note, patch: patch?.id, linked } });
      }
      const changed = patch ? `patch: ${patch.files.length} file(s)` : 'no file changes recorded';
      console.log(`recorded ${items.join(', ')}: ${state} (${changed})`);
      return;
    }
    case 'finish': {
      const dir = dataDirArg(flags);
      const n = Number(flags.round ?? die('--round is required'));
      const s = await dispatch(dir, { type: 'finish', round: n });
      const r = s.rounds.find((x) => x.n === n);
      console.log(`round ${n}: ${r?.status ?? 'missing'}`);
      return;
    }
    case 'stop': {
      const dir = dataDirArg(flags);
      const info = serverInfo(dir);
      if (!info) {
        console.log('not running');
        return;
      }
      process.kill(info.pid, 'SIGTERM');
      // Windows ends the process without running its exit handler, so tidy up here too.
      try {
        fs.rmSync(serverFile(dir));
      } catch {
        /* already gone */
      }
      console.log(`stopped pid ${info.pid}`);
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => die(String(e?.stack ?? e)));
