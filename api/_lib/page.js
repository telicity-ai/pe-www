// A live web page, made ready to be shown and to be asked about: what is taken out of it (its
// scripts and what only they need), which stylesheets it wants, and which of its parts could be
// an area: a group of like items (cards, plans, quotes) or a block around a heading (a hero).
// Such a part is never written anew: its own elements are arranged another way by the page that
// shows it, so the parts are marked here for that page to find.
import { parse, parseFragment, serialize } from 'parse5';

const DROP = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'noscript', 'template', 'iframe', 'frame', 'object', 'embed', 'audio', 'video', 'canvas', 'dialog']);
const LAZY = ['data-src', 'data-lazy-src', 'data-original', 'data-lazy'];

const attr = (node, name) => node.attrs?.find((a) => a.name === name)?.value;
const elements = (node) => (node.childNodes ?? []).filter((child) => child.tagName);

function find(node, tag) {
  for (const child of elements(node)) {
    if (child.tagName === tag) return child;
    const inside = find(child, tag);
    if (inside) return inside;
  }
  return null;
}

function textOf(node, limit = 4000) {
  let out = '';
  const walk = (n) => {
    if (out.length > limit) return;
    if (n.nodeName === '#text') out += `${n.value} `;
    else if (n.tagName !== 'svg') for (const child of n.childNodes ?? []) walk(child);
  };
  walk(node);
  return out.replace(/\s+/g, ' ').trim();
}

const absolute = (value, base) => {
  try {
    const url = new URL(value.trim(), base);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.href : null;
  } catch {
    return null;
  }
};

/** A stylesheet's own addresses (fonts, pictures), made whole; what it would import is left out. */
export function absoluteCss(css, base) {
  return css
    .replace(/@import\b[^;]*;/gi, (rule) => (/^@import\s+(url\(\s*)?["']?https:\/\/fonts\.googleapis\.com\//i.test(rule) ? rule : ''))
    .replace(/url\(\s*(["']?)(?!data:|#)([^"')]+)\1\s*\)/gi, (whole, quote, value) => {
      const url = absolute(value, base);
      return url ? `url("${url.replace(/"/g, '%22')}")` : 'url("")';
    });
}

/** What may stay of the attributes of <html> and <body>: what stylesheets select on. */
function rootAttributes(node) {
  const out = {};
  for (const { name, value } of node?.attrs ?? []) {
    if ((name === 'class' || name === 'lang' || name === 'dir' || name.startsWith('data-')) && value.length < 400 && Object.keys(out).length < 12) out[name] = value;
  }
  return out;
}

/** Takes out of a tree what is not shown or would run, and makes the addresses of its pictures whole. */
function tidy(node, base) {
  for (const child of elements(node)) {
    // A film is not played here; the picture that stands for it until it plays is shown in its place.
    if (child.tagName !== 'video' || !attr(child, 'poster')) continue;
    child.tagName = 'img';
    child.nodeName = 'img';
    child.attrs = [{ name: 'src', value: attr(child, 'poster') }, ...child.attrs.filter((a) => a.name === 'class' || a.name === 'style' || a.name === 'width' || a.name === 'height'), { name: 'alt', value: '' }];
    child.childNodes = [];
  }
  node.childNodes = (node.childNodes ?? []).filter((child) => child.nodeName !== '#comment' && !DROP.has(child.tagName));
  for (const child of elements(node)) {
    child.attrs = child.attrs.filter((a) => !a.name.startsWith('on') && !a.name.startsWith('data-pe') && a.name !== 'srcset' && a.name !== 'sizes' && a.name !== 'integrity' && a.name !== 'nonce');
    if (child.tagName === 'img') {
      const lazy = LAZY.map((name) => attr(child, name)).find(Boolean);
      const source = attr(child, 'src');
      const url = absolute(lazy && (!source || source.startsWith('data:')) ? lazy : source ?? lazy ?? '', base);
      child.attrs = child.attrs.filter((a) => a.name !== 'src' && !LAZY.includes(a.name) && a.name !== 'loading');
      if (url) child.attrs.push({ name: 'src', value: url });
    } else if (child.tagName === 'source') {
      child.attrs = child.attrs.filter((a) => a.name !== 'src');
    } else if (child.tagName === 'a') {
      child.attrs = child.attrs.filter((a) => a.name !== 'target' && a.name !== 'rel' && a.name !== 'download');
      const link = child.attrs.find((a) => a.name === 'href');
      if (link) link.value = '#';
    } else if (child.tagName === 'form') {
      child.attrs = child.attrs.filter((a) => a.name !== 'action' && a.name !== 'method');
    }
    const style = child.attrs.find((a) => a.name === 'style');
    if (style && /url\(/i.test(style.value)) style.value = absoluteCss(style.value, base);
    tidy(child, base);
  }
}

/**
 * Reads a page as it was served: `{ title, html, body, sheets, page }`. `sheets` are its
 * stylesheets in the order of the page, each `{ href }` to be fetched or `{ text }`; `page` is
 * the HTML inside <body> without scripts; `html` and `body` are the attributes of those elements.
 */
export function readPage(source, address) {
  const document = parse(source);
  const root = elements(document).find((n) => n.tagName === 'html') ?? document;
  const head = find(root, 'head');
  const body = find(root, 'body') ?? root;
  const base = absolute(attr(find(root, 'base') ?? {}, 'href') ?? '', address) ?? address;
  const sheets = [];
  const collect = (node) => {
    for (const child of elements(node)) {
      if (child.tagName === 'link' && /\bstylesheet\b/i.test(attr(child, 'rel') ?? '') && !/\bprint\b/i.test(attr(child, 'media') ?? '')) {
        const href = absolute(attr(child, 'href') ?? '', base);
        if (href) sheets.push({ href });
      } else if (child.tagName === 'style' && !/\bprint\b/i.test(attr(child, 'media') ?? '')) {
        const text = (child.childNodes ?? []).map((n) => n.value ?? '').join('');
        if (text.trim()) sheets.push({ text: absoluteCss(text, base) });
      } else if (child.tagName !== 'noscript' && child.tagName !== 'template') collect(child);
    }
  };
  collect(root);
  tidy(body, base);
  markGroups(body);
  return {
    title: head ? textOf(find(head, 'title') ?? {}, 200) : '',
    html: rootAttributes(root),
    body: rootAttributes(body),
    sheets,
    page: serialize(body).trim(),
    words: textOf(body, 20_000).split(' ').length,
  };
}

// ---------- what a page is made of ----------

const HIDDEN = (node) => node.attrs.some((a) => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true') || (a.name === 'style' && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.value)));
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4']);
const ITEM_TAGS = new Set(['div', 'li', 'a', 'article', 'section', 'figure', 'blockquote', 'details']);
const NOT_A_BLOCK = new Set(['a', 'button', 'label', 'span', 'p', 'li', 'hgroup', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'body', 'html']);

/** How many words a text has; writing without spaces between words is counted by its characters. */
const wordCount = (text) => text.split(/\s+/).filter(Boolean).length + Math.floor((text.match(/[぀-ヿ一-鿿]/g) ?? []).length / 2);

const known = new WeakMap();
/** What an element holds, hidden parts left out: `{ words, pictures, headings, actions, light }`. `light` is its size without its pictures. */
function factsOf(node) {
  if (known.has(node)) return known.get(node);
  const facts = { words: 0, pictures: 0, headings: 0, actions: 0, light: 12 + Math.min((attr(node, 'class') ?? '').length, 60) };
  for (const child of node.childNodes ?? []) {
    if (child.nodeName === '#text') {
      const text = child.value.trim();
      facts.words += wordCount(text);
      facts.light += text.length;
    } else if (child.tagName === 'svg' || child.tagName === 'img' || child.tagName === 'picture') {
      // A drawing as small as a letter is an icon, not a picture; of a drawing only its attributes say which.
      const small = child.tagName === 'svg' && (Number(attr(child, 'width')) || 100) <= 48;
      facts.pictures += small ? 0 : 1;
      facts.light += 30;
    } else if (child.tagName && !HIDDEN(child)) {
      const inner = factsOf(child);
      for (const name of Object.keys(facts)) facts[name] += inner[name];
      if (HEADINGS.has(child.tagName)) facts.headings += 1;
      if (child.tagName === 'a' || child.tagName === 'button') facts.actions += 1;
    }
  }
  known.set(node, facts);
  return facts;
}

const classesOf = (node) => (attr(node, 'class') ?? '').trim().split(/\s+/).filter(Boolean);
/** Two elements that look like two of a kind: the same tag, and classes that are mostly the same. */
function alike(a, b) {
  if (a.tagName !== b.tagName) return false;
  const x = classesOf(a);
  const y = classesOf(b);
  if (!x.length || !y.length) return x.length === y.length;
  const shared = x.filter((name) => y.includes(name)).length;
  return x[0] === y[0] || shared >= Math.max(x.length, y.length) * 0.5;
}

/**
 * The like items that an element is a group of, or null: cards, plans, quotes, steps. They are
 * most of what the element holds, each has words and something more (a heading, a picture, a
 * link), and none is as large as a section of the page.
 */
function groupAt(node) {
  const kids = elements(node).filter((kid) => !HIDDEN(kid));
  const kinds = [];
  for (const kid of kids) {
    if (!ITEM_TAGS.has(kid.tagName)) continue;
    const kind = kinds.find((list) => alike(list[0], kid));
    if (kind) kind.push(kid);
    else kinds.push([kid]);
  }
  const items = kinds.sort((a, b) => b.length - a.length)[0];
  if (!items || items.length < 2 || items.length > 24) return null;
  const facts = items.map(factsOf);
  const mean = (name) => facts.reduce((sum, f) => sum + f[name], 0) / facts.length;
  if (facts.filter((f) => f.words >= 3 && (f.headings || f.pictures || f.actions)).length < items.length * 0.8) return null;
  // Two of a kind are a pair of cards only when each says something: a heading and its text are two of a kind too.
  if (items.length === 2 && facts.some((f) => f.words < 8 || !(f.headings || f.pictures))) return null;
  if (mean('light') > 2500 || mean('words') > 160) return null;
  // Items of one kind are about as large as each other: a heading beside the list it heads is not one of the list.
  const sizes = facts.map((f) => f.light);
  if (Math.max(...sizes) > Math.min(...sizes) * (items.length === 2 ? 2.5 : 6)) return null;
  if (facts.reduce((sum, f) => sum + f.light, 0) < factsOf(node).light * 0.6) return null;
  return items;
}

/** Marks the groups of a page for the page that shows it: data-pe-group on the element, data-pe-item on each item. */
function markGroups(node) {
  for (const child of elements(node)) {
    // Menus and the links at the foot of a page are groups too, but not ones to arrange anew.
    if (HIDDEN(child) || child.tagName === 'svg' || child.tagName === 'nav' || child.tagName === 'footer') continue;
    const items = groupAt(child);
    if (!items) {
      markGroups(child);
      continue;
    }
    child.attrs.push({ name: 'data-pe-group', value: String(items.length) });
    for (const item of items) item.attrs.push({ name: 'data-pe-item', value: '' });
    // What an item holds is the item's own; what stands beside the items is looked at.
    for (const other of elements(child)) if (!items.includes(other)) markGroups({ childNodes: [other] });
  }
}

// ---------- the parts that could be an area ----------

const within = (node, test) => {
  for (let up = node.parentNode; up?.tagName; up = up.parentNode) if (test(up)) return true;
  return false;
};
const all = (node, test, out = []) => {
  for (const child of elements(node)) {
    if (HIDDEN(child) || child.tagName === 'svg') continue;
    if (test(child)) out.push(child);
    all(child, test, out);
  }
  return out;
};
const headingIn = (node, skip = null) => {
  for (const child of elements(node)) {
    if (HIDDEN(child) || child === skip || child.tagName === 'svg') continue;
    if (HEADINGS.has(child.tagName)) return textOf(child, 120);
    const inside = headingIn(child, skip);
    if (inside) return inside;
  }
  return '';
};
const isGroup = (node) => node.attrs?.some((a) => a.name === 'data-pe-group');

/**
 * The parts of a page that could be an area, in the order of the page:
 * `[{ n, kind, from, to, fits, … }]`. `page` is the text that `readPage` gave; `from` and `to`
 * are offsets in it. A part is a "group" (`items`, how many; `each`, what an item holds;
 * `title`, the heading above them; `names`, how the items begin) or a "block" around a heading
 * (`opens`, when it is the page's first; `heading`; `has`, what else it holds). `fits` are the
 * arrangements that can be made of it.
 */
export function candidates(page, { groups = 10, blocks = 6 } = {}) {
  const fragment = parseFragment(page, { sourceCodeLocationInfo: true });
  const found = [];

  for (const group of all(fragment, isGroup)) {
    if (!group.sourceCodeLocation) continue;
    const items = elements(group).filter((el) => el.attrs.some((a) => a.name === 'data-pe-item'));
    // The area is the group with what belongs to it (its heading, a line of text above it): as
    // far up as the group stays most of the element.
    let top = group;
    for (let up = group.parentNode; up?.tagName && up.sourceCodeLocation; up = up.parentNode) {
      if (up.tagName === 'main' || factsOf(group).light < factsOf(up).light * 0.55 || all(up, isGroup).length > 1) break;
      top = up;
      // A section of the page is as far as a part reaches.
      if (up.tagName === 'section' || up.tagName === 'article' || up.tagName === 'aside') break;
    }
    const facts = items.map(factsOf);
    const share = (name) => facts.filter((f) => f[name]).length >= items.length * 0.6;
    const pictures = share('pictures');
    found.push({
      kind: 'group', node: top, from: top.sourceCodeLocation.startOffset, to: top.sourceCodeLocation.endOffset,
      items: items.length,
      each: [share('headings') && 'a heading', 'text', pictures && 'a picture', share('actions') && 'a link'].filter(Boolean),
      title: top === group ? '' : headingIn(top, group),
      // Every item is named, so that the model counts them right; of a long list, the first few.
      names: items.slice(0, 6).map((item) => (headingIn({ childNodes: [item] }) || textOf(item, 60)).slice(0, items.length > 4 ? 32 : 48)),
      fits: ['grid', pictures ? 'zigzag' : 'rows', ...(items.length >= 3 ? ['scroller', 'featured'] : [])],
    });
  }

  let first = true;
  for (const heading of all(fragment, (el) => el.tagName === 'h1' || el.tagName === 'h2')) {
    if (within(heading, (up) => isGroup(up) || up.tagName === 'nav' || up.tagName === 'footer')) continue;
    // The block is the heading with what belongs to it (a line of text, buttons, a picture):
    // as far up as there is one heading and no group.
    let top = null;
    for (let up = heading.parentNode; up?.tagName && up.sourceCodeLocation; up = up.parentNode) {
      const facts = factsOf(up);
      if (up.tagName === 'main' || facts.light > 3500 || facts.words > 160 || isGroup(up) || all(up, isGroup).length || all(up, (el) => el.tagName === 'h1' || el.tagName === 'h2').length > 1) break;
      if (!NOT_A_BLOCK.has(up.tagName)) top = up;
      if (up.tagName === 'section' || up.tagName === 'article' || up.tagName === 'aside' || up.tagName === 'header') break;
    }
    if (!top) continue;
    const facts = factsOf(top);
    const own = factsOf(heading).words;
    if (facts.words < own + 3 && !facts.actions && !facts.pictures) continue;
    if (found.some((c) => c.from < top.sourceCodeLocation.endOffset && top.sourceCodeLocation.startOffset < c.to)) continue;
    found.push({
      kind: 'block', node: top, from: top.sourceCodeLocation.startOffset, to: top.sourceCodeLocation.endOffset,
      opens: first && heading.tagName === 'h1',
      heading: textOf(heading, 120),
      has: [facts.words > own + 2 && 'text', facts.actions && `${facts.actions} ${facts.actions === 1 ? 'link' : 'links'}`, facts.pictures && 'a picture'].filter(Boolean),
      fits: ['centered', 'left', ...(facts.pictures ? ['split'] : [])],
    });
    first = false;
  }

  const keep = (kind, limit) => found.filter((c) => c.kind === kind).sort((a, b) => a.from - b.from).slice(0, limit);
  return [...keep('group', groups), ...keep('block', blocks)].sort((a, b) => a.from - b.from).map((c, index) => ({ ...c, n: index + 1 }));
}

/** The candidates as the model reads them: one line each. */
export function outline(list) {
  const quote = (text) => `"${text.replace(/"/g, "'")}"`;
  return list.map((c) => {
    const what = c.kind === 'group'
      ? `${c.items} items${c.title ? ` under the heading ${quote(c.title)}` : ''}, each with ${c.each.join(', ')}: ${c.names.map(quote).join(' / ')}${c.items > c.names.length ? ` and ${c.items - c.names.length} more` : ''}`
      : `a block${c.opens ? ' that opens the page' : ''}: the heading ${quote(c.heading)}${c.has.length ? `, ${c.has.join(', ')}` : ''}`;
    return `[${c.n}] ${what}. Can be: ${c.fits.join(', ')}`;
  }).join('\n');
}
