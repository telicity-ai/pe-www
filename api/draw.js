// GET /api/draw?repo=owner/name&ref=main&path=src/pages/Settings.tsx&rel=…&css=…&lang=en&stack=React&try=1
//
// Reads one screen of a public GitHub repository and asks Solar for a storyboard of it: a static
// HTML mockup of the screen as the code renders it, and a few areas with options from
// picky-eater's catalog. The request names files; this function fetches them itself, so that it
// cannot be used to send arbitrary text to the model.
//
// The answer is passed on while it is written, one JSON object per line:
//   {"t":"plan","areas":[{"id":…,"options":["id",…]}],"file":…}
//   {"t":"css","text":…}
//   {"t":"page","text":…}        the page's HTML, in pieces; <pe-area id="…"></pe-area> stands where an area goes
//   {"t":"page-end"}
//   {"t":"screen","title":…,"summary":…}
//   {"t":"area","id":…,"label":…,"decision":…}
//   {"t":"option","area":…,"id":…,"label":…,"html":…,"keep"|"pattern":…}
//   {"t":"suggest","area":…,"id":…,"because":…}     {"t":"miss","area":…,"id":…}  that piece will not come
//   {"t":"done","ms":…,…}   or   {"t":"error","code":…,"message":…}
// One call to the model writes the page around the areas; meanwhile each area as it is today,
// and each of its options, is written by a call of its own. A person waits for the longest of
// them instead of for their sum.
import { LIMITS, Piece, Reader, SOURCE_CODE, asHtml, clean, planArea, slug } from './_lib/answer.js';
import { filesPrompt, optionTask, pageTask, systemPrompt, todayTask } from './_lib/brief.js';
import { MODEL, SolarError, ask } from './_lib/solar.js';

const DEFAULT_ORIGINS = ['https://telicity-ai.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const SCREEN_CHARS = 120_000;
const RELATED_CHARS = 100_000;
const STYLE_CHARS = 24_000;
const TOTAL_CHARS = 330_000;
const MAX_RELATED = 16;
const MAX_STYLES = 4;
const SOURCE_FILE = /\.(tsx|jsx|ts|js|mjs|vue|svelte|astro|html|mdx)$/i;
const STYLE_FILE = /\.(css|scss|less)$|(^|\/)tailwind\.config\.[a-z]+$/i;

const PAGE_TOKENS = 3_200;
const PIECE_TOKENS = 1_800;
const DEADLINE_MS = 150_000;

const PER_MINUTE = 6;
const hits = new Map();

class Failure extends Error {
  constructor(status, code, message) {
    super(message);
    this.status = status;
    this.code = code;
  }
}

function allowedOrigin(origin) {
  if (!origin) return null;
  const extra = (process.env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  if (DEFAULT_ORIGINS.includes(origin) || extra.includes(origin) || LOCAL_ORIGIN.test(origin)) return origin;
  if (process.env.VERCEL_URL && origin === `https://${process.env.VERCEL_URL}`) return origin;
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL && origin === `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`) return origin;
  return null;
}

/** Best effort only: instances are short-lived and not shared. The CDN cache carries most of the load. */
function limited(ip) {
  const now = Date.now();
  const recent = (hits.get(ip) ?? []).filter((t) => now - t < 60_000);
  recent.push(now);
  hits.set(ip, recent);
  if (hits.size > 5000) hits.clear();
  return recent.length > PER_MINUTE;
}

const one = (value) => (Array.isArray(value) ? value[0] : value);
const many = (value) => (value === undefined ? [] : Array.isArray(value) ? value : [value]);

function checkPath(path, kind) {
  if (typeof path !== 'string' || path.length > 300 || !/^[A-Za-z0-9._\-/@()[\]+$~ ]+$/.test(path)) return false;
  if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.' || part === '')) return false;
  return kind.test(path);
}

function readQuery(query) {
  const repo = one(query.repo);
  const ref = one(query.ref);
  const path = one(query.path);
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) throw new Failure(400, 'bad_request', 'repo must be owner/name');
  if (typeof ref !== 'string' || !/^[A-Za-z0-9._\-/]{1,200}$/.test(ref) || ref.includes('..')) throw new Failure(400, 'bad_request', 'ref is not a branch, tag or commit');
  if (!checkPath(path, SOURCE_FILE)) throw new Failure(400, 'bad_request', 'path is not a source file');
  const rel = [...new Set(many(query.rel))].filter((p) => p !== path && checkPath(p, SOURCE_FILE)).slice(0, MAX_RELATED);
  const css = [...new Set(many(query.css))].filter((p) => checkPath(p, STYLE_FILE)).slice(0, MAX_STYLES);
  const lang = one(query.lang) === 'ko' ? 'ko' : 'en';
  const stack = typeof one(query.stack) === 'string' ? one(query.stack).replace(/[^A-Za-z0-9 .,+#/-]/g, '').slice(0, 120) : '';
  return { repo, ref, path, rel, css, lang, stack };
}

async function fetchText(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) return { status: response.status };
    return { status: 200, text: await response.text() };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

/** A long file keeps its beginning (imports, helpers) and its end (what is rendered). */
function clip(text, max, keepEnd) {
  if (text.length <= max) return { text, truncated: false };
  if (!keepEnd) return { text: text.slice(0, max), truncated: true };
  const head = Math.floor(max * 0.25);
  return { text: `${text.slice(0, head)}\n\n/* … the middle of this file is left out … */\n\n${text.slice(text.length - (max - head))}`, truncated: true };
}

async function readFile(repo, ref, path, max, keepEnd) {
  const encoded = [...ref.split('/'), ...path.split('/')].map(encodeURIComponent).join('/');
  const result = await fetchText(`https://raw.githubusercontent.com/${repo}/${encoded}`, 10_000);
  if (result.status !== 200) return { path, status: result.status };
  if (result.text.includes('\u0000')) return { path, status: 415 };
  return { path, status: 200, ...clip(result.text, max, keepEnd) };
}

async function readFiles({ repo, ref, path, rel, css }) {
  const [main, ...others] = await Promise.all([
    readFile(repo, ref, path, SCREEN_CHARS, true),
    ...rel.map((p) => readFile(repo, ref, p, RELATED_CHARS, true)),
    ...css.map((p) => readFile(repo, ref, p, STYLE_CHARS, false)),
  ]);
  if (main.status === 404) throw new Failure(404, 'file_not_found', 'That file is not in the repository, or the repository is private');
  if (main.status !== 200) throw new Failure(502, 'github_unavailable', 'GitHub did not return the file');

  const files = [main];
  const styles = [];
  let total = main.text.length;
  others.forEach((file, index) => {
    if (file.status !== 200 || total + file.text.length > TOTAL_CHARS) return;
    (index < rel.length ? files : styles).push(file);
    total += file.text.length;
  });
  if (total < 200) throw new Failure(422, 'file_too_small', 'There is too little code in that file');
  return { files, styles };
}

const tokens = (usage) => (usage ? { prompt: usage.prompt_tokens, cached: usage.prompt_tokens_details?.cached_tokens, completion: usage.completion_tokens } : undefined);

/**
 * Writes the storyboard, calling `send(event)` for each part as it is known.
 * Throws a Failure when nothing can be shown; what was sent before stays sent.
 */
async function draw({ query, files, styles, send, signal }) {
  const started = Date.now();
  const at = () => Date.now() - started;
  const system = systemPrompt(query.lang);
  const sources = filesPrompt({ ...query, files, styles });
  const messages = (task) => [{ role: 'system', content: system }, { role: 'user', content: `${sources}\n\n${task}` }];

  const marks = {};
  const calls = [];
  const jobs = [];
  const areas = [];
  const ids = new Set();
  const placed = new Set();
  let phase = 'plan';
  let css = '';
  let pageChars = 0;
  let title = null;
  let summary = null;

  /**
   * One piece of an area (as it is today, or with one pattern), in a call of its own. An answer
   * that turns out to be source code is broken off and asked for once more.
   */
  async function writePiece(area, option, attempt = 0) {
    const kind = `${area.id}:${option ? option.id : 'today'}`;
    const piece = new Piece(area, option);
    const reader = new Reader((name, rest) => piece.marker(name, rest), (text) => piece.text(text));
    const own = new AbortController();
    const stop = () => own.abort();
    signal.addEventListener('abort', stop);
    let source = false;
    try {
      const task = option ? optionTask(area, option, attempt > 0) : todayTask(area, attempt > 0);
      const result = await ask({
        messages: messages(task),
        maxTokens: PIECE_TOKENS,
        signal: own.signal,
        onText: (text) => {
          reader.push(text);
          if (attempt === 0 && !source && piece.html && SOURCE_CODE.test(piece.html)) {
            source = true;
            own.abort();
          }
        },
      });
      reader.end();
      calls.push({ kind, ms: result.ms, first: result.firstMs, finish: result.finish, chars: result.chars, ...tokens(result.usage) });
    } catch (error) {
      calls.push({ kind, failed: source ? 'source' : error.code ?? 'failed' });
      if (!source) console.error('piece', kind, error.message);
      if (attempt === 0 && !signal.aborted) {
        if (error.code === 'busy') await new Promise((resolve) => setTimeout(resolve, 1500));
        signal.removeEventListener('abort', stop);
        return writePiece(area, option, 1);
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
    const events = piece.result();
    // An option that is source code a second time is left out; the element of today is needed
    // for the page to be whole, so what a browser can read of it is kept.
    if (!events || (option && SOURCE_CODE.test(events[0].html))) {
      send({ t: 'miss', area: area.id, id: option ? option.id : 'keep' });
      return;
    }
    for (const event of events) {
      if (event.html && SOURCE_CODE.test(event.html)) event.html = asHtml(event.html);
      send(event);
    }
    if (option) area.drawn = (area.drawn ?? 0) + 1;
    else area.kept = true;
  }

  const beginPage = () => {
    if (!areas.length) throw new Failure(502, 'model_error', 'The answer names no area');
    marks.plan = at();
    send({ t: 'plan', areas: areas.map((area) => ({ id: area.id, options: area.options.map((o) => o.id) })), file: query.path });
    const extra = css.replace(/\u0000/g, '').slice(0, LIMITS.css).trim();
    if (extra) send({ t: 'css', text: extra });
    phase = 'page';
  };
  const endPage = () => {
    if (phase !== 'page') return;
    flush();
    marks.page = at();
    send({ t: 'page-end' });
    phase = 'after';
  };

  // The page is passed on in pieces of some size instead of token by token.
  let waiting = '';
  let flushed = 0;
  const flush = () => {
    if (waiting) send({ t: 'page', text: waiting });
    waiting = '';
    flushed = Date.now();
  };
  const pageText = (text) => {
    waiting += text;
    if (waiting.length >= 600 || Date.now() - flushed >= 120) flush();
  };

  const reader = new Reader(
    (name, rest) => {
      if (phase === 'plan' || phase === 'css') {
        if (name === 'AREA' && phase === 'plan' && areas.length < LIMITS.areas) {
          const area = planArea(rest, ids);
          if (area) {
            areas.push(area);
            // The area is written while the page is: nothing waits for the other.
            jobs.push(writePiece(area, null), ...area.options.map((option) => writePiece(area, option)));
          }
        } else if (name === 'CSS') phase = 'css';
        else if (name === 'PAGE') beginPage();
      } else if (phase === 'page' && name === 'AREA') {
        const area = areas.find((a) => a.wanted === slug(rest.split('|')[0]));
        if (area && !placed.has(area.id)) {
          placed.add(area.id);
          pageText(`<pe-area id="${area.id}"></pe-area>\n`);
        }
      } else if (name === 'TITLE') {
        endPage();
        title = rest;
      } else if (name === 'SUMMARY') {
        endPage();
        summary = rest;
      } else if (name === 'END') endPage();
    },
    (text) => {
      if (phase === 'css') css += css.length < LIMITS.css ? text : '';
      else if (phase === 'page') {
        if (pageChars < LIMITS.page) pageText(text);
        pageChars += text.length;
      }
    },
  );

  const result = await ask({ messages: messages(pageTask()), maxTokens: PAGE_TOKENS, signal, onText: (piece) => reader.push(piece) });
  reader.end();
  calls.unshift({ kind: 'page', ms: result.ms, first: result.firstMs, finish: result.finish, chars: result.chars, ...tokens(result.usage) });
  if (phase === 'plan' || phase === 'css' || !pageChars) throw new Failure(502, 'model_error', 'The answer has no page');
  endPage();
  send({ t: 'screen', title: clean(title, 48) ?? '', summary: clean(summary, 220) ?? '' });
  await Promise.all(jobs);
  // An area that the page did not leave out is looked for in the page by the one who draws it.
  if (!areas.some((area) => area.kept && area.drawn)) throw new Failure(502, 'model_error', 'The answer has no area that can be shown');
  return { ms: at(), marks, calls };
}

export default async function handler(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);
  res.setHeader('Access-Control-Expose-Headers', 'Age, X-Vercel-Cache');

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  let begun = false;
  const controller = new AbortController();
  const deadline = setTimeout(() => controller.abort(), DEADLINE_MS);
  res.on('close', () => {
    // Nobody is reading any more: stop the model.
    if (!res.writableEnded) controller.abort();
  });

  try {
    if (req.method !== 'GET') throw new Failure(405, 'bad_request', 'Use GET');
    if (req.headers.origin && !origin) throw new Failure(403, 'forbidden', 'This page may not call the analysis');
    const query = readQuery(req.query ?? {});
    if (!process.env.UPSTAGE_API_KEY) throw new Failure(503, 'not_configured', 'Live analysis is not switched on yet');

    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    if (limited(ip)) throw new Failure(429, 'busy', 'Too many analyses from this address. Try again in a minute');

    const { files, styles } = await readFiles(query);
    const send = (event) => {
      if (!begun) {
        begun = true;
        // The same files give the same storyboard: let the CDN answer the next visitor.
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
          'X-Accel-Buffering': 'no',
        });
      }
      res.write(`${JSON.stringify(event)}\n`);
    };
    const summary = await draw({ query, files, styles, send, signal: controller.signal });
    console.log('draw', JSON.stringify({ path: query.path, ...summary }));
    send({ t: 'done', model: MODEL, read: [...files, ...styles].map((f) => f.path), ...summary });
    return res.end();
  } catch (error) {
    const known = error instanceof Failure || error instanceof SolarError;
    const failure = known ? error : new Failure(500, 'internal', 'Something went wrong');
    if (!known) console.error(error);
    else console.error('draw failed', failure.code, failure.message);
    if (begun) {
      // The answer has begun and cannot be taken back, and the CDN keeps what was sent. The page
      // asks again under another address ("try") when an answer ends like this.
      res.write(`${JSON.stringify({ t: 'error', code: failure.code, message: failure.message })}\n`);
      return res.end();
    }
    res.setHeader('Cache-Control', 'no-store');
    return res.status(failure.status).json({ ok: false, code: failure.code, message: failure.message });
  } finally {
    clearTimeout(deadline);
  }
}
