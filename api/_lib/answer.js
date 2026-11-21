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

/** Markup from the model, cut to size. The page that shows it keeps only harmless elements; scripts are dropped here as well. */
export function markup(value, max) {
  return value.replace(/\u0000/g, '').replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '').slice(0, max).trim();
}

/**
 * Source code where HTML was asked for: a JSX attribute, a component's tag, an expression in
 * braces, a directive of Vue or Svelte.
 */
export const SOURCE_CODE = /\bclassName=|<[A-Z][A-Za-z0-9.]*[\s/>]|=\{|\{[^{}"']*(&&|\|\||=>|\.map\()|\{[#:/@]|\sv-(if|for|bind|on|model|show)\b|\s[:@][a-zA-Z][\w.-]*=/;

const OPENING_TAG = /^<[A-Za-z][^"'>]*(?:"[^"]*"[^"'>]*|'[^']*'[^"'>]*)*>/;

/**
 * An "@@AREA id | decision | pattern, pattern | label | beginning of its element" line of the
 * plan, or null when it names nothing usable. The first pattern is the one suggested.
 */
export function planChoice(rest, seen) {
  const parts = rest.split('|');
  const [id, decision, patterns] = parts.slice(0, 3).map((part) => part.trim());
  const wanted = slug(id);
  if (!wanted || seen.has(wanted)) return null;
  const options = [...new Set((patterns ?? '').split(/[,\s]+/).filter((p) => PATTERN_IDS.has(p)))].slice(0, LIMITS.alternatives).map((pattern, index) => ({ id: pattern, pattern, ...(index === 0 ? { suggested: true } : {}) }));
  if (!options.length) return null;
  const area = { id: unique(wanted, seen), wanted, label: clean(parts[3] ?? '', 70) ?? wanted.replace(/-/g, ' '), options };
  if (DECISION_IDS.has(decision)) area.decision = decision;
  const anchor = parts.slice(4).join('|').trim();
  if (anchor.startsWith('<')) {
    area.anchor = anchor;
    // The opening tag alone, when it has classes enough to be the only one of its kind in a page.
    const tag = OPENING_TAG.exec(anchor)?.[0];
    if (tag && (/\bclass\s*=\s*"([^"]*)"/.exec(tag)?.[1].trim().split(/\s+/).length ?? 0) >= 4) area.opening = tag;
  }
  return area;
}

const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);

/**
 * Finds where the first element of a piece of markup ends, as the markup arrives. After
 * `push` has returned an offset, `from` is where that element begins and the offset where it
 * ends, both counted from the first character pushed.
 */
export class ElementScan {
  constructor() {
    this.at = 0;
    this.from = -1;
    this.end = -1;
    this.depth = 0;
    this.state = 'text';
  }

  /** Takes more text in. Returns the offset just after the element once it has ended, else -1. */
  push(text) {
    for (let i = 0; i < text.length && this.end < 0; i += 1) {
      this.step(text[i]);
      this.at += 1;
    }
    return this.end;
  }

  step(c) {
    switch (this.state) {
      case 'text':
        if (c === '<') {
          this.state = 'open';
          this.start = this.at;
        }
        return;
      case 'open':
        if (c === '/') {
          this.closing = true;
          this.name = '';
          this.state = 'name';
        } else if (c === '!') {
          this.seen = '';
          this.state = 'bang';
        } else if (/[A-Za-z]/.test(c)) {
          this.closing = false;
          this.name = c;
          this.state = 'name';
        } else this.state = 'text';
        return;
      case 'name':
        if (/[\w:.-]/.test(c)) {
          this.name += c;
          return;
        }
        this.state = 'attributes';
        this.quote = '';
        this.slash = false;
        // falls through: the character that ended the name is read as part of the tag
      case 'attributes':
        if (this.quote) {
          if (c === this.quote) this.quote = '';
        } else if (c === '"' || c === "'") this.quote = c;
        else if (c === '>') this.tag();
        else if (!/\s/.test(c)) this.slash = c === '/';
        return;
      case 'bang':
        this.seen += c;
        if (this.seen === '--') this.state = 'comment';
        else if (c === '>') this.state = 'text';
        return;
      default: // a comment
        this.seen = (this.seen + c).slice(-3);
        if (this.seen === '-->') this.state = 'text';
    }
  }

  tag() {
    this.state = 'text';
    const name = this.name.toLowerCase();
    if (this.closing) {
      if (this.from < 0) return; // the end of something that began before
      this.depth -= 1;
    } else {
      if (this.from < 0) this.from = this.start;
      if (!VOID.has(name) && !this.slash) this.depth += 1;
    }
    if (this.depth <= 0) this.end = this.at + 1;
  }
}


/**
 * Where in `page` the element begins whose beginning is `anchor` (its opening tag and what
 * follows, as the one who writes the page says it): an offset, or -1. With `exact`, only the
 * whole of the anchor counts; without, its opening tag alone will do, and then its tag name
 * and classes.
 */
export function findStart(page, anchor, exact = false) {
  // A beginning that was cut short ("…", or in the middle of a long opening tag) still says where.
  const copy = anchor.trim().replace(/(\.{3}|…)+$/, '').trim();
  if (!/^<[A-Za-z]/.test(copy) || copy.length < 8) return -1;
  const tag = OPENING_TAG.exec(copy)?.[0];
  // White space is not compared: between tags and between words it differs from copy to copy.
  const loose = (text) => new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s*').replace(/>/g, '>\\s*').replace(/</g, '\\s*<').replace(/^\\s\*/, ''));
  for (const wanted of exact || !tag ? [copy] : [copy, tag]) {
    const at = page.search(loose(wanted));
    if (at >= 0) return at;
  }
  if (exact || !tag) return -1;
  const named = /^<([A-Za-z][\w-]*)\b[^>]*?\bclass\s*=\s*"([^"]*)"/.exec(tag);
  if (!named) return -1;
  const classes = named[2].trim().split(/\s+/).map((name) => name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('\\s+');
  return page.search(new RegExp(`<${named[1]}\\b[^>]*\\bclass\\s*=\\s*"\\s*${classes}\\s*"`));
}

/** The element of `page` that begins as `anchor` says: `{ from, to }`, or null. */
export function findElement(page, anchor) {
  const at = findStart(page, anchor);
  if (at < 0) return null;
  const scan = new ElementScan();
  const end = scan.push(page.slice(at));
  return end < 0 ? null : { from: at + scan.from, to: at + end };
}

/** Reads the answer of one call about an option: its label, the reason for it when it is the one suggested, and its element. */
export class Variant {
  constructor(area, option) {
    this.area = area;
    this.option = option;
    this.label = null;
    this.because = null;
    this.html = null; // null until "@@HTML", then the text read so far
    this.closed = false;
  }

  marker(name, rest) {
    if (name === 'HTML') {
      if (this.html === null) this.html = '';
      return;
    }
    if (this.html !== null) this.closed = true;
    if (name === 'OPTION') this.label = clean(rest.split('|')[0], 70);
    else if (name === 'WHY') this.because = clean(rest, 200);
  }

  text(text) {
    if (this.html !== null && !this.closed && this.html.length < LIMITS.option) this.html += text;
  }

  /** The line to send, or null when there is no HTML in the answer. */
  result() {
    const html = markup(this.html ?? '', LIMITS.option);
    if (!/<[a-z]/i.test(html)) return null;
    const { id, pattern, suggested } = this.option;
    return { t: 'option', area: this.area.id, id, pattern, label: this.label ?? pattern, ...(suggested ? { suggested: true, ...(this.because ? { because: this.because } : {}) } : {}), html };
  }
}
