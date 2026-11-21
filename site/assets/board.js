// Reads an analysis as it is written (one JSON object per line) and puts the pieces together.
//
// The page arrives in pieces, with <pe-area id> where an area goes; each area arrives on its
// own: the element as it is today, then its options. `assemble` gives what can be drawn at any
// moment: an area becomes a choice once it has its place, its present state and an option.
import { RepoError } from './github.js';
import { parseMarkup } from './preview.js';

/** What has arrived so far. */
export function newBoard(file) {
  return { file, plan: [], areas: new Map(), css: '', page: '', pageDone: false, title: '', summary: '', done: false };
}

function areaOf(board, id) {
  if (!board.areas.has(id)) board.areas.set(id, { id, label: '', decision: null, keep: null, options: [], suggest: null, missing: new Set() });
  return board.areas.get(id);
}

/** Takes one line of the answer in. Returns true when what can be drawn may have changed. */
export function take(board, event) {
  switch (event.t) {
    case 'plan':
      board.plan = event.areas;
      for (const area of event.areas) areaOf(board, area.id);
      return false;
    case 'css':
      board.css = event.text;
      return true;
    case 'page':
      board.page += event.text;
      return true;
    case 'page-end':
      board.pageDone = true;
      return true;
    case 'screen':
      board.title = event.title || board.title;
      board.summary = event.summary || board.summary;
      return true;
    case 'area': {
      const area = areaOf(board, event.id);
      area.label = event.label;
      area.decision = event.decision ?? null;
      return true;
    }
    case 'option': {
      const area = areaOf(board, event.area);
      if (event.keep) area.keep = { id: 'keep', label: event.label, keep: true, html: event.html };
      else if (!area.options.some((o) => o.id === event.id)) area.options.push({ id: event.id, label: event.label, pattern: event.pattern, html: event.html });
      return true;
    }
    case 'suggest':
      areaOf(board, event.area).suggest = { id: event.id, because: event.because };
      return true;
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

const words = (text) => new Set(text.toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1));
const classes = (el) => [...el.classList].sort().join(' ');

/**
 * The element of the page that an area's present state is a copy of, for a page that wrote the
 * area out instead of leaving its place open: the same tag with the same classes, or else the
 * element whose words are most like it.
 */
function locate(body, html) {
  const copy = parseMarkup(html).body.firstElementChild;
  if (!copy) return null;
  const free = (el) => !el.closest('pe-area') && !el.querySelector('pe-area');
  const wanted = classes(copy);
  if (wanted) {
    const same = [...body.querySelectorAll(copy.localName)].filter((el) => classes(el) === wanted && free(el));
    if (same.length === 1) return same[0];
  }
  const said = (el) => el.textContent.replace(/\s+/g, ' ').trim().toLowerCase();
  const target = words(copy.textContent);
  if (target.size < 3) {
    // Too few words to compare: only an element of the same kind that says exactly the same counts.
    const text = said(copy);
    if (!text) return null;
    const saying = [...body.querySelectorAll('*')].filter((el) => said(el) === text && free(el));
    const same = saying.filter((el) => el.localName === copy.localName);
    if (same.length === 1) return same[0];
    // Wrappers around one and the same text: the outermost of them is the element.
    return saying.length && saying.every((el) => saying[0].contains(el)) ? saying[0] : null;
  }
  let best = null;
  let bestScore = 0.6;
  for (const el of body.querySelectorAll('*')) {
    const length = el.textContent.length;
    if (length < copy.textContent.length * 0.5 || length > copy.textContent.length * 2 || !free(el)) continue;
    const have = words(el.textContent);
    let shared = 0;
    for (const word of target) if (have.has(word)) shared += 1;
    const score = shared / (target.size + have.size - shared);
    // Of nested elements with the same words the inner one is the area itself; the outer ones wrap it.
    if (score > bestScore || (score === bestScore && best && best.contains(el))) {
      best = el;
      bestScore = score;
    }
  }
  return best;
}

const within = (part, whole) => {
  let shared = 0;
  for (const word of part) if (whole.has(word)) shared += 1;
  return part.size ? shared / part.size : 0;
};

/**
 * The page and an area are written by different calls, and now and then the page writes a part
 * of the area as well: the area's own element around its place, or its first children before
 * it. What the area brings itself is taken out of the page, so that nothing stands there twice.
 */
function withoutDoubles(slot, html) {
  const copy = parseMarkup(html).body;
  const root = copy.firstElementChild;
  if (!root) return;
  const have = words(copy.textContent);
  const parent = slot.parentElement;
  if (parent && parent.localName === root.localName && classes(root) && classes(parent) === classes(root) && within(words(parent.textContent), have) >= 0.9) {
    parent.replaceWith(slot);
    return;
  }
  const inside = new Set([...copy.querySelectorAll('*')].filter((el) => classes(el)).map((el) => `${el.localName} ${classes(el)}`));
  const double = (el) => el && el.localName !== 'pe-area' && inside.has(`${el.localName} ${classes(el)}`) && words(el.textContent).size >= 2 && within(words(el.textContent), have) >= 0.9;
  for (let i = 0; i < 8 && double(slot.previousElementSibling); i += 1) slot.previousElementSibling.remove();
  for (let i = 0; i < 8 && double(slot.nextElementSibling); i += 1) slot.nextElementSibling.remove();
}

/**
 * What can be drawn now, in the form the preview and the prompt work with:
 * { screen, css, page, areas: [{ id, label, decision, options: [{ id, label, keep|pattern|suggested|because, html }] }] }.
 * An area that is not a choice yet stands in the page as it is today, or as an empty box while
 * its present state has not arrived.
 */
export function assemble(board, fallbackTitle = '') {
  const doc = parseMarkup(board.page);
  const body = doc.body;
  const slots = new Map();
  for (const slot of [...body.querySelectorAll('pe-area')]) {
    const id = slot.getAttribute('id');
    if (slots.has(id) || !board.areas.has(id)) slot.remove();
    else slots.set(id, slot);
  }
  // A page that wrote an area out: its element gives way to the area.
  if (board.pageDone) {
    for (const area of board.areas.values()) {
      if (slots.has(area.id) || !area.keep) continue;
      const found = locate(body, area.keep.html);
      if (!found) continue;
      const slot = doc.createElement('pe-area');
      slot.setAttribute('id', area.id);
      found.replaceWith(slot);
      slots.set(area.id, slot);
    }
  }

  for (const [id, slot] of slots) {
    const keep = board.areas.get(id)?.keep;
    if (keep && slot.isConnected) withoutDoubles(slot, keep.html);
  }
  // An area that lies inside another has its place in that one's present state, for as long as
  // that state stands.
  const today = new Map([...board.areas.values()].filter((a) => a.keep).map((a) => [a.id, a.keep]));
  const inner = new Set();
  if (board.pageDone) {
    for (const area of board.areas.values()) {
      if (slots.has(area.id) || !area.keep) continue;
      for (const outer of board.areas.values()) {
        if (outer === area || !slots.has(outer.id) || !outer.keep || inner.has(outer.id)) continue;
        const holder = parseMarkup(today.get(outer.id).html);
        const found = locate(holder.body, area.keep.html);
        if (!found || found === holder.body.firstElementChild) continue;
        const slot = holder.createElement('pe-area');
        slot.setAttribute('id', area.id);
        found.replaceWith(slot);
        today.set(outer.id, { ...outer.keep, html: holder.body.innerHTML });
        inner.add(area.id);
        break;
      }
    }
  }
  // The areas in the order of the plan, with those that lie inside another after the one they lie in.
  const order = (board.plan.length ? board.plan : [...board.areas.values()].map((a) => ({ id: a.id, options: [] })));
  const usable = (id) => {
    const area = board.areas.get(id);
    const planned = order.find((p) => p.id === id);
    const expected = (planned?.options ?? []).filter((option) => !area.missing.has(option)).length;
    return Boolean(area?.keep && area.options.length && (board.done || (expected > 0 && area.options.length >= expected)));
  };

  const areas = [];
  const choice = (area) => {
    const pick = area.options.find((o) => o.id === area.suggest?.id) ?? area.options[0];
    return {
      id: area.id,
      label: area.label || area.keep.label,
      ...(area.decision ? { decision: area.decision } : {}),
      options: [today.get(area.id), ...area.options.map((option) => (option === pick ? { ...option, suggested: true, ...(area.suggest?.id === option.id && area.suggest.because ? { because: area.suggest.because } : {}) } : option))],
    };
  };
  for (const planned of order) {
    const area = board.areas.get(planned.id);
    const slot = slots.get(planned.id);
    if (!area || !slot) continue;
    if (usable(area.id)) areas.push(choice(area));
    else if (area.keep) {
      // Not a choice (yet): it is simply part of the page.
      slot.replaceWith(...parseMarkup(today.get(area.id).html).body.childNodes);
    } else if (!board.done && !area.missing.has('keep')) slot.replaceWith(doc.createElement('pe-wait'));
    else slot.remove();
  }
  // An area inside another is a choice when the one around it is one too: its place is in that one's option.
  for (const id of inner) {
    const area = board.areas.get(id);
    const around = areas.find((a) => a.options[0].html.includes(`<pe-area id="${id}"></pe-area>`));
    if (around && usable(id)) areas.push(choice(area));
    else if (around) around.options[0] = { ...around.options[0], html: around.options[0].html.replace(`<pe-area id="${id}"></pe-area>`, area.keep.html) };
  }
  return {
    screen: { title: board.title || fallbackTitle, summary: board.summary, file: board.file },
    css: board.css,
    page: body.innerHTML,
    areas,
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
