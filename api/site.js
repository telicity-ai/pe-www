// GET /api/site?url=https://example.com/pricing&lang=en&try=1
//
// Reads one public web page and prepares a storyboard of it: the page as it is, and a few
// areas of it with other arrangements to choose from. The request names an address; this
// function fetches the page itself, so that it cannot be used to send arbitrary text to the
// model, and it fetches nothing but public web pages (api/_lib/web.js).
//
// The answer is passed on while it is made, one JSON object per line, in the form that
// /api/storyboard uses, with two more kinds of line before the page:
//   {"t":"site","url":…,"title":…,"html":{…},"body":{…}}   the page's address, and the attributes of <html> and <body>
//   {"t":"sheet","text":…}                                  one of the page's stylesheets, in their order
//   {"t":"page","text":…} … {"t":"page-end"}                 the HTML inside <body>, without scripts
//   {"t":"plan","areas":[…]}  {"t":"place","area":…,"from":…,"to":…}  {"t":"screen","title":…,"summary":…}
//   {"t":"option","area":…,"id":…,"recipe":…,"pattern":…,"because":…}
//   {"t":"done","ms":…,…}   or   {"t":"error","code":…,"message":…}
//
// Nothing of the page is written by the model. The page is the site's own, and an option is
// the area's own elements arranged another way (a recipe that the page showing it carries out
// and then checks, see site/assets/preview.js). The model is asked once, for what needs a
// reader: which parts matter, what each choice is called, and which arrangement it would
// suggest and why (api/_lib/plan.js). Without its answer the first parts of the page are offered
// without a suggestion.
import { clean } from './_lib/answer.js';
import { areasSystem, areasTask } from './_lib/brief.js';
import { absoluteCss, candidates, outline, readPage } from './_lib/page.js';
import { planEvents, planOf, readAreas } from './_lib/plan.js';
import { MODEL, SolarError, ask } from './_lib/solar.js';
import { WebError, fetchPublic, publicUrl } from './_lib/web.js';

const DEFAULT_ORIGINS = ['https://telicity-ai.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const PAGE_BYTES = 2_500_000; // the page as it is served
const PAGE_CHARS = 1_500_000; // what is left of it without scripts
// A site built from parts has a stylesheet for each (some fifty of a few kilobytes); one built
// as a whole has one of a megabyte. Both are taken.
const SHEETS = 80;
const SHEET_BYTES = 2_000_000;
const SHEETS_CHARS = 4_000_000;
const DEADLINE_MS = 60_000;

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

const tokens = (usage) => (usage ? { prompt: usage.prompt_tokens, cached: usage.prompt_tokens_details?.cached_tokens, completion: usage.completion_tokens } : undefined);

/** A page's name as a person would say it: the part of its title that is not the site's slogan. */
function shortTitle(title, url) {
  const parts = (title ?? '').split(/\s+[|–—·:-]\s+/).map((part) => part.trim()).filter(Boolean);
  const fits = parts.filter((part) => part.length >= 2 && part.length <= 40);
  // On a site's first page the short part is the site's name; elsewhere the first part is the page's.
  const name = (url.pathname === '/' ? [...fits].sort((a, b) => a.length - b.length)[0] : fits[0]) ?? parts[0] ?? '';
  return clean(name, 40) ?? url.hostname.replace(/^www\./, '');
}

/** The page's stylesheets as text, in their order; one that does not come is left out. */
async function readSheets(sheets) {
  let linked = 0;
  const texts = await Promise.all(sheets.map(async (sheet) => {
    if (sheet.text) return sheet.text;
    linked += 1;
    if (linked > SHEETS) return '';
    try {
      const got = await fetchPublic(sheet.href, { maxBytes: SHEET_BYTES, ms: 8000, types: /css|text\/plain|octet-stream/i, accept: 'text/css,*/*;q=0.1' });
      return absoluteCss(got.text, got.url.href);
    } catch {
      return '';
    }
  }));
  const out = [];
  let total = 0;
  for (const text of texts) {
    if (!text.trim() || total + text.length > SHEETS_CHARS) continue;
    total += text.length;
    out.push(text);
  }
  return out;
}

async function draw({ address, lang, send, signal }) {
  const started = Date.now();
  const at = () => Date.now() - started;
  const marks = {};
  const calls = [];

  const got = await fetchPublic(address, { maxBytes: PAGE_BYTES });
  const page = readPage(got.text, got.url.href);
  if (page.page.length > PAGE_CHARS) throw new Failure(413, 'too_large', 'The page is too large');
  const list = candidates(page.page);
  // A page that is drawn by its scripts arrives all but empty.
  if (page.words < 40 || !list.length) throw new Failure(422, 'empty_page', 'There is too little on the page as it is served');
  marks.fetched = at();

  // The model is asked while the stylesheets are fetched: it needs the outline alone.
  let text = '';
  const asking = ask({ messages: [{ role: 'system', content: areasSystem(lang, 'site') }, { role: 'user', content: areasTask({ kind: 'site', name: `${page.title || got.url.href} (${got.url.href})`, outline: outline(list), lang }) }], maxTokens: 700, signal, onText: (piece) => { text += piece; } })
    .then((answer) => ({ answer }), (error) => ({ error }));

  const sheets = await readSheets(page.sheets);
  marks.sheets = at();
  send({ t: 'site', url: got.url.href, title: shortTitle(page.title, got.url), html: page.html, body: page.body });
  for (const sheet of sheets) send({ t: 'sheet', text: sheet });
  for (let i = 0; i < page.page.length; i += 60_000) send({ t: 'page', text: page.page.slice(i, i + 60_000) });
  send({ t: 'page-end' });

  // Which parts are the areas, and what would be suggested for each.
  let areas = [];
  let summary = null;
  const { answer, error } = await asking;
  if (answer) {
    calls.push({ kind: 'areas', ms: answer.ms, first: answer.firstMs, finish: answer.finish, ...tokens(answer.usage) });
    ({ areas, summary } = readAreas(text, list));
  } else {
    calls.push({ kind: 'areas', failed: error.code ?? 'failed' });
    if (signal.aborted) throw error;
  }
  const plan = planOf(list, areas, lang);
  if (!plan.length) throw new Failure(422, 'empty_page', 'The page has no part to arrange another way');
  marks.plan = at();
  send({ t: 'screen', title: shortTitle(page.title, got.url), summary: clean(summary, 220) ?? '' });
  for (const event of planEvents(plan, { file: got.url.href })) send(event);
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
    const input = one(req.query?.url);
    if (typeof input !== 'string' || input.length > 600) throw new Failure(400, 'bad_url', 'url must be a web address');
    const address = publicUrl(input);
    const lang = one(req.query?.lang) === 'ko' ? 'ko' : 'en';
    if (!process.env.UPSTAGE_API_KEY) throw new Failure(503, 'not_configured', 'Live analysis is not switched on yet');

    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    if (limited(ip)) throw new Failure(429, 'busy', 'Too many analyses from this address. Try again in a minute');

    const send = (event) => {
      if (!begun) {
        begun = true;
        // The same page gives the same storyboard for a day: let the CDN answer the next visitor.
        res.writeHead(200, {
          'Content-Type': 'application/x-ndjson; charset=utf-8',
          'Cache-Control': 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800',
          'X-Accel-Buffering': 'no',
        });
      }
      res.write(`${JSON.stringify(event)}\n`);
    };
    const summary = await draw({ address, lang, send, signal: controller.signal });
    console.log('site', JSON.stringify({ host: address.hostname, ...summary }));
    send({ t: 'done', model: MODEL, ...summary });
    return res.end();
  } catch (error) {
    const known = error instanceof Failure || error instanceof SolarError || error instanceof WebError;
    const failure = known ? error : new Failure(500, 'internal', 'Something went wrong');
    if (!known) console.error(error);
    else console.error('site failed', failure.code, failure.message);
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
