// A local server for the page and the analysis function.
//   node scripts/dev.mjs            page on http://127.0.0.1:4321, analysis needs UPSTAGE_API_KEY
//   node scripts/dev.mjs --mock     the analysis answers with a canned storyboard, without a key
//                                   (MOCK_FILE=answer.json uses a saved answer instead)
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, join, normalize as normalizePath } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import handler from '../api/board.js';
import { normalize } from '../api/_lib/normalize.js';
import { EXAMPLE } from '../api/_lib/prompt.js';

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
  if (url.pathname === '/api/board') {
    res.status = (code) => { res.statusCode = code; return res; };
    res.json = (body) => { res.setHeader('content-type', 'application/json'); res.end(JSON.stringify(body)); };
    if (mock) {
      await new Promise((resolve) => setTimeout(resolve, Number(process.env.MOCK_MS) || 2500));
      const board = normalize(process.env.MOCK_FILE ? JSON.parse(readFileSync(process.env.MOCK_FILE, 'utf8')) : EXAMPLE);
      return res.status(200).json({ ok: true, screen: { title: board.title, summary: board.summary, file: url.searchParams.get('path') }, css: board.css, page: board.page, areas: board.areas });
    }
    req.query = query(url);
    return handler(req, res);
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
