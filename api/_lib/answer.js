import { DECISIONS, PATTERNS } from './catalog.js';

// Reading what the model writes, as it writes it. An answer is plain text in which lines that
// start with "@@" are markers; what stands between two markers belongs to the first of them.

const PATTERN_IDS = new Set(PATTERNS.map((p) => p.id));
const DECISION_IDS = new Set(DECISIONS.map((d) => d.id));

export const LIMITS = { areas: 4, alternatives: 3, page: 90_000, option: 30_000, css: 30_000 };

const MARKER = /^@@([A-Z]+)(?:[ \t]+(.*))?$/;

/**
 * Cuts text that arrives in pieces into markers and the text between them.
 * `onMarker(name, rest)` is called for a marker line, `onText(text)` for everything else, as
 * soon as it is known not to be the beginning of a marker.
 */
export class Reader {
  constructor(onMarker, onText) {
    this.onMarker = onMarker;
    this.onText = onText;
    this.held = '';
    this.inLine = false; // the line being read has been passed on in part: it is text to its end
  }

  push(chunk) {
    let text = this.held + chunk;
    this.held = '';
    for (;;) {
      const end = text.indexOf('\n');
      if (end < 0) break;
      this.line(text.slice(0, end), true);
      text = text.slice(end + 1);
    }
    // The beginning of a line that may still become a marker, or a code fence, waits for its end.
    const start = text.trimStart();
    const open = (mark) => mark.startsWith(start.slice(0, mark.length)) || start.startsWith(mark);
    if (!this.inLine && (open('@@') || open('```'))) this.held = text;
    else if (text) {
      this.inLine = true;
      this.onText(text);
    }
  }

  line(line, complete) {
    if (this.inLine) {
      this.inLine = false;
      this.onText(complete ? `${line}\n` : line);
      return;
    }
    const clean = line.replace(/\r$/, '');
    const marker = MARKER.exec(clean.trim());
    if (marker) this.onMarker(marker[1], (marker[2] ?? '').trim());
    else if (/^\s*```/.test(clean)) { /* a code fence around the answer is not part of it */ } else this.onText(complete ? `${line}\n` : line);
  }

  end() {
    const rest = this.held;
    this.held = '';
    if (rest || this.inLine) this.line(rest, false);
  }
}

export function clean(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

export function slug(value) {
  return typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : '';
}

function unique(id, seen) {
  let candidate = id;
  for (let i = 2; seen.has(candidate); i += 1) candidate = `${id}-${i}`;
  seen.add(candidate);
  return candidate;
}

const fields = (rest) => rest.split('|').map((part) => part.trim());

/** Markup from the model, cut to size. The page that shows it keeps only harmless elements; scripts are dropped here as well. */
export function markup(value, max) {
  return value.replace(/\u0000/g, '').replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '').slice(0, max).trim();
}

/** An "@@AREA id | decision | pattern, pattern | where" line of the plan, or null when it names nothing usable. */
export function planArea(rest, seen) {
  // The last part is free text and may hold a "|" of its own (a JSX tag with "||" in it).
  const parts = rest.split('|');
  const [id, decision, patterns] = parts.slice(0, 3).map((part) => part.trim());
  const where = parts.slice(3).join('|');
  const wanted = slug(id);
  if (!wanted || seen.has(wanted)) return null;
  const options = [...new Set((patterns ?? '').split(/[,\s]+/).filter((p) => PATTERN_IDS.has(p)))].slice(0, LIMITS.alternatives).map((pattern) => ({ id: pattern, pattern }));
  if (!options.length) return null;
  const area = { id: unique(wanted, seen), wanted, where: clean(where, 400) ?? wanted, options };
  if (DECISION_IDS.has(decision)) area.decision = decision;
  return area;
}

/**
 * Source code where HTML was asked for: a JSX attribute, a component's tag, an expression in
 * braces, a directive of Vue or Svelte.
 */
export const SOURCE_CODE = /\bclassName=|<[A-Z][A-Za-z0-9.]*[\s/>]|=\{|\{[^{}"']*(&&|\|\||=>|\.map\()|\{[#:/@]|\sv-(if|for|bind|on|model|show)\b|\s[:@][a-zA-Z][\w.-]*=/;

/** The last resort for an answer that is source code after all: what a browser can read of it. */
export const asHtml = (html) => html
  .replace(/\bclassName=/g, 'class=')
  .replace(/=\{[^{}<>]*\}/g, '=""')
  .replace(/\{[^{}<>]*\(\s*(?=<)/g, '')
  .replace(/\)\s*\}/g, '')
  .replace(/\{[^{}<>]*\}/g, '');

/**
 * Reads the answer of one call about an area: the element as it is today (with the area's
 * label and the suggestion), or the element with one pattern (with the option's label).
 * `result()` gives the events to send, or null when there is no HTML in it.
 */
export class Piece {
  constructor(area, option = null) {
    this.area = area;
    this.option = option;
    this.label = null;
    this.now = null;
    this.suggest = null;
    this.html = null; // null until "@@HTML", then the text read so far
    this.closed = false;
  }

  marker(name, rest) {
    if (name === 'HTML') {
      if (this.html === null) this.html = '';
      return;
    }
    if (this.html !== null) this.closed = true;
    if (name === 'LABEL') this.label = clean(rest, 70);
    else if (name === 'NOW') this.now = clean(rest, 70);
    else if (name === 'OPTION') this.label = clean(rest.split('|')[0], 70);
    else if (name === 'SUGGEST') {
      const [pattern, ...because] = fields(rest);
      const option = this.area.options.find((o) => o.pattern === pattern);
      if (option) this.suggest = { t: 'suggest', area: this.area.id, id: option.id, because: clean(because.join(' | '), 200) ?? undefined };
    }
  }

  text(text) {
    if (this.html !== null && !this.closed && this.html.length < LIMITS.option) this.html += text;
  }

  result() {
    const html = markup(this.html ?? '', LIMITS.option);
    if (!/<[a-z]/i.test(html)) return null;
    const area = this.area.id;
    if (this.option) return [{ t: 'option', area, id: this.option.id, pattern: this.option.pattern, label: this.label ?? this.option.pattern, html }];
    return [
      { t: 'area', id: area, label: this.label ?? this.now ?? area, ...(this.area.decision ? { decision: this.area.decision } : {}) },
      { t: 'option', area, id: 'keep', keep: true, label: this.now ?? this.label ?? 'Today', html },
      ...(this.suggest ? [this.suggest] : []),
    ];
  }
}
