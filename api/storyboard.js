// GET /api/storyboard?repo=owner/name&ref=main&path=src/pages/Settings.tsx&rel=…&css=…&lang=en&stack=React&try=1
//
// Reads one screen of a public GitHub repository and prepares a storyboard of it: a static HTML
// mockup of the screen as the code renders it, and a few areas of it with other arrangements to
// choose from. The request names files; this function fetches them itself, so that it cannot be
// used to send arbitrary text to the model.
//
// The answer is passed on while it is written, one JSON object per line:
//   {"t":"css","text":…}
//   {"t":"page","text":…}        the page's HTML, in pieces, as the model writes it
//   {"t":"page-end"}
//   {"t":"screen","title":…,"summary":…}
//   {"t":"marked","text":…}      the page once more, whole, as a browser reads it, its groups marked:
//                                it takes the place of the pieces, and the areas are stretches of it
//   {"t":"plan","arranged":true,"areas":[{"id":…,"label":…,"options":["id",…]}],"file":…}
//   {"t":"place","area":…,"from":…,"to":…}   the area is this stretch of the marked page
//   {"t":"option","area":…,"id":…,"recipe":…,"pattern":…,"because":…}
//   {"t":"reset"}                 forget everything so far: the page is written anew
//   {"t":"done","ms":…,…}   or   {"t":"error","code":…,"message":…}
//
// The model writes the page and nothing else of what is shown. An option is never markup of its
// own: it is the area's own elements arranged another way (a recipe that the page showing it
// carries out and then checks, see site/assets/preview.js), exactly as for a live web page
// (api/site.js). Which parts of the written page become areas is found in its structure
// (api/_lib/page.js); the model is then asked once more, briefly, which of them matter, what each
// choice is called and which arrangement it would suggest (api/_lib/plan.js). A screen in which
// no such part is found is shown without areas.
import { LIMITS, Reader, SOURCE_CODE, clean, isCompleteConversation, repeatedLine } from './_lib/answer.js';
import { areasSystem, areasTask, filesPrompt, screenTask, systemPrompt } from './_lib/brief.js';
import { candidates, markPage, outline } from './_lib/page.js';
import { planEvents, planOf, readAreas } from './_lib/plan.js';
import { conversationParts } from '../site/assets/github.js';
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

// What the model may write of a page: about 25 seconds. A page that is cut off there lacks
// its lower end, which the browser closes; the parts written before that are whole.
const PAGE_TOKENS = 2_400;
const AREAS_TOKENS = 600;
const DEADLINE_MS = 150_000;

const PER_MINUTE = 6;
const hits = new Map();

/**
 * The page is asked for once more: it turned out to be the project's source code instead of
 * HTML ("source"), the model stopped in the middle of it ("short"), or it wrote one line over and
 * over ("loop").
 */
class Again extends Error {
  constructor(why, line = null) {
    super(why);
    this.why = why;
    this.line = line; // the line that was repeated
  }
}

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

async function readFile(repo, ref, path, max, keepEnd, screen = false) {
  const encoded = [...ref.split('/'), ...path.split('/')].map(encodeURIComponent).join('/');
  const result = await fetchText(`https://raw.githubusercontent.com/${repo}/${encoded}`, 10_000);
  if (result.status !== 200) return { path, status: result.status };
  if (result.text.includes('\u0000')) return { path, status: 415 };
  return { path, status: 200, ...(screen ? { conversation: conversationParts(result.text) } : {}), ...clip(result.text, max, keepEnd) };
}

async function readFiles({ repo, ref, path, rel, css }) {
  const [main, ...others] = await Promise.all([
    readFile(repo, ref, path, SCREEN_CHARS, true, true),
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
async function draw({ query, files, styles, send: pass, signal: outer, again = false, repeated = null }) {
  // Everything of this attempt ends with it: when the page is asked for anew, its call is
  // broken off and what it still says is not passed on.
  const own = new AbortController();
  const signal = own.signal;
  const stop = () => own.abort();
  outer.addEventListener('abort', stop);
  let live = true;
  const send = (event) => (live ? pass(event) : null);
  let source = false;
  let looped = null;
  const started = Date.now();
  const at = () => Date.now() - started;
  const conversation = files[0].conversation;
  const sources = filesPrompt({ ...query, files, styles });

  const marks = {};
  const calls = [];
  let phase = 'head';
  let css = '';
  let page = '';
  let waiting = '';
  let flushed = 0;
  let title = null;
  let summary = null;

  // The page is passed on in pieces of some size instead of token by token.
  const flush = () => {
    if (waiting) send({ t: 'page', text: waiting });
    waiting = '';
    flushed = Date.now();
  };
  const pageText = (text) => {
    if (page.length >= LIMITS.page) return;
    page += text;
    waiting += text;
    if (!again && !source && SOURCE_CODE.test(page.slice(-(text.length + 60)))) {
      source = true;
      own.abort();
      return;
    }
    if (text.includes('\n') && (looped = repeatedLine(page))) {
      own.abort();
      return;
    }
    if (waiting.length >= 600 || Date.now() - flushed >= 120) flush();
  };
  const beginPage = () => {
    const extra = css.replace(/\u0000/g, '').slice(0, LIMITS.css).trim();
    if (extra) send({ t: 'css', text: extra });
    marks.begun = at();
    phase = 'page';
  };
  const endPage = () => {
    if (phase !== 'page') return;
    flush();
    marks.page = at();
    send({ t: 'page-end' });
    phase = 'after';
  };

  const reader = new Reader(
    (name, rest) => {
      if (phase === 'head' || phase === 'css') {
        if (name === 'CSS') phase = 'css';
        else if (name === 'PAGE') beginPage();
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
      else if (phase === 'page') pageText(text);
    },
  );

  let result;
  try {
    // A model caught in a loop gets out of it more easily with a little more chance.
    result = await ask({
      messages: [{ role: 'system', content: systemPrompt(query.lang) }, { role: 'user', content: `${sources}\n\n${screenTask(again, repeated, conversation)}` }],
      maxTokens: PAGE_TOKENS, signal, onText: (piece) => reader.push(piece), ...(again === 'loop' ? { temperature: 0.6 } : {}),
    });
  } catch (error) {
    live = false;
    outer.removeEventListener('abort', stop);
    if (!source && !looped) throw error;
    if (again) throw new Failure(502, 'model_error', 'The answer repeated itself');
    throw new Again(source ? 'source' : 'loop', looped);
  }
  reader.end();
  const cut = result.finish === 'length' || page.length >= LIMITS.page;
  const fail = (error) => {
    live = false;
    outer.removeEventListener('abort', stop);
    return error;
  };
  if (!again && phase === 'page' && result.finish !== 'length') {
    // The model ended its answer inside the page (it does, now and then, after a few lines
    // that repeat): what there is of it is no screen.
    const line = repeatedLine(page.replace(/\s*$/, '\n'), 2);
    throw fail(line ? new Again('loop', line) : new Again('short'));
  }
  calls.push({ kind: 'page', ms: result.ms, first: result.firstMs, finish: result.finish, chars: result.chars, ...tokens(result.usage) });
  if (phase === 'head' || phase === 'css' || !/<[a-z]/i.test(page)) throw fail(new Failure(502, 'model_error', 'The answer has no page'));
  endPage();
  if (conversation.length && !isCompleteConversation(page)) throw fail(new Again('conversation'));
  send({ t: 'screen', ...(conversation.length ? { conversation: true } : {}), title: clean(title, 48) ?? '', summary: clean(summary, 220) ?? '' });

  // The page as a browser reads it (a page that was cut off ends where its last whole tag
  // ends), its groups marked; and the parts of it that could be an area.
  const marked = markPage(page.replace(/<[^>]*$/, ''));
  const list = candidates(marked, { app: true });
  send({ t: 'marked', text: marked });
  marks.parts = at();

  // Which of the parts are the areas, and what would be suggested for each. Without an answer
  // the first parts are offered, nothing suggested.
  let areas = [];
  if (list.length) {
    let text = '';
    try {
      const answer = await ask({
        messages: [{ role: 'system', content: areasSystem(query.lang, 'screen') }, { role: 'user', content: areasTask({ kind: 'screen', name: `${query.path} of ${query.repo}`, outline: outline(list), lang: query.lang }) }],
        maxTokens: AREAS_TOKENS, signal, onText: (piece) => { text += piece; },
      });
      calls.push({ kind: 'areas', ms: answer.ms, first: answer.firstMs, finish: answer.finish, ...tokens(answer.usage) });
      ({ areas } = readAreas(text, list));
    } catch (error) {
      calls.push({ kind: 'areas', failed: error.code ?? 'failed' });
      if (signal.aborted) throw fail(error);
    }
  }
  outer.removeEventListener('abort', stop);
  const plan = planOf(list, areas, query.lang, 'screen');
  marks.plan = at();
  for (const event of planEvents(plan, { file: query.path })) send(event);
  if (cut) console.log('cut', JSON.stringify({ path: query.path, page: page.length }));
  return { ms: at(), marks, calls, parts: list.length, areas: plan.length };
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
    let summary;
    const began = Date.now();
    // An answer that went wrong is asked for again while there is time for a whole one (about 50 s).
    for (let attempt = 0, again = false, repeated = null; ; attempt += 1) {
      try {
        summary = await draw({ query, files, styles, send, signal: controller.signal, again, repeated });
        break;
      } catch (error) {
        const retry = error instanceof Again || (error instanceof Failure && error.code === 'model_error');
        if (!retry || attempt >= 2 || controller.signal.aborted || Date.now() - began > DEADLINE_MS - 60_000) throw error;
        console.log('again', JSON.stringify({ path: query.path, attempt, why: error instanceof Again ? error.why : error.message }));
        // What was sent of the attempt is taken back.
        send({ t: 'reset' });
        if (error instanceof Again) {
          again = error.why;
          repeated = error.line;
        } else again = 'short';
      }
    }
    console.log('storyboard', JSON.stringify({ path: query.path, ...summary }));
    send({ t: 'done', model: MODEL, read: [...files, ...styles].map((f) => f.path), ...summary });
    return res.end();
  } catch (error) {
    const known = error instanceof Failure || error instanceof SolarError;
    const failure = known ? error : new Failure(500, 'internal', 'Something went wrong');
    if (!known) console.error(error);
    else console.error('storyboard failed', failure.code, failure.message);
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
