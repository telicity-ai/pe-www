// Reading what the model writes, as it writes it. An answer is plain text in which lines that
// start with "@@" are markers; what stands between two markers belongs to the first of them.

export const LIMITS = { page: 90_000, css: 30_000 };

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

/**
 * Source code where HTML was asked for: a JSX attribute, a component's tag, an expression in
 * braces, a directive of Vue or Svelte.
 */
export const SOURCE_CODE = /\bclassName=|<[A-Z][A-Za-z0-9.]*[\s/>]|=\{|\{[^{}"']*(&&|\|\||=>|\.map\()|\{[#:/@]|\sv-(if|for|bind|on|model|show)\b|\s[:@][a-zA-Z][\w.-]*=/;

/** A populated conversation has a title, messages and a composer, in order. */
export function isCompleteConversation(page) {
  const column = /<div\b[^>]*\sdata-chat-column(?=[\s=>])[^>]*>/i.exec(page);
  if (!column) return false;
  let body = page.slice(column.index + column[0].length).trimStart();
  for (const opening of [
    /^<header\b[^>]*\sdata-chat-header(?=[\s=>])[^>]*>/i,
    /^<main\b[^>]*\srole=["']log["'][^>]*>/i,
    /^<footer\b[^>]*\sdata-chat-composer(?=[\s=>])[^>]*>/i,
  ]) {
    const tag = opening.exec(body)?.[0];
    if (!tag) return false;
    // A closing landmark also closes any inner div the model left open in
    // HTML. Counting divs here would reject pages the browser lays out correctly.
    const name = /^<(\w+)/.exec(tag)[1].toLowerCase();
    const close = `</${name}>`;
    const end = body.toLowerCase().indexOf(close, tag.length);
    if (end < 0) return false;
    const region = body.slice(tag.length, end);
    const texts = [...region.matchAll(/(?:^|>)([^<>]+)(?=<|$)/g)].map((m) => m[1].trim()).filter(Boolean);
    if (name === 'header' && !texts.length) return false;
    if (name === 'main' && texts.length < 2) return false;
    if (name === 'footer' && !/<textarea\b/i.test(region)) return false;
    body = body.slice(end + close.length).trimStart();
  }
  return /^<\/div\s*>/i.test(body);
}

/**
 * The line that the page ends by repeating `times` times in a row, or null. A model that writes
 * one line again and again does not get out of that by itself.
 */
export function repeatedLine(page, times = 3) {
  const lines = page.slice(-4000).split('\n').map((line) => line.trim()).filter(Boolean);
  if (!/\n\s*$/.test(page)) lines.pop(); // the last line is still being written
  const last = lines.slice(-times);
  return last.length === times && last[0].length >= 20 && last.every((line) => line === last[0]) ? last[0] : null;
}
