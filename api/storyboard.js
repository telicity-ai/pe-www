// GET /api/storyboard?repo=owner/name&ref=main&path=src/pages/Settings.tsx&rel=…&css=…&lang=en&stack=React&try=1
//
// Reads one screen of a public GitHub repository and asks Solar for a storyboard of it: a static
// HTML mockup of the screen as the code renders it, and a few areas with options from
// picky-eater's catalog. The request names files; this function fetches them itself, so that it
// cannot be used to send arbitrary text to the model.
//
// The answer is passed on while it is written, one JSON object per line:
//   {"t":"plan","areas":[{"id":…,"label":…,"decision":…,"options":["id",…]}],"file":…}
//   {"t":"css","text":…}
//   {"t":"page","text":…}        the page's HTML, in pieces, the areas included
//   {"t":"place","area":…,"from":…,"to":…}   the area is this stretch of the page (offsets in its text)
//   {"t":"page-end"}
//   {"t":"screen","title":…,"summary":…}
//   {"t":"option","area":…,"id":…,"pattern":…,"label":…,"html":…,"suggested":…,"because":…}
//   {"t":"miss","area":…,"id":…}   that option will not come ("keep": the area has no place in the page)
//   {"t":"reset"}                 forget everything so far: the page is written anew
//   {"t":"done","ms":…,…}   or   {"t":"error","code":…,"message":…}
// One call to the model writes the whole page, so that the page is of one piece. As soon as the
// element of an area is written, that element goes to calls of their own, one for each option:
// a person waits for the page and a little longer, not for everything in a row.
import { ElementScan, LIMITS, Reader, SOURCE_CODE, Variant, clean, findElement, findStart, markup, repeatedLine, planChoice, slug } from './_lib/answer.js';
import { areasTask, filesPrompt, screenTask, systemPrompt, variantTask } from './_lib/brief.js';
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
// its lower end, which the browser closes; the areas written before that are whole.
const PAGE_TOKENS = 2_400;
const OPTION_TOKENS = 1_800;
// An area larger than this is the page rather than a part of it.
const AREA_CHARS = 8_000;
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
async function draw({ query, files, styles, send: pass, signal: outer, again = false, repeated = null }) {
  // Everything of this attempt ends with it: when the page is asked for anew, its calls are
  // broken off and what they still say is not passed on.
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
  const system = systemPrompt(query.lang);
  const sources = filesPrompt({ ...query, files, styles });
  const messages = (task) => [{ role: 'system', content: system }, { role: 'user', content: `${sources}\n\n${task}` }];

  const marks = {};
  const calls = [];
  const jobs = [];
  const areas = [];
  const ids = new Set();
  let phase = 'plan';
  let css = '';
  let page = ''; // the page as it is sent: the places of the areas are offsets in it
  let waiting = '';
  let flushed = 0;
  let captures = []; // areas whose element is being written
  let title = null;
  let summary = null;
  let cut = false; // the page was cut off: elements still open at its end run to it

  /** One option of an area, in a call of its own. An answer that turns out to be source code is broken off and asked for once more. */
  async function writeOption(area, option, attempt = 0) {
    const kind = `${area.id}:${option.id}`;
    const variant = new Variant(area, option);
    const reader = new Reader((name, rest) => variant.marker(name, rest), (text) => variant.text(text));
    const own = new AbortController();
    const stop = () => own.abort();
    signal.addEventListener('abort', stop);
    let source = false;
    try {
      const result = await ask({
        messages: messages(variantTask(area, option, area.today, attempt > 0)),
        maxTokens: OPTION_TOKENS,
        signal: own.signal,
        onText: (text) => {
          reader.push(text);
          if (attempt === 0 && !source && variant.html && SOURCE_CODE.test(variant.html)) {
            source = true;
            own.abort();
          }
        },
      });
      reader.end();
      calls.push({ kind, ms: result.ms, first: result.firstMs, finish: result.finish, chars: result.chars, ...tokens(result.usage) });
    } catch (error) {
      calls.push({ kind, failed: source ? 'source' : error.code ?? 'failed' });
      if (!source) console.error('option', kind, error.message);
      if (attempt === 0 && !signal.aborted) {
        if (error.code === 'busy') await new Promise((resolve) => setTimeout(resolve, 1500));
        signal.removeEventListener('abort', stop);
        return writeOption(area, option, 1);
      }
    } finally {
      signal.removeEventListener('abort', stop);
    }
    const event = variant.result();
    if (!event || SOURCE_CODE.test(event.html)) {
      send({ t: 'miss', area: area.id, id: option.id });
      return null;
    }
    send(event);
    area.drawn = (area.drawn ?? 0) + 1;
    return null;
  }

  // The page is passed on in pieces of some size instead of token by token.
  const flush = () => {
    if (waiting) send({ t: 'page', text: waiting });
    waiting = '';
    flushed = Date.now();
  };

  /** The area is the element in this stretch of the page: say so, and have its options drawn. */
  const place = (area, from, to) => {
    if (area.today) return;
    // An element cut off with the page is an area unless it is most of the page.
    if (to === page.length && cut && to - from > page.length * 0.7) return;
    const html = markup(page.slice(from, to), AREA_CHARS + 1);
    if (!/<[a-z]/i.test(html) || html.length > AREA_CHARS) return;
    area.today = html;
    marks[area.id] = at();
    flush();
    send({ t: 'place', area: area.id, from, to });
    for (const option of area.options) jobs.push(writeOption(area, option));
  };

  // The plan says how the element of each area begins. As soon as that beginning stands in
  // the page, the element is followed to its end, and then its options are drawn while the
  // rest of the page is still being written.
  const watch = () => {
    for (const area of areas) {
      if (area.today || !area.anchor || captures.some((c) => c.area === area)) continue;
      let start = findStart(page, area.anchor, true);
      // What follows the opening tag is often not as the plan foresaw. A tag with many classes
      // is telling enough by itself.
      if (start < 0 && area.opening) start = findStart(page, area.opening, true);
      if (start < 0) continue;
      const capture = { area, at: start, scan: new ElementScan() };
      const end = capture.scan.push(page.slice(start));
      if (end < 0) captures.push(capture);
      else place(area, capture.at + capture.scan.from, capture.at + end);
    }
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
    captures = captures.filter((capture) => {
      const end = capture.scan.push(text);
      if (end < 0) return true;
      place(capture.area, capture.at + capture.scan.from, capture.at + end);
      return false;
    });
    if (waiting.length >= 600 || Date.now() - flushed >= 120) {
      watch();
      flush();
    }
  };

  const named = (rest) => areas.find((a) => a.wanted === slug(rest.split('|')[0]));
  const beginPage = () => {
    if (!areas.length) throw new Failure(502, 'model_error', 'The answer names no area');
    marks.plan = at();
    send({ t: 'plan', areas: areas.map(({ id, label, decision, options }) => ({ id, label, ...(decision ? { decision } : {}), options: options.map((o) => o.id) })), file: query.path });
    const extra = css.replace(/\u0000/g, '').slice(0, LIMITS.css).trim();
    if (extra) send({ t: 'css', text: extra });
    phase = 'page';
  };
  const endPage = () => {
    if (phase !== 'page') return;
    watch();
    flush();
    cut ||= page.length >= LIMITS.page;
    if (cut) for (const capture of captures) if (capture.scan.from >= 0) place(capture.area, capture.at + capture.scan.from, page.length);
    captures = [];
    // What the plan said of an area's beginning may be a little off: its opening tag alone will do now.
    for (const area of areas) {
      const found = area.today || !area.anchor ? null : findElement(page, area.anchor, cut);
      if (found) place(area, found.from, found.to);
    }
    marks.page = at();
    send({ t: 'page-end' });
    phase = 'after';
  };

  const reader = new Reader(
    (name, rest) => {
      if (phase === 'plan' || phase === 'css') {
        if (name === 'AREA' && phase === 'plan' && areas.length < LIMITS.areas) {
          const area = planChoice(rest, ids);
          if (area) areas.push(area);
        } else if (name === 'CSS') phase = 'css';
        else if (name === 'PAGE') beginPage();
      } else if (name === 'WHERE') {
        endPage();
        // An area that was not marked in the page is found by the opening tag of its element.
        const area = named(rest);
        const found = area && !area.today && rest.includes('|') ? findElement(page, rest.slice(rest.indexOf('|') + 1), cut) : null;
        if (found) place(area, found.from, found.to);
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
    result = await ask({ messages: messages(screenTask(again, repeated)), maxTokens: PAGE_TOKENS, signal, onText: (piece) => reader.push(piece), ...(again === 'loop' ? { temperature: 0.6 } : {}) });
  } catch (error) {
    live = false;
    outer.removeEventListener('abort', stop);
    if (!source && !looped) throw error;
    await Promise.all(jobs);
    if (again) throw new Failure(502, 'model_error', 'The answer repeated itself');
    throw new Again(source ? 'source' : 'loop', looped);
  }
  outer.removeEventListener('abort', stop);
  cut = result.finish === 'length';
  reader.end();
  if (!again && phase === 'page' && result.finish !== 'length') {
    // The model ended its answer inside the page (it does, now and then, after a few lines
    // that repeat): what there is of it is no screen.
    live = false;
    own.abort();
    await Promise.all(jobs);
    const line = repeatedLine(page.replace(/\s*$/, '\n'), 2);
    throw line ? new Again('loop', line) : new Again('short');
  }

  calls.unshift({ kind: 'page', ms: result.ms, first: result.firstMs, finish: result.finish, chars: result.chars, ...tokens(result.usage) });
  if (phase === 'plan' || phase === 'css' || !page) throw new Failure(502, 'model_error', 'The answer has no page');
  endPage();
  send({ t: 'screen', title: clean(title, 48) ?? '', summary: clean(summary, 220) ?? '' });
  const planned = [...areas];
  if (!areas.some((area) => area.today) && !signal.aborted) {
    // None of the areas that were planned is in the page as it was written (it was cut off before
    // them, or they begin otherwise): the page is shown to the model, which names areas that are.
    const lines = [];
    const answer = new Reader((name, rest) => (name === 'AREA' ? lines.push(rest) : null), () => {});
    try {
      const found = await ask({ messages: messages(areasTask(page.slice(0, 24_000))), maxTokens: 500, signal, onText: (piece) => answer.push(piece) });
      answer.end();
      calls.push({ kind: 'areas', ms: found.ms, first: found.firstMs, finish: found.finish, chars: found.chars, ...tokens(found.usage) });
    } catch (error) {
      calls.push({ kind: 'areas', failed: error.code ?? 'failed' });
    }
    for (const line of lines.slice(0, LIMITS.areas)) {
      const area = planChoice(line, ids);
      if (area?.anchor) areas.push(area);
    }
    if (areas.length > planned.length) {
      send({ t: 'plan', areas: areas.map(({ id, label, decision, options }) => ({ id, label, ...(decision ? { decision } : {}), options: options.map((o) => o.id) })), file: query.path });
      for (const area of areas.slice(planned.length)) {
        const found = findElement(page, area.anchor, cut);
        if (found) place(area, found.from, found.to);
      }
    }
  }
  for (const area of areas) {
    if (area.today) continue;
    send({ t: 'miss', area: area.id, id: 'keep' });
    console.log('unplaced', JSON.stringify({ path: query.path, area: area.id, anchor: (area.anchor ?? '').slice(0, 240), page: page.length }));
  }
  await Promise.all(jobs);
  if (!areas.some((area) => area.today && area.drawn)) throw new Failure(502, 'model_error', 'The answer has no area that can be shown');
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
    let summary;
    try {
      summary = await draw({ query, files, styles, send, signal: controller.signal });
    } catch (error) {
      if (!(error instanceof Again)) throw error;
      // What was sent of the first attempt is taken back.
      send({ t: 'reset' });
      summary = await draw({ query, files, styles, send, signal: controller.signal, again: error.why, repeated: error.line });
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
