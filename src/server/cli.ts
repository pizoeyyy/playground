#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { serve } from './serve.ts';
import { readSession, serverFile, sessionFile, writeSession } from './store.ts';
import { pgDir } from './store.ts';
import { describeRound, describeStatus } from '../shared/describe.ts';
import { latestRound, openRound, reduce } from '../shared/session.ts';
import type { Action, ResultState, Session } from '../shared/types.ts';

const HELP = `playground — review editor for HTML prototypes and live apps

  playground serve <file.html | http://localhost:PORT> [--port 4800] [--session DIR] [--host 127.0.0.1]
  playground wait     --session DIR         block until a round is sent, then print it
  playground show     --session DIR [--round N] [--json]
  playground status   --session DIR
  playground snapshot --session DIR --round N <files...>
  playground result   --session DIR --round N --item ID --state applied|question --note "..."
  playground finish   --session DIR --round N
  playground stop     --session DIR

DIR is the folder that holds .playground/ (default: the target file's folder, or the current folder).`;

function parse(argv: string[]) {
  const pos: string[] = [];
  const flags: Record<string, string | true> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith('--')) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) flags[key] = true;
      else {
        flags[key] = next;
        i++;
      }
    } else pos.push(a);
  }
  return { pos, flags };
}

const die = (msg: string, code = 1): never => {
  console.error(msg);
  process.exit(code);
};

type ServerInfo = { pid: number; port: number; framePort: number };

function serverInfo(dir: string): ServerInfo | null {
  try {
    const info = JSON.parse(fs.readFileSync(serverFile(dir), 'utf8')) as ServerInfo;
    process.kill(info.pid, 0);
    return info;
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

async function main() {
  const [cmd, ...rest] = process.argv.slice(2);
  const { pos, flags } = parse(rest);
  const sessionDir = (fallback: string) => path.resolve(typeof flags.session === 'string' ? flags.session : fallback);

  switch (cmd) {
    case 'serve': {
      const raw = pos[0] ?? die(HELP);
      const isUrl = /^https?:\/\//i.test(raw);
      let target = raw;
      if (isUrl) {
        const host = new URL(raw).hostname;
        if (!['localhost', '127.0.0.1', '[::1]', '::1'].includes(host)) die('Only localhost URLs can be proxied.');
      } else {
        target = path.resolve(raw);
        if (!fs.existsSync(target) || !fs.statSync(target).isFile()) die(`No such file: ${target}`);
      }
      const dir = sessionDir(isUrl ? process.cwd() : path.dirname(target));
      const running = serverInfo(dir);
      if (running) die(`Already running for this folder: editor http://localhost:${running.port} (pid ${running.pid}). Run "playground stop" first.`);
      await serve({
        target,
        sessionDir: dir,
        port: Number(flags.port ?? 4800),
        host: typeof flags.host === 'string' ? flags.host : '127.0.0.1',
        distDir: path.dirname(fileURLToPath(import.meta.url)),
      });
      return;
    }
    case 'wait': {
      const dir = sessionDir(process.cwd());
      let missing = 0;
      for (;;) {
        const s = readSession(dir);
        const r = s && openRound(s);
        if (s && r) {
          console.log(describeRound(s, r));
          return;
        }
        missing = serverInfo(dir) ? 0 : missing + 1;
        if (missing >= 5) die('STOPPED: the playground server is not running.', 3);
        await new Promise((res) => setTimeout(res, 700));
      }
    }
    case 'show': {
      const dir = sessionDir(process.cwd());
      const s = readSession(dir) ?? die(`No session at ${sessionFile(dir)}`);
      const r = roundArg(s, flags);
      console.log(flags.json ? JSON.stringify(r, null, 2) : describeRound(s, r));
      return;
    }
    case 'status': {
      const dir = sessionDir(process.cwd());
      const s = readSession(dir) ?? die(`No session at ${sessionFile(dir)}`);
      const info = serverInfo(dir);
      console.log(info ? `server: running, editor http://localhost:${info.port}` : 'server: not running');
      console.log(describeStatus(s));
      return;
    }
    case 'snapshot': {
      const dir = sessionDir(process.cwd());
      const n = Number(flags.round ?? die('--round is required'));
      const dest = path.join(pgDir(dir), 'revisions', `r${n}`);
      for (const f of pos) {
        const src = path.resolve(f);
        if (!fs.existsSync(src)) die(`No such file: ${src}`);
        const rel = path.relative(dir, src);
        const to = path.join(dest, rel.startsWith('..') ? path.basename(src) : rel);
        fs.mkdirSync(path.dirname(to), { recursive: true });
        fs.copyFileSync(src, to);
        console.log(`saved ${to}`);
      }
      return;
    }
    case 'result': {
      const dir = sessionDir(process.cwd());
      const state = flags.state as ResultState;
      if (state !== 'applied' && state !== 'question') die('--state must be applied or question');
      const item = typeof flags.item === 'string' ? flags.item : die('--item is required');
      const note = typeof flags.note === 'string' ? flags.note : die('--note is required');
      const n = Number(flags.round ?? die('--round is required'));
      await dispatch(dir, { type: 'result', round: n, result: { item, state, note } });
      console.log(`recorded ${item}: ${state}`);
      return;
    }
    case 'finish': {
      const dir = sessionDir(process.cwd());
      const n = Number(flags.round ?? die('--round is required'));
      const s = await dispatch(dir, { type: 'finish', round: n });
      const r = s.rounds.find((x) => x.n === n);
      console.log(`round ${n}: ${r?.status ?? 'missing'}`);
      return;
    }
    case 'stop': {
      const dir = sessionDir(process.cwd());
      const info = serverInfo(dir);
      if (!info) {
        console.log('not running');
        return;
      }
      process.kill(info.pid, 'SIGTERM');
      console.log(`stopped pid ${info.pid}`);
      return;
    }
    default:
      console.log(HELP);
  }
}

main().catch((e) => die(String(e?.stack ?? e)));
