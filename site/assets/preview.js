// Shows a storyboard as the interface it describes: the mockup's HTML with the project's own
// stylesheets, in a frame that cannot reach this page.
//
// Three layers keep markup that came from a model, and CSS that came from a repository, where
// they belong: the HTML is parsed and only harmless elements and attributes are kept; the frame
// is sandboxed without an origin of its own; and its Content Security Policy runs two scripts
// only (Tailwind's browser build and the small script below) and loads nothing else.

import { iconOf } from './icons.js';

const TAILWIND = 'https://cdn.jsdelivr.net/npm/@tailwindcss/browser@4.3.5';

// ---------- HTML ----------

const DROP_WITH_CONTENT = new Set(['script', 'style', 'link', 'meta', 'base', 'title', 'iframe', 'frame', 'frameset', 'object', 'embed', 'applet', 'noscript', 'template', 'foreignobject', 'animate', 'animatemotion', 'animatetransform', 'set', 'use', 'image', 'audio', 'video', 'source', 'track', 'canvas', 'portal', 'slot', 'dialog']);
const HTML_TAGS = new Set(('a abbr address article aside b bdi bdo blockquote br button caption cite code col colgroup data dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img input ins kbd label legend li main mark menu meter nav ol optgroup option output p picture pre progress q rp rt ruby s samp search section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr pe-area pe-wait').split(' '));
const SVG_TAGS = new Set(('svg g path circle ellipse rect line polyline polygon text tspan defs lineargradient radialgradient stop clippath mask title desc').split(' '));
const ATTRIBUTES = new Set(('class id style title role tabindex lang dir hidden open type value placeholder checked disabled selected readonly multiple name for rows cols colspan rowspan scope width height alt min max step size maxlength low high optimum inert draggable datetime label '
  + 'viewbox d fill fill-rule fill-opacity clip-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity cx cy r rx ry x y x1 y1 x2 y2 points transform xmlns preserveaspectratio offset stop-color stop-opacity gradientunits gradienttransform font-size text-anchor dominant-baseline').split(' '));

function cleanElement(el) {
  for (const child of [...el.children]) {
    const tag = child.localName.toLowerCase();
    if (DROP_WITH_CONTENT.has(tag)) {
      child.remove();
      continue;
    }
    if (!HTML_TAGS.has(tag) && !SVG_TAGS.has(tag)) {
      // An element this page does not know (a custom element, say): keep what is inside it.
      cleanElement(child);
      child.replaceWith(...child.childNodes);
      continue;
    }
    // Markup that was copied from JSX after all.
    if (child.hasAttribute('classname') && !child.hasAttribute('class')) child.setAttribute('class', child.getAttribute('classname'));
    for (const attribute of [...child.attributes]) {
      const name = attribute.name.toLowerCase();
      const known = ATTRIBUTES.has(name) || name.startsWith('aria-') || (name.startsWith('data-') && !name.startsWith('data-pe'));
      if (!known || name.startsWith('on')) {
        child.removeAttribute(attribute.name);
        continue;
      }
      // Nothing is fetched from a style attribute either.
      if (name === 'style' && /url\s*\(|expression\s*\(|@import|\\/i.test(attribute.value)) child.removeAttribute(attribute.name);
    }
    if (tag === 'img') {
      // A picture cannot be loaded from the repository: an empty box of the same size stands in.
      const box = document.createElement('span');
      for (const name of ['class', 'style', 'width', 'height']) if (child.hasAttribute(name)) box.setAttribute(name, child.getAttribute(name));
      box.setAttribute('data-picture', '');
      child.replaceWith(box);
      continue;
    }
    cleanElement(child);
  }
  for (const node of [...el.childNodes]) if (node.nodeType === Node.COMMENT_NODE) node.remove();
}

/** Markup from an analysis as a document, nothing taken out yet. */
export function parseMarkup(html) {
  // A <select> may only hold options: a styled trigger written as one would lose its content
  // when parsed, so it is read as a button.
  const source = html.replace(/<select\b([^>]*)>((?:(?!<\/select)[\s\S])*)<\/select\s*>/gi, (whole, attributes, inner) => (
    /<option\b/i.test(inner) ? whole : `<button type="button"${attributes}>${inner}</button>`
  ));
  return new DOMParser().parseFromString(`<!doctype html><body>${source}`, 'text/html');
}

const NO_ICON = '<rect x="5" y="5" width="14" height="14" rx="4" fill="currentColor" opacity=".3"></rect>';

/** An icon that the markup names instead of drawing: the drawing is put in, or a plain shape while it is not known. */
function drawIcon(svg) {
  const icon = iconOf(svg.getAttribute('data-icon').trim().toLowerCase());
  svg.setAttribute('viewBox', icon ? `0 0 ${icon.width} ${icon.height}` : '0 0 24 24');
  svg.innerHTML = icon ? icon.body : NO_ICON;
  if (icon) cleanElement(svg);
}

/**
 * Markup from an analysis, reduced to what is safe to draw. A <pe-area id> becomes the comment
 * <!--pe-area:id-->, which marks a place without being an element that styles could count.
 */
export function sanitize(html) {
  const doc = parseMarkup(html);
  cleanElement(doc.body);
  for (const svg of doc.body.querySelectorAll('svg[data-icon]')) drawIcon(svg);
  for (const wait of [...doc.body.querySelectorAll('pe-wait')]) {
    // The place of a part that is still being written.
    const box = doc.createElement('div');
    box.setAttribute('data-pe-wait', '');
    wait.replaceWith(box);
  }
  for (const slot of [...doc.body.querySelectorAll('pe-area')]) {
    const id = (slot.getAttribute('id') ?? '').replace(/[^a-z0-9-]/gi, '');
    if (id) slot.replaceWith(doc.createComment(`pe-area:${id}`));
    else slot.remove();
  }
  return doc.body.innerHTML;
}

// ---------- CSS ----------

/** CSS can end its own element and start another; this keeps it inside. */
const inert = (css) => css.replace(/<\/(?=style)/gi, '<\\/').replace(/<!--/g, '');

/** A project's stylesheets, made to work without the project: what would be fetched or run is taken out. */
export function projectCss(texts, tailwind) {
  let css = texts.join('\n\n');
  css = css.replace(/@(plugin|source|config|reference)\b[^;{]*;/g, '');
  css = css.replace(/@import\s+(?:url\()?\s*["']?(?!tailwindcss)(?!https:\/\/fonts\.googleapis\.com)[^;]*;/g, '');
  // A stylesheet that Tailwind 4 could not read is read again without the rules it stumbled on.
  if (tailwind === 'plain') css = css.replace(/@apply\b[^;}]*;?/g, '');
  if (tailwind) {
    // Tailwind 3 names its layers one by one; Tailwind 4, which runs here, wants one import.
    css = css.replace(/@tailwind\s+[a-z]+\s*;/g, '');
    let seen = false;
    css = css.replace(/@import\s+["']tailwindcss["'][^;]*;/g, (match) => {
      if (seen) return '';
      seen = true;
      return match;
    });
    if (!seen) css = `@import "tailwindcss";\n${css}`;
  }
  return css;
}

// ---------- the document ----------

const nonce = () => [...crypto.getRandomValues(new Uint8Array(12))].map((b) => b.toString(16).padStart(2, '0')).join('');

/** Runs inside the frame. It moves options into their places, draws the dots, and reports where things are. */
function bridge() {
  const config = window.__PE__;
  const say = (message) => parent.postMessage({ pe: config.token, ...message }, '*');
  const store = document.getElementById('pe-store');
  const boxes = new Map();
  for (const box of store.children) boxes.set(box.getAttribute('data-pe-option'), box);
  const key = (area, option) => `${area} ${option}`;
  const placed = new Map();
  let areas = config.areas;

  function marker(id) {
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_COMMENT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) {
      if (node.data === `pe-area:${id}` && !store.contains(node)) return node;
    }
    return null;
  }

  function apply(choices) {
    for (const [id, was] of placed) boxes.get(key(id, was.option))?.append(...was.nodes);
    placed.clear();
    // An option may hold the place of another area, so places appear as options are put in.
    let waiting = areas.map((a) => a.id);
    for (let pass = 0; pass < 6 && waiting.length; pass += 1) {
      waiting = waiting.filter((id) => {
        const at = marker(id);
        if (!at) return true;
        const area = areas.find((a) => a.id === id);
        const option = area.options.includes(choices[id]) ? choices[id] : area.options[0];
        const nodes = [...(boxes.get(key(id, option))?.childNodes ?? [])];
        at.after(...nodes);
        placed.set(id, { option, nodes });
        return false;
      });
    }
  }

  function rect(id) {
    const nodes = placed.get(id)?.nodes.filter((n) => n.nodeType === 1 || (n.nodeType === 3 && n.data.trim()));
    if (!nodes?.length) return null;
    let box = null;
    for (const node of nodes) {
      let r;
      if (node.nodeType === 1) r = node.getBoundingClientRect();
      else {
        const range = document.createRange();
        range.selectNodeContents(node);
        r = range.getBoundingClientRect();
      }
      if (!r.width && !r.height) continue;
      box = box
        ? { left: Math.min(box.left, r.left), top: Math.min(box.top, r.top), right: Math.max(box.right, r.right), bottom: Math.max(box.bottom, r.bottom) }
        : { left: r.left, top: r.top, right: r.right, bottom: r.bottom };
    }
    return box;
  }

  // Tailwind gives up on a whole stylesheet when one rule in it names a class it does not know.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = String(event.reason?.message ?? event.reason ?? '');
    if (/utility|tailwind|@apply|theme/i.test(reason)) say({ type: 'styles', reason });
  });

  // Links and forms of a mockup lead nowhere.
  document.addEventListener('click', (event) => {
    if (event.target.closest?.('a, button, input[type=submit], summary')) event.preventDefault();
    say({ type: 'away' });
  }, true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);

  apply(config.choices);

  if (config.focus) {
    // A thumbnail: report where the one area is, until the styles have settled.
    placed.get(config.focus)?.nodes.find((n) => n.nodeType === 1)?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    let last = '';
    let frames = 0;
    const watch = () => {
      const r = rect(config.focus);
      const now = r ? [r.left, r.top, r.right, r.bottom].map(Math.round).join() : '';
      if (now && now !== last) {
        last = now;
        say({ type: 'thumb', rect: r });
      }
      frames += 1;
      if (frames < 240) requestAnimationFrame(watch);
    };
    watch();
    return;
  }

  // The dots and the frame around the open area, above everything, untouched by the page's styles.
  const host = document.createElement('pe-layer');
  host.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;z-index:2147483647;pointer-events:none';
  document.documentElement.append(host);
  const layer = host.attachShadow({ mode: 'closed' });
  layer.innerHTML = `<style>
    button{all:unset;position:fixed;width:20px;height:20px;border-radius:50%;background:#f0509b;box-shadow:0 0 0 5px rgba(240,80,155,.25),0 1px 4px rgba(0,0,0,.4);cursor:pointer;pointer-events:auto;box-sizing:border-box}
    button::after{content:"";position:absolute;inset:0;border-radius:50%;border:1px solid #f0509b;animation:ping 1.8s ease-out infinite}
    button::before{content:"";position:absolute;inset:-10px}
    button.done{background:#151517 url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 20 20'%3E%3Cpath d='M5.8 10.4l2.7 2.7 5.7-6.1' fill='none' stroke='%23f0509b' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'/%3E%3C/svg%3E") center/20px;box-shadow:inset 0 0 0 1.5px #f0509b,0 1px 4px rgba(0,0,0,.4)}
    button.done::after{display:none}
    button.open{box-shadow:0 0 0 6px rgba(240,80,155,.45)}
    button.done.open{box-shadow:inset 0 0 0 1.5px #f0509b,0 0 0 5px rgba(240,80,155,.4)}
    button:focus-visible{outline:2px solid #fff;outline-offset:3px}
    div{position:fixed;border:1.5px solid #f0509b;border-radius:8px;pointer-events:none;display:none}
    @keyframes ping{from{transform:scale(1);opacity:.8}to{transform:scale(2.3);opacity:0}}
    @media (prefers-reduced-motion:reduce){button::after{animation:none}}
  </style><div></div>`;
  const outline = layer.querySelector('div');
  const dots = new Map();
  function syncDots() {
    for (const [id, dot] of dots) {
      if (areas.some((a) => a.id === id)) continue;
      dot.remove();
      dots.delete(id);
    }
    for (const area of areas) {
      if (dots.has(area.id)) continue;
      const dot = document.createElement('button');
      dot.type = 'button';
      dot.setAttribute('aria-label', area.label);
      dot.addEventListener('click', (event) => {
        event.stopPropagation();
        say({ type: 'dot', id: area.id, keyboard: event.detail === 0 });
      });
      layer.append(dot);
      dots.set(area.id, dot);
    }
  }
  syncDots();

  /** The page changed while it is shown (it is still being written): everything is put in anew. */
  function replace(message) {
    const y = window.scrollY;
    placed.clear();
    while (document.body.firstChild && document.body.firstChild !== store) document.body.firstChild.remove();
    const range = document.createRange();
    range.selectNodeContents(document.body);
    store.before(range.createContextualFragment(message.page));
    store.innerHTML = message.store;
    boxes.clear();
    for (const box of store.children) boxes.set(box.getAttribute('data-pe-option'), box);
    areas = message.areas;
    syncDots();
    apply(message.choices);
    window.scrollTo(0, y);
  }

  let view = { open: null, chosen: [] };
  let last = '';
  function draw() {
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    const rects = {};
    for (const area of areas) {
      const r = rect(area.id);
      const dot = dots.get(area.id);
      if (!r) {
        dot.style.display = 'none';
        continue;
      }
      rects[area.id] = r;
      const x = Math.max(4, Math.min(r.right - 10, width - 24));
      const y = Math.max(4, r.top - 10);
      const seen = r.bottom > 0 && r.top < height;
      dot.style.display = seen ? '' : 'none';
      dot.style.left = `${x}px`;
      dot.style.top = `${y}px`;
      dot.className = `${view.chosen.includes(area.id) ? 'done' : ''} ${view.open === area.id ? 'open' : ''}`;
      rects[area.id].dot = { left: x, top: y, right: x + 20, bottom: y + 20 };
    }
    const open = view.open && rects[view.open];
    outline.style.display = open ? 'block' : 'none';
    if (open) {
      outline.style.left = `${open.left - 5}px`;
      outline.style.top = `${open.top - 5}px`;
      outline.style.width = `${open.right - open.left + 10}px`;
      outline.style.height = `${open.bottom - open.top + 10}px`;
    }
    const now = JSON.stringify([rects, width, height]);
    if (now !== last) {
      last = now;
      say({ type: 'layout', rects, width, height });
    }
    requestAnimationFrame(draw);
  }

  window.addEventListener('message', (event) => {
    const message = event.data;
    if (event.source !== parent || !message || message.pe !== config.token) return;
    if (message.type === 'apply') apply(message.choices);
    if (message.type === 'set') replace(message);
    if (message.type === 'view') view = { open: message.open, chosen: message.chosen };
    if (message.type === 'focus') dots.get(message.id)?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') say({ type: 'escape' });
  });
  draw();
  say({ type: 'ready' });
}

const BRIDGE = `(${bridge.toString()})();`;

/** What a frame shows of an analysis: the page, the options kept aside, and the areas they belong to. */
function documentParts(analysis) {
  return {
    page: sanitize(analysis.page),
    store: analysis.areas.flatMap((area) => area.options.map((option) => (
      `<div data-pe-option="${area.id} ${option.id}">${sanitize(option.html)}</div>`
    ))).join(''),
    areas: analysis.areas.map((area) => ({ id: area.id, label: area.label, options: area.options.map((o) => o.id) })),
  };
}

/**
 * The whole document of a frame. `assets` are the project's stylesheets and how to treat them;
 * `choices` says which option stands in each area; `focus` makes it a thumbnail of one area.
 */
export function buildDocument(analysis, assets, { token, choices = {}, focus = null }) {
  const n = nonce();
  const parts = documentParts(analysis);
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${n}' ${TAILWIND}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    'font-src https://fonts.gstatic.com data:',
    'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const sheet = inert(projectCss([...assets.css, analysis.css ?? ''], assets.tailwind));
  // Tailwind is loaded with CORS so that the frame hears of its errors; a script from another
  // origin loaded without it fails silently, and a stylesheet it gave up on would stay unnoticed.
  const styles = assets.tailwind
    ? `<script nonce="${n}" src="${TAILWIND}" crossorigin="anonymous"></script><style type="text/tailwindcss">${sheet}</style>`
    : `<style>${sheet}</style>`;
  const config = { token, focus, choices, areas: parts.areas };
  const root = assets.dark ? ' class="dark" data-theme="dark" style="color-scheme:dark"' : '';
  return `<!doctype html><html lang="en"${root}><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    // A named icon has the size of the text around it unless the project's styles give it one: in
    // a layer of its own, declared first, so that any rule of the project wins over it.
    + '<style>@layer pe-base{svg[data-icon]{width:1em;height:1em}}</style>'
    + `<style>html,body{margin:0}[data-picture]{display:inline-block;background:rgba(128,128,128,.22);min-width:1em;min-height:1em}[data-pe-wait]{display:block;min-height:56px;margin:6px 0;border-radius:8px;background:rgba(128,128,128,.2);animation:pe-wait .9s ease-in-out infinite alternate}@keyframes pe-wait{to{opacity:.35}}svg:not([width]):not([class]):not([style]){width:1em;height:1em}${focus ? 'html{scrollbar-width:none}*{animation:none!important;transition:none!important}' : ''}</style>`
    + styles
    + `</head><body>${parts.page}`
    + `<div id="pe-store" style="display:none!important">${parts.store}</div>`
    + `<script nonce="${n}">window.__PE__=${JSON.stringify(config).replace(/</g, '\\u003c')};${BRIDGE}</script>`
    + '</body></html>';
}

let counter = 0;
const newToken = () => `pe${Date.now().toString(36)}${(counter += 1)}`;

function makeFrame(title) {
  const frame = document.createElement('iframe');
  frame.setAttribute('sandbox', 'allow-scripts');
  frame.setAttribute('title', title);
  frame.setAttribute('referrerpolicy', 'no-referrer');
  return frame;
}

/** The large frame in the middle of the playground. */
const DESKTOP = 1024;

export class Preview {
  constructor(holder, handlers) {
    this.holder = holder;
    this.handlers = handlers;
    this.frame = null;
    this.token = null;
    this.layout = null;
    this.scale = 1;
    this.narrow = false;
    new ResizeObserver(() => this.fit()).observe(holder);
    window.addEventListener('message', (event) => {
      const message = event.data;
      if (!this.frame || event.source !== this.frame.contentWindow || !message || message.pe !== this.token) return;
      if (message.type === 'layout') {
        this.layout = message;
        this.handlers.layout?.();
      } else if (message.type === 'styles') {
        // Once: draw again with the project's stylesheets reduced to what Tailwind can read.
        if (this.loaded && this.loaded.assets.tailwind === true) {
          this.loaded.assets.tailwind = 'plain';
          this.load(this.loaded.analysis, this.loaded.assets, this.loaded.choices, this.loaded.title);
          this.post(this.pending ?? { type: 'view', open: null, chosen: [] });
        }
      } else if (message.type === 'ready') {
        this.ready = true;
        if (this.changed) this.post(this.changed);
        this.changed = null;
        this.post(this.pending ?? { type: 'view', open: null, chosen: [] });
        this.handlers.ready?.();
      } else this.handlers[message.type]?.(message);
    });
  }

  load(analysis, assets, choices, title) {
    this.loaded = { analysis, assets, choices, title };
    this.token = newToken();
    this.layout = null;
    this.pending = null;
    this.ready = false;
    this.changed = null;
    this.drawn = JSON.stringify(documentParts(analysis));
    const frame = makeFrame(title);
    frame.srcdoc = buildDocument(analysis, assets, { token: this.token, choices });
    this.holder.replaceChildren(frame);
    this.frame = frame;
    this.fit();
  }

  /** The analysis that is shown has grown (it is still being written): the frame takes it in without loading again. */
  update(analysis, choices) {
    if (!this.frame || !this.loaded) return;
    this.loaded.analysis = analysis;
    this.loaded.choices = choices;
    const parts = documentParts(analysis);
    const drawn = JSON.stringify(parts);
    if (drawn === this.drawn) return;
    this.drawn = drawn;
    const message = { type: 'set', ...parts, choices };
    if (this.ready) this.post(message);
    else this.changed = message;
  }

  /**
   * A desktop page is laid out at a desktop's width and shown smaller when the frame is
   * narrower, so that it looks as it does in the product instead of in its tablet layout.
   */
  fit() {
    if (!this.frame) return;
    const width = this.holder.clientWidth;
    const height = this.holder.clientHeight;
    if (!width || !height) return;
    this.width = this.narrow ? width : Math.max(width, DESKTOP);
    this.scale = width / this.width;
    this.frame.style.width = `${this.width}px`;
    this.frame.style.height = `${height / this.scale}px`;
    this.frame.style.transform = this.scale === 1 ? '' : `scale(${this.scale})`;
    this.handlers.layout?.();
  }

  /** `true` for a phone: the page is as wide as the frame, however narrow that is. */
  setNarrow(narrow) {
    this.narrow = narrow;
    this.fit();
  }

  post(message) {
    this.frame?.contentWindow?.postMessage({ pe: this.token, ...message }, '*');
  }

  apply(choices) {
    this.post({ type: 'apply', choices });
  }

  view(open, chosen) {
    this.pending = { type: 'view', open, chosen };
    this.post(this.pending);
  }

  focusDot(id) {
    this.frame?.focus();
    this.post({ type: 'focus', id });
  }

  /** The half of the page an area lies in, 'left' or 'right'; null when it spans the middle or is not known yet. */
  half(id) {
    const rect = this.layout?.rects?.[id];
    if (!rect || !this.layout.width) return null;
    const middle = (rect.left + rect.right) / 2 / this.layout.width;
    return middle < 0.42 ? 'left' : middle > 0.58 ? 'right' : null;
  }
}

/**
 * One option, drawn small: the whole page with that option in place, moved and scaled so that
 * the area fills the box. `onFit` is called when the box has changed its height. Returns a
 * function that removes it.
 */
export function mountThumb(box, analysis, assets, areaId, choices, width, onFit) {
  const token = newToken();
  const frame = makeFrame('');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:absolute;left:0;top:0;border:0;width:${width}px;height:900px;transform-origin:0 0;pointer-events:none;visibility:hidden`;
  frame.srcdoc = buildDocument(analysis, assets, { token, choices, focus: areaId });
  let lastRect = null;
  const listen = (event) => {
    const message = event.data;
    if (event.source !== frame.contentWindow || !message || message.pe !== token || message.type !== 'thumb') return;
    lastRect = message.rect;
    fit(lastRect);
  };
  const fit = (rect) => {
    const pad = 6;
    const r = { left: rect.left - pad, top: rect.top - pad, right: rect.right + pad, bottom: rect.bottom + pad };
    const w = r.right - r.left;
    const h = r.bottom - r.top;
    // The area is shown as wide as the box. The box takes its height, up to a limit: of a tall
    // area the top is shown, large enough to be read, instead of all of it, too small to.
    const scale = Math.min(box.clientWidth / w, 1);
    const tall = Math.max(44, Math.min(h * scale, 150, box.clientWidth * 0.7));
    box.style.height = `${Math.round(tall)}px`;
    const needed = Math.ceil(Math.max(900, r.top + tall / scale + 20));
    if (needed > frame.offsetHeight && needed < 9000) frame.style.height = `${needed}px`;
    const x = (box.clientWidth - w * scale) / 2 - r.left * scale;
    const y = (h * scale < tall ? (tall - h * scale) / 2 : 0) - r.top * scale;
    frame.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    frame.style.visibility = '';
    onFit?.();
  };
  window.addEventListener('message', listen);
  box.prepend(frame);
  // The box changes width when the options stand in a column: the picture is fitted again.
  let boxWidth = box.clientWidth;
  const watcher = new ResizeObserver(() => {
    if (box.clientWidth === boxWidth || !lastRect) return;
    boxWidth = box.clientWidth;
    fit(lastRect);
  });
  watcher.observe(box);
  return () => {
    watcher.disconnect();
    window.removeEventListener('message', listen);
    frame.remove();
  };
}
