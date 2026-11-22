// A local server for the page and the analysis function.
//   node scripts/dev.mjs            page on http://127.0.0.1:4321, analysis needs UPSTAGE_API_KEY
//   node scripts/dev.mjs --mock     the analysis plays back a recorded answer, without a key:
//                                   MOCK_FILE=run.json is {"events":[{"at":ms,"t":…},…]} (the lines of
//                                   an answer of /api/storyboard with the time each arrived), MOCK_SPEED=4
//                                   plays it four times as fast
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import handler from '../api/storyboard.js';
import siteHandler from '../api/site.js';

const root = fileURLToPath(new URL('../site/', import.meta.url));
const mock = process.argv.includes('--mock');
const port = Number(process.env.PORT) || 4321;
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css', '.js': 'text/javascript', '.svg': 'image/svg+xml', '.json': 'application/json' };

function query(url) {
  const out = {};
  for (const [key, value] of url.searchParams) out[key] = key in out ? [].concat(out[key], value) : value;
  return out;
}

createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  if (url.pathname === '/api/storyboard' || url.pathname === '/api/site') {
    const site = url.pathname === '/api/site';
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (mock) {
      // MOCK_SITE_FILE plays back an answer of /api/site in the same way.
      const file = (site && process.env.MOCK_SITE_FILE) || process.env.MOCK_FILE || fileURLToPath(new URL('../test/fixtures/answer.json', import.meta.url));
      const { events } = JSON.parse(readFileSync(file, 'utf8'));
      const speed = Number(process.env.MOCK_SPEED) || 1;
      const started = Date.now();
      res.writeHead(200, { 'content-type': 'application/x-ndjson; charset=utf-8', 'cache-control': 'no-store' });
      for (const { at = 0, ...event } of events) {
        const wait = at / speed - (Date.now() - started);
        if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
        res.write(`${JSON.stringify(event)}\n`);
      }
      return res.end();
    }
    req.query = query(url);
    return site ? siteHandler(req, res) : handler(req, res);
  }
  const path = normalizePath(join(root, url.pathname === '/' ? 'index.html' : decodeURIComponent(url.pathname)));
  if (!path.startsWith(root)) return res.writeHead(403).end();
  try {
    const body = await readFile(path);
    res.writeHead(200, { 'content-type': TYPES[extname(path)] ?? 'application/octet-stream', 'cache-control': 'no-store' }).end(body);
  } catch {
    res.writeHead(404).end('Not found');
  }
}).listen(port, '127.0.0.1', () => console.log(`http://127.0.0.1:${port}${mock ? ' (mock analysis)' : ''}`));
