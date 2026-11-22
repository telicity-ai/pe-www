// Reads an analysis as it is written (one JSON object per line) and puts the pieces together.
//
// The page arrives in pieces, the areas included. Of each area the answer says which stretch of
// the page it is, and then brings its options one by one. `assemble` gives what can be drawn at
// any moment: an area becomes a choice once its place is known and its options are there.
import { RepoError } from './github.js';
import { parseMarkup } from './preview.js';

/** What has arrived so far. */
export function newBoard(file) {
  return { file, plan: [], areas: new Map(), css: '', page: '', pageDone: false, conversation: false, title: '', summary: '', done: false, site: null, sheets: [] };
}

function areaOf(board, id) {
  if (!board.areas.has(id)) board.areas.set(id, { id, label: '', decision: null, place: null, options: [], missing: new Set() });
  return board.areas.get(id);
}

/** Takes one line of the answer in. Returns true when what can be drawn may have changed. */
export function take(board, event) {
  switch (event.t) {
    case 'reset':
      // The page is written anew: what has arrived so far no longer counts.
      Object.assign(board, newBoard(board.file));
      return true;
    case 'plan':
      board.plan = event.areas;
      for (const planned of event.areas) {
        const area = areaOf(board, planned.id);
        area.label = planned.label ?? '';
        area.decision = planned.decision ?? null;
      }
      return false;
    case 'css':
      board.css = event.text;
      return true;
    case 'site':
      // A live page: its address, and what its <html> and <body> carry for its styles to select on.
      board.site = { url: event.url, html: event.html ?? {}, body: event.body ?? {} };
      board.title = event.title || board.title;
      return false;
    case 'sheet':
      board.sheets.push(event.text);
      return false;
    case 'page':
      board.page += event.text;
      return true;
    case 'page-end':
      board.pageDone = true;
      return true;
    case 'screen':
      board.conversation = event.conversation === true;
      board.title = event.title || board.title;
      board.summary = event.summary || board.summary;
      return true;
    case 'place':
      if (Number.isInteger(event.from) && Number.isInteger(event.to) && event.from >= 0 && event.to > event.from) areaOf(board, event.area).place = { from: event.from, to: event.to };
      return true;
    case 'option': {
      const area = areaOf(board, event.area);
      if (!area.options.some((o) => o.id === event.id)) {
        area.options.push({ id: event.id, label: event.label, pattern: event.pattern, html: event.html, ...(event.suggested ? { suggested: true } : {}), ...(event.because ? { because: event.because } : {}) });
      }
      return true;
    }
    case 'miss':
      areaOf(board, event.area).missing.add(event.id);
      return true;
    case 'done':
      board.done = true;
      board.pageDone = true;
      return true;
    default:
      return false;
  }
}

/** The areas that are choices now: their place is known and their options have come (or will not). */
function ready(board) {
  const out = [];
  for (const planned of board.plan) {
    const area = board.areas.get(planned.id);
    if (!area?.place || !area.options.length || area.place.to > board.page.length) continue;
    const expected = (planned.options ?? []).filter((id) => !area.missing.has(id)).length;
    if (board.done || area.options.length >= expected) out.push(area);
  }
  return out;
}

/**
 * What can be drawn now, in the form the preview and the prompt work with:
 * { screen, css, page, areas: [{ id, label, decision, options: [{ id, label, keep|pattern|suggested|because, html }] }] }.
 * In `page` a choice is a <pe-area id> in the place of its element; that element is the first
 * option, the area as it is today. An area that is not a choice (yet) is simply part of the page.
 */
export function assemble(board, fallbackTitle = '') {
  const choices = ready(board);
  // The places are stretches of the page's text: they are marked there before the text is read
  // as HTML. An area may lie inside another, so a mark that opens stands before one that closes.
  const marks = [];
  for (const area of choices) {
    const size = area.place.to - area.place.from;
    marks.push({ at: area.place.from, open: true, size, text: `<!--pe:${area.id}-->` }, { at: area.place.to, open: false, size, text: `<!--/pe:${area.id}-->` });
  }
  // A page cut off in the middle of a tag: a mark placed after it would be read as part of the tag.
  const whole = board.page.replace(/<[^>]*$/, '');
  // Written from the end of the text backwards; at one offset an inner area closes first and opens last.
  marks.sort((a, b) => b.at - a.at || (a.open === b.open ? (a.open ? a.size - b.size : b.size - a.size) : a.open ? -1 : 1));
  let text = whole;
  for (const mark of marks) {
    const at = Math.min(mark.at, whole.length);
    text = text.slice(0, at) + mark.text + text.slice(at);
  }

  const doc = parseMarkup(text);
  const comments = new Map();
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_COMMENT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) comments.set(node.data, node);
  const areas = new Map();
  // Inner areas first: the present state of the area around them then holds their place.
  for (const area of [...choices].sort((a, b) => (a.place.to - a.place.from) - (b.place.to - b.place.from))) {
    const from = comments.get(`pe:${area.id}`);
    const to = comments.get(`/pe:${area.id}`);
    // An area cut off with the page closes at its end, inside whatever was still open there:
    // it ends where the element it began with ends.
    if (from && to && area.place.to === board.page.length && from.parentNode !== to.parentNode && from.parentNode?.contains(to)) {
      let outer = to;
      while (outer.parentNode !== from.parentNode) outer = outer.parentNode;
      outer.after(to);
    }
    // Marks that the HTML tore apart (a stretch that is not one element after all) give no area.
    if (!from || !to || from.parentNode !== to.parentNode) continue;
    const range = doc.createRange();
    range.setStartAfter(from);
    range.setEndBefore(to);
    const holder = doc.createElement('div');
    holder.append(range.extractContents());
    if (!holder.querySelector('*')) continue;
    const slot = doc.createElement('pe-area');
    slot.setAttribute('id', area.id);
    from.replaceWith(slot);
    to.remove();
    const pick = area.options.find((o) => o.suggested) ?? area.options[0];
    areas.set(area.id, {
      id: area.id,
      label: area.label || area.id,
      ...(area.decision ? { decision: area.decision } : {}),
      options: [
        { id: 'keep', label: '', keep: true, html: holder.innerHTML },
        ...area.options.map((option) => {
          const { suggested, because, ...plain } = option;
          return option === pick ? { ...plain, suggested: true, ...(because ? { because } : {}) } : plain;
        }),
      ],
    });
  }
  return {
    ...(board.conversation ? { conversation: true } : {}),
    ...(board.site ? { site: true } : {}),
    screen: { title: board.title || fallbackTitle, summary: board.summary, file: board.file },
    css: board.css,
    page: doc.body.innerHTML,
    // In the order of the plan.
    areas: board.plan.map((planned) => areas.get(planned.id)).filter(Boolean),
    waiting: !board.done,
  };
}

/**
 * Asks for an analysis and calls `onEvent(event)` for every line of the answer.
 * Resolves when the answer is complete; throws a RepoError otherwise. `error.fast` is set when
 * the failure came at once, which is what a failure kept by the CDN looks like.
 */
export async function streamBoard(url, onEvent, signal) {
  const started = Date.now();
  const fail = (code) => Object.assign(new RepoError(code), { fast: Date.now() - started < 2500 });
  let response;
  try {
    response = await fetch(url, { signal });
  } catch {
    throw fail('offline');
  }
  if (!response.ok || !response.body) {
    let body = null;
    try { body = await response.json(); } catch { /* not JSON: handled below */ }
    throw fail(body?.code ?? (response.status === 404 ? 'offline' : 'failed'));
  }
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let done = false;
  const line = (text) => {
    if (!text.trim()) return;
    let event;
    try { event = JSON.parse(text); } catch { return; }
    if (event.t === 'error') throw fail(event.code === 'busy' ? 'busy' : 'failed');
    if (event.t === 'done') done = true;
    onEvent(event);
  };
  try {
    for (;;) {
      const { value, done: ended } = await reader.read();
      if (ended) break;
      buffer += decoder.decode(value, { stream: true });
      for (;;) {
        const end = buffer.indexOf('\n');
        if (end < 0) break;
        line(buffer.slice(0, end));
        buffer = buffer.slice(end + 1);
      }
    }
    line(buffer);
  } catch (error) {
    if (error instanceof RepoError) throw error;
    throw fail('offline');
  }
  // An answer that stops before its end was broken off on the way, or long ago and kept.
  if (!done) throw fail('failed');
}
