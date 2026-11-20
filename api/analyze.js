// GET /api/analyze?repo=owner/name&ref=main&path=src/pages/Settings.tsx&rel=a.css&rel=b.tsx&lang=en&stack=React
//
// Reads one screen of a public GitHub repository and asks Solar for a storyboard of it:
// a wireframe of the screen as it is, and a few areas with options from picky-eater's catalog.
// The request names files; this function fetches them itself, so that it cannot be used to send
// arbitrary text to the model.
import { normalize } from './_lib/normalize.js';
import { SCHEMA, systemPrompt, userPrompt } from './_lib/prompt.js';

const UPSTAGE_URL = 'https://api.upstage.ai/v1/chat/completions';
const MODEL = process.env.SOLAR_MODEL || 'solar-pro4';

const DEFAULT_ORIGINS = ['https://telicity-ai.github.io'];
const LOCAL_ORIGIN = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

const MAIN_CHARS = 36_000;
const RELATED_CHARS = 10_000;
const TOTAL_CHARS = 64_000;
const MAX_RELATED = 5;
const SOURCE_FILE = /\.(tsx|jsx|ts|js|mjs|vue|svelte|astro|html|css|scss|less|mdx)$/i;

const PER_MINUTE = 8;
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

function one(value) {
  return Array.isArray(value) ? value[0] : value;
}

function many(value) {
  return value === undefined ? [] : Array.isArray(value) ? value : [value];
}

function checkPath(path) {
  if (typeof path !== 'string' || path.length > 300 || !/^[A-Za-z0-9._\-/@()[\]+$~ ]+$/.test(path)) return false;
  if (path.startsWith('/') || path.split('/').some((part) => part === '..' || part === '.' || part === '')) return false;
  return SOURCE_FILE.test(path);
}

function readQuery(query) {
  const repo = one(query.repo);
  const ref = one(query.ref);
  const path = one(query.path);
  if (typeof repo !== 'string' || !/^[A-Za-z0-9_.-]{1,100}\/[A-Za-z0-9_.-]{1,100}$/.test(repo)) throw new Failure(400, 'bad_request', 'repo must be owner/name');
  if (typeof ref !== 'string' || !/^[A-Za-z0-9._\-/]{1,200}$/.test(ref) || ref.includes('..')) throw new Failure(400, 'bad_request', 'ref is not a branch, tag or commit');
  if (!checkPath(path)) throw new Failure(400, 'bad_request', 'path is not a source file');
  const rel = [...new Set(many(query.rel))].filter((p) => p !== path && checkPath(p)).slice(0, MAX_RELATED);
  const lang = one(query.lang) === 'ko' ? 'ko' : 'en';
  const stack = typeof one(query.stack) === 'string' ? one(query.stack).replace(/[^A-Za-z0-9 .,+#/-]/g, '').slice(0, 120) : '';
  return { repo, ref, path, rel, lang, stack };
}

async function fetchText(url, ms) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  try {
    const response = await fetch(url, { signal: controller.signal, redirect: 'error' });
    if (!response.ok) return { status: response.status };
    const text = await response.text();
    return { status: 200, text };
  } catch {
    return { status: 0 };
  } finally {
    clearTimeout(timer);
  }
}

async function readFile(repo, ref, path, max) {
  const encoded = [...ref.split('/'), ...path.split('/')].map(encodeURIComponent).join('/');
  const result = await fetchText(`https://raw.githubusercontent.com/${repo}/${encoded}`, 9000);
  if (result.status !== 200) return { path, status: result.status };
  // A file with NUL bytes is not source text.
  if (result.text.includes('\u0000')) return { path, status: 415 };
  const truncated = result.text.length > max;
  return { path, status: 200, text: truncated ? result.text.slice(0, max) : result.text, truncated };
}

async function readFiles({ repo, ref, path, rel }) {
  const [main, ...related] = await Promise.all([
    readFile(repo, ref, path, MAIN_CHARS),
    ...rel.map((p) => readFile(repo, ref, p, RELATED_CHARS)),
  ]);
  if (main.status === 404) throw new Failure(404, 'file_not_found', 'That file is not in the repository, or the repository is private');
  if (main.status !== 200) throw new Failure(502, 'github_unavailable', 'GitHub did not return the file');
  if (main.text.trim().length < 40) throw new Failure(422, 'file_too_small', 'That file is almost empty');

  const files = [main];
  let total = main.text.length;
  for (const file of related) {
    if (file.status !== 200 || total + file.text.length > TOTAL_CHARS) continue;
    files.push(file);
    total += file.text.length;
  }
  return files;
}

async function askSolar({ lang, repo, path, stack, files }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 52_000);
  let response;
  try {
    response = await fetch(UPSTAGE_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: { 'content-type': 'application/json', authorization: `Bearer ${process.env.UPSTAGE_API_KEY}` },
      body: JSON.stringify({
        model: MODEL,
        temperature: 0.4,
        max_tokens: 9000,
        messages: [
          { role: 'system', content: systemPrompt(lang) },
          { role: 'user', content: userPrompt({ repo, path, stack, files }) },
        ],
        response_format: { type: 'json_schema', json_schema: { name: 'storyboard', strict: true, schema: SCHEMA } },
      }),
    });
  } catch (error) {
    throw new Failure(504, 'model_timeout', error?.name === 'AbortError' ? 'The model took too long' : 'The model could not be reached');
  } finally {
    clearTimeout(timer);
  }

  if (response.status === 401 || response.status === 403) throw new Failure(503, 'not_configured', 'The model key was rejected');
  if (response.status === 429) throw new Failure(429, 'busy', 'Too many analyses are running. Try again in a minute');
  if (!response.ok) {
    const detail = (await response.text().catch(() => '')).slice(0, 300);
    console.error('solar error', response.status, detail);
    throw new Failure(502, 'model_error', 'The model returned an error');
  }

  const body = await response.json();
  const choice = body?.choices?.[0];
  if (choice?.finish_reason === 'length') throw new Failure(502, 'model_error', 'The answer was cut off');
  let parsed;
  try {
    parsed = JSON.parse(choice?.message?.content ?? '');
  } catch {
    throw new Failure(502, 'model_error', 'The answer was not JSON');
  }
  try {
    return { storyboard: normalize(parsed), usage: body.usage };
  } catch (error) {
    console.error('normalize', error.message);
    throw new Failure(502, 'model_error', 'The answer could not be drawn');
  }
}

export default async function handler(req, res) {
  const origin = allowedOrigin(req.headers.origin);
  res.setHeader('Vary', 'Origin');
  if (origin) res.setHeader('Access-Control-Allow-Origin', origin);

  if (req.method === 'OPTIONS') {
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Max-Age', '86400');
    return res.status(204).end();
  }

  try {
    if (req.method !== 'GET') throw new Failure(405, 'bad_request', 'Use GET');
    if (req.headers.origin && !origin) throw new Failure(403, 'forbidden', 'This page may not call the analysis');
    const query = readQuery(req.query ?? {});
    if (!process.env.UPSTAGE_API_KEY) throw new Failure(503, 'not_configured', 'Live analysis is not switched on yet');

    const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown';
    if (limited(ip)) throw new Failure(429, 'busy', 'Too many analyses from this address. Try again in a minute');

    const files = await readFiles(query);
    const { storyboard, usage } = await askSolar({ ...query, files });

    // The same files give the same storyboard: let the CDN answer the next visitor.
    res.setHeader('Cache-Control', 'public, max-age=0, s-maxage=86400, stale-while-revalidate=604800');
    return res.status(200).json({
      ok: true,
      screen: { title: storyboard.title, summary: storyboard.summary, file: query.path },
      page: storyboard.page,
      areas: storyboard.areas,
      read: files.map((f) => f.path),
      model: MODEL,
      usage: usage ? { prompt: usage.prompt_tokens, completion: usage.completion_tokens } : undefined,
    });
  } catch (error) {
    const failure = error instanceof Failure ? error : new Failure(500, 'internal', 'Something went wrong');
    if (!(error instanceof Failure)) console.error(error);
    res.setHeader('Cache-Control', 'no-store');
    return res.status(failure.status).json({ ok: false, code: failure.code, message: failure.message });
  }
}
