import fs from 'node:fs';
import http from 'node:http';
import net from 'node:net';
import path from 'node:path';
import { AGENT_PATH, injectAgent } from './inject.ts';

const TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.htm': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
  '.txt': 'text/plain; charset=utf-8',
};

const NO_STORE = { 'cache-control': 'no-store' };

type Opts = { agentFile: string; editorOrigin: string };

function serveAgent(res: http.ServerResponse, agentFile: string) {
  res.writeHead(200, { 'content-type': TYPES['.js'], ...NO_STORE });
  res.end(fs.readFileSync(agentFile));
}

/** Resolve a URL path inside `root`, or null if it escapes it. */
export function resolveInside(root: string, urlPath: string): string | null {
  const rel = decodeURIComponent(urlPath).replace(/^\/+/, '');
  const full = path.resolve(root, rel);
  if (full !== root && !full.startsWith(root + path.sep)) return null;
  if (full.split(path.sep).includes('.playground')) return null;
  return full;
}

/** Serves the target file's folder; "/" is the target file; unknown HTML routes fall back to it (SPA). */
export function staticFrame(targetFile: string, o: Opts): http.Server {
  const root = path.dirname(targetFile);
  const entry = targetFile;
  return http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://frame');
    if (url.pathname === AGENT_PATH) return serveAgent(res, o.agentFile);
    let file = url.pathname === '/' ? entry : resolveInside(root, url.pathname);
    if (!file) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    try {
      if (fs.statSync(file).isDirectory()) file = path.join(file, 'index.html');
    } catch {
      /* handled below */
    }
    if (!fs.existsSync(file)) {
      const wantsHtml = (req.headers.accept ?? '').includes('text/html');
      if (!wantsHtml || path.extname(url.pathname)) {
        res.writeHead(404, NO_STORE).end('Not found');
        return;
      }
      file = entry;
    }
    const ext = path.extname(file).toLowerCase();
    const type = TYPES[ext] ?? 'application/octet-stream';
    if (ext === '.html' || ext === '.htm') {
      const html = injectAgent(fs.readFileSync(file, 'utf8'), o.editorOrigin);
      res.writeHead(200, { 'content-type': type, ...NO_STORE });
      res.end(html);
      return;
    }
    res.writeHead(200, { 'content-type': type, ...NO_STORE });
    fs.createReadStream(file).pipe(res);
  });
}

/** Transparent reverse proxy to a local dev server, injecting the agent into HTML responses. */
export function proxyFrame(targetUrl: string, o: Opts & { frameOrigin: () => string }): http.Server {
  const t = new URL(targetUrl);
  const port = Number(t.port || 80);
  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://frame');
    if (url.pathname === AGENT_PATH) return serveAgent(res, o.agentFile);
    const headers: http.OutgoingHttpHeaders = { ...req.headers, host: t.host, 'accept-encoding': 'identity' };
    if (headers.origin) headers.origin = t.origin;
    if (typeof headers.referer === 'string') headers.referer = headers.referer.replace(o.frameOrigin(), t.origin);
    const preq = http.request(
      { hostname: t.hostname, port, method: req.method, path: req.url, headers },
      (pres) => {
        const h = { ...pres.headers };
        delete h['content-security-policy'];
        delete h['content-security-policy-report-only'];
        delete h['x-frame-options'];
        if (typeof h.location === 'string' && h.location.startsWith(t.origin)) {
          h.location = o.frameOrigin() + h.location.slice(t.origin.length);
        }
        if ((h['content-type'] ?? '').includes('text/html')) {
          const chunks: Buffer[] = [];
          pres.on('data', (c: Buffer) => chunks.push(c));
          pres.on('end', () => {
            const body = injectAgent(Buffer.concat(chunks).toString('utf8'), o.editorOrigin);
            delete h['content-length'];
            delete h['transfer-encoding'];
            h['content-length'] = String(Buffer.byteLength(body));
            res.writeHead(pres.statusCode ?? 200, h);
            res.end(body);
          });
          return;
        }
        res.writeHead(pres.statusCode ?? 200, h);
        pres.pipe(res);
      },
    );
    preq.on('error', (e) => {
      res.writeHead(502, { 'content-type': 'text/html; charset=utf-8' });
      res.end(
        `<!doctype html><body style="font:14px system-ui;padding:40px;color:#333">` +
          `<h2>Can't reach ${t.origin}</h2><p>${String(e.message).replace(/</g, '&lt;')}</p>` +
          `<p>Is the dev server running inside WSL? A server on Windows isn't reachable from here.</p></body>`,
      );
    });
    req.pipe(preq);
  });

  // WebSockets (HMR) pass straight through.
  server.on('upgrade', (req, socket, head) => {
    const up = net.connect(port, t.hostname, () => {
      const lines = [`${req.method} ${req.url} HTTP/${req.httpVersion}`];
      for (let i = 0; i < req.rawHeaders.length; i += 2) {
        const k = req.rawHeaders[i];
        const v = k.toLowerCase() === 'host' ? t.host : k.toLowerCase() === 'origin' ? t.origin : req.rawHeaders[i + 1];
        lines.push(`${k}: ${v}`);
      }
      up.write(lines.join('\r\n') + '\r\n\r\n');
      if (head.length) up.write(head);
      up.pipe(socket);
      socket.pipe(up);
    });
    up.on('error', () => socket.destroy());
    socket.on('error', () => up.destroy());
  });
  return server;
}

/** Cheap change signature for a folder tree (mtimes), for live reload of file targets. */
export function folderSignature(root: string, maxDepth = 3, maxEntries = 2000): string {
  let n = 0;
  let sum = 0;
  const walk = (dir: string, depth: number) => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const e of entries) {
      if (n++ > maxEntries) return;
      if (e.name === 'node_modules' || e.name === '.git' || e.name === '.playground') continue;
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth < maxDepth) walk(p, depth + 1);
      } else {
        try {
          sum += fs.statSync(p).mtimeMs;
        } catch {
          /* vanished */
        }
      }
    }
  };
  walk(root, 0);
  return `${n}:${sum}`;
}
