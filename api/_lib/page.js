// A live web page, made ready to be shown and to be asked about: what is taken out of it (its
// scripts and what only they need), which stylesheets it wants, which of its elements could be
// an area, and such an element in a short form for the model.
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
  node.childNodes = (node.childNodes ?? []).filter((child) => child.nodeName !== '#comment' && !DROP.has(child.tagName));
  for (const child of elements(node)) {
    child.attrs = child.attrs.filter((a) => !a.name.startsWith('on') && a.name !== 'srcset' && a.name !== 'sizes' && a.name !== 'integrity' && a.name !== 'nonce');
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
  return {
    title: head ? textOf(find(head, 'title') ?? {}, 200) : '',
    html: rootAttributes(root),
    body: rootAttributes(body),
    sheets,
    page: serialize(body).trim(),
    words: textOf(body, 20_000).split(' ').length,
  };
}

// ---------- the elements that could be an area ----------

const HIDDEN = (node) => node.attrs.some((a) => a.name === 'hidden' || (a.name === 'aria-hidden' && a.value === 'true') || (a.name === 'style' && /display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.value)));
const NOT_AN_AREA = new Set(['svg', 'option', 'optgroup', 'tr', 'td', 'th', 'thead', 'tbody', 'li', 'p', 'span', 'a', 'button', 'label', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'picture', 'figure', 'img', 'br', 'hr', 'input', 'select', 'textarea', 'body', 'html']);
const count = (node, tags) => {
  let n = 0;
  const walk = (el) => { for (const child of elements(el)) { if (tags.has(child.tagName)) n += 1; if (child.tagName !== 'svg') walk(child); } };
  walk(node);
  return n;
};
const LINKS = new Set(['a']);
const BUTTONS = new Set(['button']);
const FIELDS = new Set(['input', 'select', 'textarea']);
const PICTURES = new Set(['img', 'svg']);

const SECTIONS = new Set(['section', 'nav', 'header', 'footer', 'form', 'ul', 'ol', 'table', 'article', 'aside', 'main', 'dl']);
const HEADINGS = new Set(['h1', 'h2', 'h3', 'h4']);

/**
 * The elements of a page that could be an area, in the order of the page:
 * `[{ n, node, from, to, depth, tag, classes, text, parts }]`. `from` and `to` are offsets in
 * the page's text; `depth` says how many other candidates lie around it. An area has to be
 * small enough to be written anew and large enough to be worth it; of a page with more such
 * elements than can be listed, the ones that look most like a part of their own are kept.
 */
export function candidates(page, { min = 500, max = 7000, limit = 60 } = {}) {
  const fragment = parseFragment(page, { sourceCodeLocationInfo: true });
  const all = [];
  const walk = (node) => {
    for (const child of elements(node)) {
      if (child.tagName === 'svg' || child.tagName === 'pre' || child.tagName === 'code' || !child.sourceCodeLocation || HIDDEN(child)) continue;
      const { startOffset: from, endOffset: to } = child.sourceCodeLocation;
      const size = to - from;
      if (size >= min && size <= max && !NOT_AN_AREA.has(child.tagName)) {
        const only = elements(child);
        // A wrapper around one element is that element with another name: the inner one is taken.
        const wrapper = only.length === 1 && only[0].sourceCodeLocation && (only[0].sourceCodeLocation.endOffset - only[0].sourceCodeLocation.startOffset) > size * 0.85 && !NOT_AN_AREA.has(only[0].tagName);
        const text = textOf(child, 600);
        const words = text.split(' ').filter(Boolean).length;
        const parts = { links: count(child, LINKS), buttons: count(child, BUTTONS), fields: count(child, FIELDS), pictures: count(child, PICTURES) };
        if (!wrapper && (words >= 4 || parts.links + parts.buttons + parts.fields >= 2)) {
          const score = Math.min(size, 3000) / 1000 + (SECTIONS.has(child.tagName) ? 2 : 0) + (count(child, HEADINGS) ? 2 : 0) + (words >= 12 ? 1 : 0) + (parts.links + parts.buttons + parts.fields >= 2 ? 1 : 0);
          all.push({ node: child, from, to, tag: child.tagName, classes: (attr(child, 'class') ?? '').trim().split(/\s+/).filter(Boolean).slice(0, 6).join('.'), id: attr(child, 'id') ?? '', text, parts, score });
        }
      }
      if (size >= min) walk(child);
    }
  };
  walk(fragment);
  const chosen = all.length <= limit ? all : [...all].sort((a, b) => b.score - a.score).slice(0, limit).sort((a, b) => a.from - b.from);
  return chosen.map((c, index) => ({ ...c, n: index + 1, depth: chosen.filter((o) => o !== c && o.from <= c.from && o.to >= c.to).length }));
}

/** The candidates as the model reads them: one line each, indented by what lies inside what. */
export function outline(list) {
  return list.map((c) => {
    const parts = Object.entries(c.parts).filter(([, n]) => n).map(([name, n]) => `${n} ${name}`).join(', ');
    const name = `<${c.tag}${c.id ? `#${c.id.slice(0, 30)}` : ''}${c.classes ? `.${c.classes.slice(0, 70)}` : ''}>`;
    return `${'  '.repeat(Math.min(c.depth, 6))}[${c.n}] ${name} ${c.to - c.from} chars${parts ? `, ${parts}` : ''}: "${c.text.slice(0, 110)}"`;
  }).join('\n');
}

// ---------- an element in short, for the model ----------

const KEEP_ATTRIBUTES = new Set(['class', 'role', 'type', 'placeholder', 'value', 'checked', 'disabled', 'selected', 'colspan', 'rowspan', 'alt', 'href', 'open']);
const VOID = new Set(['area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input', 'link', 'meta', 'param', 'source', 'track', 'wbr']);
const EMPTY_SHELLS = new Set(['span', 'div', 'i', 'b', 'em', 'strong', 'p', 'li', 'a']);
const escapeText = (text) => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const escapeAttribute = (text) => text.replace(/&/g, '&amp;').replace(/"/g, '&quot;');

/**
 * An element as the model is given it: `{ html, kept }`. Its pictures and drawings are not
 * written out (they are long, and the model cannot make new ones): each stands as an empty
 * element with data-keep="N", and `kept[N]` is what it was. `restore` puts them back.
 */
export function compact(node) {
  const kept = [];
  const write = (el) => {
    if (el.nodeName === '#text') return escapeText(el.value.replace(/\s+/g, ' '));
    if (!el.tagName) return '';
    if (el.tagName === 'svg' || el.tagName === 'img' || el.tagName === 'picture') {
      kept.push(serializeOuter(el));
      const label = el.tagName === 'img' ? attr(el, 'alt') : attr(el, 'aria-label');
      const classes = attr(el, 'class');
      const tag = el.tagName === 'svg' ? 'svg' : 'img';
      const open = `<${tag} data-keep="${kept.length - 1}"${classes ? ` class="${escapeAttribute(classes)}"` : ''}${label ? ` alt="${escapeAttribute(label.slice(0, 60))}"` : ''}>`;
      return tag === 'svg' ? `${open}</svg>` : open;
    }
    const attributes = el.attrs
      .filter((a) => a.value.trim() !== '' || a.name === 'checked' || a.name === 'disabled' || a.name === 'selected' || a.name === 'open')
      .filter((a) => KEEP_ATTRIBUTES.has(a.name) || a.name.startsWith('aria-') || (a.name.startsWith('data-') && a.value.length <= 40) || (a.name === 'style' && a.value.length <= 240))
      .map((a) => ` ${a.name}="${escapeAttribute(a.value)}"`).join('');
    const open = `<${el.tagName}${attributes}>`;
    if (VOID.has(el.tagName)) return open;
    const inside = (el.childNodes ?? []).map(write).join('');
    // Empty shells (the cells of a counter that a script fills, spacers without a class) say
    // nothing, and a row of them makes the model lose its thread.
    if (!inside.trim() && !attributes && EMPTY_SHELLS.has(el.tagName)) return '';
    return `${open}${inside}</${el.tagName}>`;
  };
  return { html: write(node).replace(/>\s+</g, '><').trim(), kept };
}

function serializeOuter(node) {
  return serialize({ nodeName: '#document-fragment', childNodes: [node] });
}

/** Puts the pictures and drawings back that an answer names by data-keep; one it does not know is left out. */
export function restore(html, kept) {
  return html
    .replace(/<svg\b[^>]*\bdata-keep\s*=\s*["']?(\d+)["']?[^>]*>(?:\s*<\/svg\s*>)?/gi, (whole, n) => kept[Number(n)] ?? '')
    .replace(/<img\b[^>]*\bdata-keep\s*=\s*["']?(\d+)["']?[^>]*>/gi, (whole, n) => kept[Number(n)] ?? '');
}
