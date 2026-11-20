import fs from 'node:fs';
import http from 'node:http';
import path from 'node:path';
import { filesSignature, proxyFrame, staticFrame } from './frame.ts';
import { LAST_FILE, serverFile, Store, writeFileAtomic } from './store.ts';
import { newId, openRound } from '../shared/session.ts';
import { readPatch, undoPatch } from './patches.ts';
import type { Action } from '../shared/types.ts';

export type ServeOptions = {
  target: string; // absolute file path or http URL
  dataDir: string; // where session.json, thumbnails and snapshots live
  root: string; // project folder (file target: its folder)
  port: number;
  host: string;
  distDir: string;
};

const SAFE_ID = /^[a-z0-9]+$/i;

function readBody(req: http.IncomingMessage, limit = 25 * 1024 * 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > limit) {
        reject(new Error('body too large'));
        req.destroy();
      } else chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

const json = (res: http.ServerResponse, code: number, body: unknown) => {
  res.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

function listen(server: http.Server, port: number, host: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const onErr = (e: Error) => reject(e);
    server.once('error', onErr);
    server.listen(port, host, () => {
      server.off('error', onErr);
      resolve();
    });
  });
}

export async function serve(o: ServeOptions) {
  const isUrl = /^https?:\/\//i.test(o.target);
  const dir = o.dataDir;
  fs.mkdirSync(dir, { recursive: true });
  const store = new Store(dir, o.target, isUrl ? 'url' : 'file', o.root);
  fs.mkdirSync(path.join(dir, 'thumbs'), { recursive: true });
  fs.mkdirSync(path.join(dir, 'shots'), { recursive: true });

  const sseClients = new Set<http.ServerResponse>();
  const broadcast = (event: string, data: unknown) => {
    const msg = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
    for (const c of sseClients) c.write(msg);
  };
  store.subscribe((s) => broadcast('session', s));

  let port = o.port;
  const ports = () => ({ editor: `http://localhost:${port}`, frame: `http://localhost:${port + 1}` });

  const editorDir = path.join(o.distDir, 'editor');
  const editor = http.createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', 'http://editor');
      const p = url.pathname;
      if (req.method === 'GET' && (p === '/' || p === '/index.html')) {
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(path.join(editorDir, 'index.html')));
        return;
      }
      if (req.method === 'GET' && p.startsWith('/editor/')) {
        const name = path.basename(p);
        const file = path.join(editorDir, name);
        if (!fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        const type = name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8';
        res.writeHead(200, { 'content-type': type, 'cache-control': 'no-store' });
        res.end(fs.readFileSync(file));
        return;
      }
      if (req.method === 'GET' && p.startsWith('/files/')) {
        const m = /^\/files\/(thumbs|shots)\/([a-z0-9-]+\.jpg)$/i.exec(p);
        const file = m && path.join(dir, m[1], m[2]);
        if (!file || !fs.existsSync(file)) return json(res, 404, { error: 'not found' });
        res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'no-store' });
        res.end(fs.readFileSync(file));
        return;
      }
      if (req.method === 'GET' && p === '/api/session') {
        return json(res, 200, { session: store.session, frameOrigin: ports().frame });
      }
      if (req.method === 'GET' && p === '/api/events') {
        res.writeHead(200, {
          'content-type': 'text/event-stream',
          'cache-control': 'no-store',
          connection: 'keep-alive',
        });
        res.write(`event: session\ndata: ${JSON.stringify(store.session)}\n\n`);
        sseClients.add(res);
        const ping = setInterval(() => res.write(': ping\n\n'), 20000);
        req.on('close', () => {
          clearInterval(ping);
          sseClients.delete(res);
        });
        return;
      }
      if (req.method === 'POST' && p === '/api/action') {
        const action = JSON.parse(await readBody(req)) as Action;
        return json(res, 200, { session: store.dispatch(action) });
      }
      if (req.method === 'POST' && p === '/api/thumb') {
        const { slide, dataUrl } = JSON.parse(await readBody(req)) as { slide: string; dataUrl: string };
        const m = /^data:image\/jpeg;base64,(.+)$/.exec(dataUrl ?? '');
        if (!SAFE_ID.test(slide ?? '') || !m) return json(res, 400, { error: 'bad thumb' });
        fs.writeFileSync(path.join(dir, 'thumbs', `${slide}.jpg`), Buffer.from(m[1], 'base64'));
        store.dispatch({ type: 'updateSlide', id: slide, patch: { thumb: `/files/thumbs/${slide}.jpg?v=${Date.now()}` } });
        return json(res, 200, { ok: true });
      }
      if (req.method === 'POST' && p === '/api/send') {
        const before = store.session;
        const after = store.dispatch({ type: 'send', at: Date.now() });
        const round = openRound(after);
        if (after === before || !round) return json(res, 409, { error: 'nothing to send, or a round is already in progress', session: after });
        // Freeze "before" images of every slide this round touches.
        const shots: Record<string, string> = {};
        const slides = new Set([...round.ops.map((x) => x.slide), ...round.comments.map((x) => x.slide)]);
        for (const id of slides) {
          const src = path.join(dir, 'thumbs', `${id}.jpg`);
          if (!SAFE_ID.test(id) || !fs.existsSync(src)) continue;
          const name = `r${round.n}-${id}.jpg`;
          fs.copyFileSync(src, path.join(dir, 'shots', name));
          shots[id] = `/files/shots/${name}`;
        }
        return json(res, 200, { session: store.dispatch({ type: 'setShots', round: round.n, shots }) });
      }
      if (req.method === 'POST' && p === '/api/undo') {
        const { round, item } = JSON.parse(await readBody(req)) as { round: number; item: string };
        const r = store.session.rounds.find((x) => x.n === round);
        const result = r?.results.find((x) => x.item === item);
        if (!r || !result) return json(res, 404, { error: 'no such applied item' });
        const what = r.ops.find((o) => o.id === item)?.label ?? r.comments.find((c) => c.id === item)?.body ?? item;
        // Exact first: restore the lines this item changed.
        const patch = result.patch ? readPatch(dir, result.patch) : null;
        const outcome = patch ? undoPatch(patch) : { ok: false as const, reason: 'no recorded file changes for it' };
        if (outcome.ok) {
          const names = outcome.files.map((f) => path.basename(f)).join(', ');
          const session = store.dispatch({ type: 'markUndone', round, item, note: `Undone: restored ${names}`, at: Date.now() });
          broadcast('reload', { at: Date.now() });
          return json(res, 200, { via: 'exact', files: outcome.files, session });
        }
        // Otherwise Claude reverts it by hand.
        const session = store.dispatch({
          type: 'requestUndo',
          at: Date.now(),
          undo: { id: newId('u'), round, item, label: what, note: result.note, patch: result.patch, reason: outcome.reason },
        });
        return json(res, 200, { via: 'claude', reason: outcome.reason, session });
      }
      json(res, 404, { error: 'not found' });
    } catch (e) {
      json(res, 500, { error: String((e as Error).message) });
    }
  });

  const agentFile = path.join(o.distDir, 'agent.js');
  const served = new Set<string>([o.target]);
  const makeFrame = () =>
    isUrl
      ? proxyFrame(o.target, { agentFile, editorOrigin: ports().editor, frameOrigin: () => ports().frame })
      : staticFrame(o.target, { agentFile, editorOrigin: ports().editor, served });
  let frame = makeFrame();

  // Find a free pair of ports: editor on N, page on N+1.
  for (let tries = 0; ; tries++) {
    try {
      await listen(editor, port, o.host);
      try {
        await listen(frame, port + 1, o.host);
        break;
      } catch (e) {
        editor.close();
        throw e;
      }
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EADDRINUSE' || tries > 20) throw e;
      port += 2;
      frame = makeFrame();
    }
  }

  // Live reload for file targets (dev servers have their own HMR).
  let sig = isUrl ? '' : filesSignature(served);
  const watch = isUrl
    ? undefined
    : setInterval(() => {
        const next = filesSignature(served);
        if (next !== sig) {
          sig = next;
          broadcast('reload', { at: Date.now() });
        }
      }, 800);

  const info = { pid: process.pid, port, framePort: port + 1, target: o.target, dataDir: dir, startedAt: Date.now() };
  writeFileAtomic(serverFile(dir), JSON.stringify(info, null, 2));
  writeFileAtomic(LAST_FILE, JSON.stringify(info, null, 2));

  const shutdown = () => {
    try {
      const info = JSON.parse(fs.readFileSync(serverFile(dir), 'utf8'));
      if (info.pid === process.pid) fs.rmSync(serverFile(dir));
    } catch {
      /* already gone */
    }
    if (watch) clearInterval(watch);
    store.close();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  process.on('SIGHUP', shutdown);

  const { editor: e, frame: f } = ports();
  console.log(`PLAYGROUND editor=${e} frame=${f} session=${dir}`);
}
