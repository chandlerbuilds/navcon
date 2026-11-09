// Production server for the container image (Radar / Kubernetes deploy).
// Serves the built PWA from dist/, runs api/search.ts as /api/search, and
// answers the /healthz and /readyz probes. Vercel does not use this file.
import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

// Node 24 strips the TypeScript types on import; the file has only type-level syntax.
const { default: search } = await import('./api/search.ts');

const PORT = Number(process.env.PORT ?? 8080);
const ROOT = fileURLToPath(new URL('./dist/', import.meta.url));
const VERSION = process.env.APP_VERSION ?? 'dev';

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.webmanifest': 'application/manifest+json',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.woff2': 'font/woff2',
};

// Same rule as the rewrite in vercel.json: app routes fall back to index.html,
// anything that looks like a file or lives under api/, assets/ or venues/ does not.
const isAppRoute = (path) => !/^\/(api|assets|venues)\//.test(path) && !/\.[a-z0-9]+$/i.test(path);

async function sendFile(res, rel, method) {
  const file = normalize(join(ROOT, rel));
  if (!file.startsWith(ROOT)) return false; // no ../ escapes
  let info;
  try {
    info = await stat(file);
  } catch {
    return false;
  }
  if (!info.isFile()) return false;
  const immutable = rel.startsWith('/assets/');
  res.writeHead(200, {
    'Content-Type': TYPES[extname(file).toLowerCase()] ?? 'application/octet-stream',
    'Content-Length': info.size,
    // Hashed bundles never change; everything else (index.html, sw.js, venue data) must revalidate.
    'Cache-Control': immutable ? 'public, max-age=31536000, immutable' : 'no-cache',
  });
  if (method === 'HEAD') res.end();
  else createReadStream(file).pipe(res);
  return true;
}

// The small slice of the Vercel request/response API that api/search.ts uses.
function runVercelHandler(handler, req, res, url) {
  req.query = Object.fromEntries(url.searchParams);
  const vres = {
    setHeader: (k, v) => (res.setHeader(k, v), vres),
    status: (code) => ((res.statusCode = code), vres),
    json: (body) => {
      res.setHeader('Content-Type', 'application/json; charset=utf-8');
      res.end(JSON.stringify(body));
      return vres;
    },
  };
  return handler(req, vres);
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let path;
  try {
    path = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400, { 'Content-Type': 'text/plain' });
    return res.end('bad request');
  }
  try {
    if (path === '/healthz' || path === '/readyz') {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      return res.end(JSON.stringify({ ok: true, version: VERSION }));
    }
    if (path === '/api/search') return await runVercelHandler(search, req, res, url);
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      res.writeHead(405, { Allow: 'GET, HEAD' });
      return res.end();
    }
    if (await sendFile(res, path, req.method)) return;
    if (isAppRoute(path) && (await sendFile(res, '/index.html', req.method))) return;
    res.writeHead(404, { 'Content-Type': 'text/plain' });
    res.end('not found');
  } catch (err) {
    console.error(JSON.stringify({ msg: 'request_failed', path, error: String(err) }));
    if (!res.headersSent) res.writeHead(500, { 'Content-Type': 'text/plain' });
    res.end('server error');
  }
});

server.listen(PORT, () => console.log(JSON.stringify({ msg: 'listening', port: PORT, version: VERSION })));

// Let in-flight requests finish when Kubernetes stops the pod.
process.on('SIGTERM', () => server.close(() => process.exit(0)));
