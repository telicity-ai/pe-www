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
const HTML_TAGS = new Set(('a abbr address article aside b bdi bdo blockquote br button caption cite code col colgroup data dd del details dfn div dl dt em fieldset figcaption figure footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img input ins kbd label legend li main mark menu meter nav ol optgroup option output p picture pre progress q rp rt ruby s samp search section select small span strong sub summary sup table tbody td textarea tfoot th thead time tr u ul var wbr pe-area').split(' '));
const SVG_TAGS = new Set(('svg g path circle ellipse rect line polyline polygon text tspan defs lineargradient radialgradient stop clippath mask title desc').split(' '));
const ATTRIBUTES = new Set(('class id style title role tabindex lang dir hidden open type value placeholder checked disabled selected readonly multiple name for rows cols colspan rowspan scope width height alt min max step size maxlength low high optimum inert draggable datetime label '
  + 'viewbox d fill fill-rule fill-opacity clip-rule stroke stroke-width stroke-linecap stroke-linejoin stroke-dasharray stroke-dashoffset stroke-opacity opacity cx cy r rx ry x y x1 y1 x2 y2 points transform xmlns preserveaspectratio offset stop-color stop-opacity gradientunits gradienttransform font-size text-anchor dominant-baseline').split(' '));

// A live page's pictures are its own and are shown; a repository's cannot be loaded.
let pictures = false;

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
      // Generated JSX booleans can arrive as strings. Any disabled attribute, even
      // disabled="false", disables a native control or every control in a fieldset.
      if (name === 'disabled' && attribute.value === 'false' && child.matches('button, fieldset, input, select, textarea, option, optgroup')) {
        child.removeAttribute(name);
      }
      // Nothing is fetched from a style attribute either.
      if (name === 'style' && /url\s*\(|expression\s*\(|@import|\\/i.test(attribute.value)) child.removeAttribute(attribute.name);
    }
    if (tag === 'img' && pictures && /^https:\/\//i.test(child.getAttribute('data-src') ?? '')) {
      child.setAttribute('src', child.getAttribute('data-src'));
      child.removeAttribute('data-src');
      child.setAttribute('referrerpolicy', 'no-referrer');
      child.setAttribute('loading', 'lazy');
      continue;
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

const classes = (el) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
const has = (list, pattern) => list.some((c) => pattern.test(c.replace(/^(?:[a-z0-9-]+:)*!?/, '')));
const PADDING = /^-?(?:p|px|ps|pl)-/;
const TEXT_SIZE = /^text-(?:xs|sm|base|lg|[2-9]?xl|\[\d)/;
const OWN_PLACE = /^(?:m|mx|ml|mr|ms|me)-|^self-|^justify-self-|^place-self-|^absolute$|^fixed$/;
const ALIGNED = /^(?:items|place-items|justify-items)-/;

function restoreSectionGrids(root, templates) {
  if (!templates?.length) return;
  for (const section of root.querySelectorAll('section.grid')) {
    const [heading, first, ...rest] = section.children;
    if (!first || (!rest.length && first.localName !== 'pe-area')) continue;
    const template = templates.find((t) => t.heading === heading.localName
      && t.classes.length === section.classList.length && t.classes.every((c) => section.classList.contains(c)));
    if (!template) continue;
    // An alternative can deliberately give individual children their own grid positions.
    if ([first, ...rest].some((el) => el.matches('h1,h2,h3,h4,h5,h6') || el.style.gridColumn || el.style.gridRow
        || has(classes(el), /^(?:col|row)-(?:span|start|end|auto|\[)/))) continue;
    if (first.localName === 'div' && first.className === template.bodyClass) {
      while (first.nextSibling) first.append(first.nextSibling);
    } else {
      const body = root.ownerDocument.createElement('div');
      body.className = template.bodyClass;
      while (heading.nextSibling) body.append(heading.nextSibling);
      section.append(body);
    }
  }
}

/**
 * What a model tends to drop when it copies markup: a button's size classes (it then touches its
 * own border), and the margin that centers a column of limited width.
 */
function repair(root, decision) {
  const sidebar = 'aside, nav, [data-slot="sidebar"], [data-slot="sidebar-container"], [data-sidebar="sidebar"]';
  const hasContent = (el) => el.textContent.trim() || el.querySelector('pe-area, svg, input, button, a, [data-picture]');
  // A fixed sidebar has a separate spacer in the page flow. Keep both when it has
  // content, including an area whose selected option is still stored elsewhere.
  for (const gap of root.querySelectorAll('[data-slot="sidebar-gap"]')) {
    const next = gap.nextElementSibling;
    if (hasContent(gap) || next?.matches('pe-area')) continue;
    const panel = gap.closest('[data-slot="sidebar"]') ?? (next?.matches(sidebar) ? next
      : [...gap.parentElement.children].find((el) => el.matches(sidebar) && hasContent(el)));
    if (!panel || !hasContent(panel)) gap.remove();
  }
  for (const el of root.querySelectorAll(sidebar)) {
    if (!hasContent(el)) el.remove();
  }
  if (decision === 'nothing-to-show' && root.childElementCount === 1) {
    // A full-height empty state sometimes loses the wrapper that centers its single
    // heading-and-actions group. The outer flex column can supply that alignment.
    const pane = root.firstElementChild;
    if (pane.matches('.flex.flex-col.flex-1') && pane.childElementCount === 1
        && pane.firstElementChild.matches('.flex.flex-col.items-center.text-center')
        && !has(classes(pane), /^(?:justify-|place-content-)/) && !pane.style.justifyContent && !pane.style.placeContent) {
      pane.classList.add('justify-center');
    }
  }
  for (const el of root.querySelectorAll('button, [data-slot="button"], [role="button"]')) {
    const list = classes(el);
    const styled = has(list, /^(?:border|bg-|rounded|shadow)/);
    const square = has(list, /^(?:size-|w-|aspect-|rounded-full$)/);
    if (!styled || square || !el.textContent.trim()) continue;
    // A single-line action with a fixed height has no room for a second line.
    if (el.matches('button[data-slot="button"].inline-flex') && list.some((c) => /^h-\d+(?:\.\d+)?$/.test(c))
        && !el.style.whiteSpace && !has(list, /^(?:whitespace-|text-(?:wrap|balance|pretty)|break-|h-(?:auto|fit)|truncate$)/)
        && !el.querySelector('br') && [...el.children].every((child) => child.localName === 'svg')) {
      list.push('whitespace-nowrap');
    }
    if (!has(list, PADDING)) list.push('px-3');
    if (!has(list, TEXT_SIZE)) list.push('text-sm');
    if (!has(list, /^font-(?:thin|light|normal|medium|semibold|bold|extrabold|black)$/)) list.push('font-medium');
    el.setAttribute('class', list.join(' '));
  }
  const slots = root.querySelectorAll('pe-area').length;
  // The pane that holds the whole screen, set in a row without what makes it grow (a sidebar
  // inset's flex-1), would shrink to its content and leave the page standing on the left.
  for (const el of slots ? root.querySelectorAll('div, main, section, article') : []) {
    const parent = el.parentElement;
    if (!parent || el.querySelectorAll('pe-area').length !== slots) continue;
    const around = classes(parent);
    if (!has(around, /^flex$/) || has(around, /^flex-col/)) continue;
    const list = classes(el);
    if (has(list, /^(?:flex-1|flex-auto|grow|basis-|w-|absolute$|fixed$)/)) continue;
    el.setAttribute('class', [...list, 'flex-1', 'min-w-0'].join(' '));
  }
  for (const el of root.querySelectorAll('[class*="max-w-"]')) {
    const list = classes(el);
    const parent = el.parentElement;
    if (!parent || !has(list, /^max-w-(?!none|full|max|fit|min)/) || has(list, OWN_PLACE)) continue;
    const around = classes(parent);
    const row = has(around, /^(?:inline-)?flex$/) && !has(around, /^flex-col/);
    if (row || has(around, /^(?:inline-)?grid$/) || has(around, ALIGNED)) continue;
    const inside = [el, el.firstElementChild].filter(Boolean).flatMap(classes);
    // A narrow column that holds the whole screen is the page's container: those are centered.
    const holdsAll = slots > 0 && el.querySelectorAll('pe-area').length === slots;
    if (holdsAll || has(inside, /^(?:items-center|text-center)$/)) el.setAttribute('class', [...list, 'mx-auto'].join(' '));
  }
}

/**
 * Markup from an analysis, reduced to what is safe to draw. A <pe-area id> becomes the comment
 * <!--pe-area:id-->, which marks a place without being an element that styles could count.
 */
export function sanitize(html, decision, slots, sectionGrids, site = false) {
  // The address of a picture is not among the attributes that stay: it is set aside until the element is known to be kept.
  const doc = parseMarkup(site ? html.replace(/<img\b([^>]*?)\ssrc\s*=\s*(["'])(https:\/\/[^"']*)\2/gi, '<img$1 data-src=$2$3$2') : html);
  pictures = site;
  try {
    cleanElement(doc.body);
  } finally {
    pictures = false;
  }
  for (const svg of doc.body.querySelectorAll('svg[data-icon]')) drawIcon(svg);
  // What follows mends markup that a model wrote from source code; a live page is as its site made it.
  if (!site) {
    restoreSectionGrids(doc.body, sectionGrids);
    repair(doc.body, decision);
  }
  for (const slot of [...doc.body.querySelectorAll('pe-area')]) {
    const id = (slot.getAttribute('id') ?? '').replace(/[^a-z0-9-]/gi, '');
    if (!id) {
      slot.remove();
      continue;
    }
    if (doc.body.contains(slot)) slots?.push(id);
    slot.replaceWith(doc.createComment(`pe-area:${id}`));
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
  css = css.replace(/@import\b[^;]*;/g, (rule) => (/^@import\s+(url\(\s*)?["']?(tailwindcss|https:\/\/fonts\.googleapis\.com\/)/.test(rule) ? rule : ''));
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

// Each 20px dot also has 10px of clickable padding on every side.
export function placeDot(left, top, width, height, occupied) {
  const diameter = 20;
  const spacing = diameter + 20;
  const clamp = (value, extent) => Math.max(4, Math.min(value, extent - diameter - 4));
  const x = clamp(left, width);
  const y = clamp(top, height);
  const free = (a, b) => occupied.every((dot) => Math.abs(dot.left - a) >= spacing || Math.abs(dot.top - b) >= spacing);
  let best = { left: x, top: y };
  if (!free(x, y)) {
    // The nearest free spot lies along an edge of one or more occupied hit targets.
    const xs = [x, ...occupied.flatMap((dot) => [dot.left - spacing, dot.left + spacing])];
    const ys = [y, ...occupied.flatMap((dot) => [dot.top - spacing, dot.top + spacing])];
    let nearest = Infinity;
    for (const b of ys) {
      if (b !== clamp(b, height)) continue;
      for (const a of xs) {
        if (a !== clamp(a, width)) continue;
        const distance = (a - x) ** 2 + (b - y) ** 2;
        if (distance < nearest && free(a, b)) {
          best = { left: a, top: b };
          nearest = distance;
        }
      }
    }
  }
  return { ...best, right: best.left + diameter, bottom: best.top + diameter };
}

// Follow the slots in the chosen version of each area, inserting parents before their children.
// The frame and its surrounding controls use the same result, including for untouched areas.
function resolveOptions(layout, choices) {
  const placed = new Map();
  function visit(id) {
    if (placed.has(id)) return;
    const area = layout.areas.find((entry) => entry.id === id);
    if (!area?.options.length) return;
    const option = area.options.find((entry) => entry.id === choices[id]) ?? area.options[0];
    placed.set(id, option.id);
    option.slots.forEach(visit);
  }
  layout.roots.forEach(visit);
  return placed;
}

/** Runs inside the frame. It moves options into their places, draws the dots, and reports where things are. */
function bridge(placeDot, resolveOptions) {
  const config = window.__PE__;
  const say = (message) => parent.postMessage({ pe: config.token, ...message }, '*');
  const store = document.getElementById('pe-store');
  const boxes = new Map();
  for (const box of store.children) boxes.set(box.getAttribute('data-pe-option'), box);
  const key = (area, option) => `${area} ${option}`;
  const placed = new Map();
  let layout = config.layout;

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
    for (const [id, option] of resolveOptions(layout, choices)) {
      const at = marker(id);
      if (!at) continue;
      const nodes = [...boxes.get(key(id, option)).childNodes];
      at.after(...nodes);
      placed.set(id, { option, nodes });
    }
    if (config.site) reveal();
  }

  /**
   * A live page is shown without its scripts, and many pages keep parts of themselves
   * transparent until a script lets them fade in: a headline word by word, a section as it is
   * scrolled to. Such parts are made visible. What is transparent for another reason (a menu,
   * a tooltip, something that lies over the page) stays so.
   */
  function reveal() {
    const over = (el) => {
      for (let node = el; node && node !== document.body; node = node.parentElement) {
        const position = getComputedStyle(node).position;
        if (position === 'absolute' || position === 'fixed') return true;
      }
      return false;
    };
    // Transparent by its own style attribute, or by the mark of a library that fades things in:
    // that is how a part waits for a script. What a class hides (the other state of a control, a
    // layer for another theme) is meant to stay hidden.
    for (const el of document.body.querySelectorAll('[style*="opacity"]:not([data-pe-shown]), [data-aos]:not([data-pe-shown]), [data-sal]:not([data-pe-shown])')) {
      if (store.contains(el) || el.closest('[role=menu], [role=dialog], [role=tooltip], [role=listbox]')) continue;
      if (getComputedStyle(el).opacity === '0' && !over(el)) el.setAttribute('data-pe-shown', '');
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

  // ----- a mockup that answers: menus open and close, an item picked in one becomes its value,
  // a pressed button or a tab takes the place of its neighbours -----
  const POPUP = '[role="listbox"], [role="menu"], [data-pe-popup]';
  const ITEM = '[role="option"], [role="menuitem"], [role="menuitemradio"], [role="menuitemcheckbox"]';
  const TRIGGER = '[aria-haspopup], [aria-expanded], [role="combobox"]';
  const ON = ['aria-selected', 'aria-checked', 'aria-pressed', 'aria-current', 'data-selected', 'data-state', 'data-active'];
  const classesOf = (el) => (el.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
  const shown = (el) => getComputedStyle(el).display !== 'none' && el.getClientRects().length > 0;
  const setShown = (el, on) => {
    if (on) {
      el.classList.remove('hidden', 'invisible', 'opacity-0');
      el.removeAttribute('hidden');
      el.style.display = shown(el) ? '' : 'block';
    } else el.style.display = 'none';
  };
  const isOn = (el) => ON.some((name) => /^(?:true|on|active|checked|open|page|step|location)$/.test(el.getAttribute(name) ?? '') || (name === 'data-selected' && el.getAttribute(name) === ''));
  // The look of being chosen moves with the choice: the classes one has and the other has not trade places.
  function choose(item, among) {
    const was = among.find((el) => el !== item && isOn(el));
    if (was) {
      const a = classesOf(was);
      const b = classesOf(item);
      const onlyWas = a.filter((c) => !b.includes(c));
      const onlyItem = b.filter((c) => !a.includes(c));
      was.setAttribute('class', [...a.filter((c) => !onlyWas.includes(c)), ...onlyItem].join(' '));
      item.setAttribute('class', [...b.filter((c) => !onlyItem.includes(c)), ...onlyWas].join(' '));
    }
    for (const el of among) {
      for (const name of ON) {
        if (!el.hasAttribute(name)) continue;
        const value = el.getAttribute(name);
        const yes = el === item;
        if (name === 'data-state') {
          if (/^(?:active|inactive)$/.test(value)) el.setAttribute(name, yes ? 'active' : 'inactive');
          else if (/^(?:checked|unchecked)$/.test(value)) el.setAttribute(name, yes ? 'checked' : 'unchecked');
          else if (/^(?:on|off)$/.test(value)) el.setAttribute(name, yes ? 'on' : 'off');
        } else if (name === 'data-selected') {
          if (yes) el.setAttribute(name, value === '' ? '' : 'true');
          else el.removeAttribute(name);
        } else if (name === 'aria-current') {
          if (yes) el.setAttribute(name, value === 'false' ? 'true' : value);
          else el.removeAttribute(name);
        } else el.setAttribute(name, String(yes));
      }
      if (el === item && !ON.some((name) => el.hasAttribute(name))) el.setAttribute('aria-selected', 'true');
    }
    return was;
  }
  function popupOf(trigger) {
    const id = trigger.getAttribute('aria-controls');
    if (id && document.getElementById(id)) return document.getElementById(id);
    if (trigger.matches(POPUP)) return null;
    let at = trigger;
    for (let up = 0; up < 3 && at && at !== document.body; up += 1, at = at.parentElement) {
      for (let next = at.nextElementSibling; next; next = next.nextElementSibling) {
        const hit = next.matches(POPUP) ? next : next.querySelector(POPUP);
        if (hit) return hit;
      }
    }
    return null;
  }
  const triggerOf = (popup) => [...document.querySelectorAll(TRIGGER)].find((t) => popupOf(t) === popup) ?? null;
  const textNodes = (el) => {
    const found = [];
    const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    for (let node = walker.nextNode(); node; node = walker.nextNode()) if (node.data.trim()) found.push(node);
    return found;
  };
  function interact(target) {
    if (!(target instanceof Element) || store.contains(target)) return;
    const item = target.closest(ITEM) ?? target.closest(`${POPUP} li, ${POPUP} button`);
    const popup = item?.closest(POPUP);
    if (item && popup) {
      const among = [...popup.querySelectorAll(ITEM)];
      const was = choose(item, among.length ? among : [...popup.querySelectorAll('li, button')]);
      const trigger = triggerOf(popup);
      // The trigger shows the value: the words of the item that was chosen become those of this one.
      if (trigger) {
        const before = (was?.textContent ?? '').trim();
        const label = textNodes(trigger).find((node) => before && node.data.trim() === before);
        if (label) label.data = label.data.replace(before, item.textContent.trim());
        trigger.setAttribute('aria-expanded', 'false');
      }
      setShown(popup, false);
      return;
    }
    const trigger = target.closest(TRIGGER);
    const menu = trigger && popupOf(trigger);
    if (menu) {
      const open = !shown(menu);
      setShown(menu, open);
      trigger.setAttribute('aria-expanded', String(open));
      return;
    }
    // A click elsewhere closes what is open.
    for (const open of document.querySelectorAll(POPUP)) {
      if (store.contains(open) || open.contains(target) || !shown(open)) continue;
      const owner = triggerOf(open);
      if (!owner) continue;
      setShown(open, false);
      owner.setAttribute('aria-expanded', 'false');
    }
    const control = target.closest('[aria-pressed], [role="tab"], [role="radio"], [role="switch"], [aria-selected], [data-state], [data-selected]');
    if (!control || control.matches('input, select, textarea') || !control.parentElement) return;
    if (control.getAttribute('role') === 'switch' || (control.hasAttribute('aria-pressed') && ![...control.parentElement.children].some((el) => el !== control && el.hasAttribute('aria-pressed')))) {
      const on = !isOn(control);
      for (const name of ['aria-checked', 'aria-pressed']) if (control.hasAttribute(name)) control.setAttribute(name, String(on));
      if (/^(?:checked|unchecked|on|off)$/.test(control.getAttribute('data-state') ?? '')) control.setAttribute('data-state', on ? (/check/.test(control.getAttribute('data-state')) ? 'checked' : 'on') : (/check/.test(control.getAttribute('data-state')) ? 'unchecked' : 'off'));
      return;
    }
    const siblings = [...control.parentElement.children].filter((el) => ON.some((name) => el.hasAttribute(name)));
    if (siblings.length > 1) choose(control, siblings);
  }

  // Tailwind gives up on a whole stylesheet when one rule in it names a class it does not know.
  window.addEventListener('unhandledrejection', (event) => {
    const reason = String(event.reason?.message ?? event.reason ?? '');
    if (/utility|tailwind|@apply|theme/i.test(reason)) say({ type: 'styles', reason });
  });

  // Links and forms of a mockup lead nowhere, but its controls answer (see `interact`).
  document.addEventListener('click', (event) => {
    if (event.target.localName === 'pe-layer') return;
    if (event.target.closest?.('a, button, input[type=submit]')) event.preventDefault();
    if (!config.focus) interact(event.target);
    say({ type: 'away' });
  }, true);
  document.addEventListener('submit', (event) => event.preventDefault(), true);

  apply(config.choices);

  if (config.focus) {
    // A thumbnail: report where the one area is, scrolled into sight, until the styles have
    // settled. Timers, not frames: a frame that is not shown yet gets few of them.
    // Preserve the area's layout and backdrop, but keep adjacent messages or
    // controls out of the padding around a short option in a taller card.
    const nodes = placed.get(config.focus)?.nodes ?? [];
    let branch = nodes.filter((n) => n.nodeType === 1);
    while (branch.length && branch[0].parentElement && branch[0].parentElement !== document.documentElement) {
      const parent = branch[0].parentElement;
      for (const sibling of parent.children) {
        if (!branch.includes(sibling)) sibling.style.setProperty('visibility', 'hidden', 'important');
      }
      branch = [parent];
    }
    const first = () => nodes.find((n) => n.nodeType === 1);
    const started = Date.now();
    let changed = started;
    let last = '';
    const watch = () => {
      let r = rect(config.focus);
      if (r && (r.top < 0 || r.top > innerHeight - 40)) {
        first()?.scrollIntoView({ block: 'start', inline: 'nearest' });
        r = rect(config.focus);
      }
      const now = r ? [r.left, r.top, r.right, r.bottom].map(Math.round).join() : '';
      if (now && now !== last) {
        last = now;
        changed = Date.now();
        say({ type: 'thumb', rect: r });
      }
      if (Date.now() - started < 20000 && Date.now() - changed < 5000) setTimeout(watch, 60);
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
    const { areas } = layout;
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
      dot.title = area.label;
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
    layout = message.layout;
    syncDots();
    apply(message.choices);
    window.scrollTo(0, y);
  }

  let view = { open: null, chosen: [] };
  let last = '';
  // Where the open area was when it was opened, in the coordinates of the document. Trying an
  // option changes the area's size; its dot, and the options that stand by it outside this
  // frame, must not follow, or they slip away from under the pointer that is trying the option.
  let held = null;
  let size = '';
  let previous = {};
  function draw() {
    const { areas } = layout;
    const width = document.documentElement.clientWidth;
    const height = document.documentElement.clientHeight;
    if (size !== `${width} ${height}`) {
      // The page is laid out anew at another size: where things were no longer says where they are.
      size = `${width} ${height}`;
      held = null;
      previous = {};
    }
    const rects = {};
    const occupied = [];
    let live = null;
    // Reserve the open dot's position first so previewing an option cannot move its popup.
    const current = areas.find((area) => area.id === view.open);
    const ordered = current ? [current, ...areas.filter((area) => area !== current)] : areas;
    for (const area of ordered) {
      let r = rect(area.id);
      const dot = dots.get(area.id);
      if (!r) {
        dot.style.display = 'none';
        continue;
      }
      if (area.id === view.open) {
        live = r;
        if (held?.id !== area.id) {
          const prior = previous[area.id];
          held = {
            id: area.id,
            left: r.left + window.scrollX, top: r.top + window.scrollY,
            right: r.right + window.scrollX, bottom: r.bottom + window.scrollY,
            dx: prior?.dot ? prior.dot.left - prior.right : -10,
            dy: prior?.dot ? prior.dot.top - prior.top : -10,
          };
        }
        r = { left: held.left - window.scrollX, top: held.top - window.scrollY, right: held.right - window.scrollX, bottom: held.bottom - window.scrollY };
      }
      rects[area.id] = r;
      const seen = r.bottom > 0 && r.top < height && r.right > 0 && r.left < width;
      dot.style.display = seen ? '' : 'none';
      if (!seen) continue;
      const locked = area.id === view.open;
      r.dot = placeDot(r.right + (locked ? held.dx : -10), r.top + (locked ? held.dy : -10), width, height, occupied);
      occupied.push(r.dot);
      dot.style.left = `${r.dot.left}px`;
      dot.style.top = `${r.dot.top}px`;
      dot.className = `${view.chosen.includes(area.id) ? 'done' : ''} ${view.open === area.id ? 'open' : ''}`;
    }
    previous = rects;
    // The frame around the open area follows the area as it is, also while an option is tried.
    const open = live;
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
    if (message.type === 'view') {
      if (message.open !== view.open) held = null;
      view = { open: message.open, chosen: message.chosen };
    }
    if (message.type === 'focus') dots.get(message.id)?.focus();
  });
  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') say({ type: 'escape' });
  });
  // A pane that scrolls in the product is often drawn without what bounds it, inside a shell that
  // clips (h-screen overflow-hidden): what lies below the fold would be out of reach. A large
  // box that hides content below it scrolls instead.
  function unclip() {
    for (const el of document.body.querySelectorAll('*')) {
      if (el.clientHeight < 120 || el.scrollHeight <= el.clientHeight + 8 || el.closest('#pe-store')) continue;
      const style = getComputedStyle(el);
      if (style.overflowY === 'hidden' || style.overflowY === 'clip') el.style.setProperty('overflow-y', 'auto', 'important');
    }
  }
  setInterval(unclip, 400);
  draw();
  say({ type: 'ready' });
}

const BRIDGE = `(${bridge.toString()})(${placeDot.toString()},${resolveOptions.toString()});`;
const layouts = new WeakMap();

/** What a frame shows of an analysis: the page, the options kept aside, and the areas they belong to. */
function documentParts(analysis, sectionGrids) {
  const roots = [];
  const page = sanitize(analysis.page, null, roots, sectionGrids, analysis.site);
  const store = [];
  const areas = analysis.areas.map((area) => {
    const options = area.options.map((option) => {
      const slots = [];
      const html = sanitize(option.html, option.keep ? area.decision : null, slots, sectionGrids, analysis.site);
      store.push(`<div data-pe-option="${area.id} ${option.id}">${html}</div>`);
      return { id: option.id, slots };
    });
    return { id: area.id, label: area.label, options };
  });
  const layout = { roots, areas };
  layouts.set(analysis, layout);
  return { page, store: store.join(''), layout };
}

export function activeAreas(analysis, choices) {
  if (!analysis.areas.length) return [];
  const layout = layouts.get(analysis) ?? documentParts(analysis).layout;
  const active = resolveOptions(layout, choices);
  return analysis.areas.filter((area) => active.has(area.id));
}

/**
 * The whole document of a frame. `assets` are the project's stylesheets and how to treat them;
 * `choices` says which option stands in each area; `focus` makes it a thumbnail of one area.
 */
export function buildDocument(analysis, assets, { token, choices = {}, focus = null, parts = documentParts(analysis, assets.sectionGrids) }) {
  const n = nonce();
  const csp = [
    "default-src 'none'",
    `script-src 'nonce-${n}' ${TAILWIND}`,
    "style-src 'unsafe-inline' https://fonts.googleapis.com",
    // A live page is shown with its own fonts and pictures, fetched from where the page has them.
    assets.site ? 'font-src https: data:' : 'font-src https://fonts.gstatic.com data:',
    assets.site ? 'img-src https: data:' : 'img-src data:',
    "base-uri 'none'",
    "form-action 'none'",
  ].join('; ');
  const sheet = inert(projectCss([...assets.css, analysis.css ?? ''], assets.tailwind));
  // Tailwind is loaded with CORS so that the frame hears of its errors; a script from another
  // origin loaded without it fails silently, and a stylesheet it gave up on would stay unnoticed.
  const styles = assets.tailwind
    ? `<script nonce="${n}" src="${TAILWIND}" crossorigin="anonymous"></script><style type="text/tailwindcss">${sheet}</style>`
    : `<style>${sheet}</style>`;
  const config = { token, focus, choices, layout: parts.layout, site: Boolean(assets.site) };
  // A project with a dark variant is shown dark unless light was asked for.
  const root = assets.dark && assets.scheme !== 'light' ? ' class="dark" data-theme="dark" style="color-scheme:dark"' : '';
  const carried = (attributes) => Object.entries(attributes ?? {})
    .filter(([name]) => /^(class|lang|dir|data-[a-z0-9-]+)$/.test(name))
    .map(([name, value]) => ` ${name}="${String(value).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;')}"`).join('');
  if (assets.site) {
    return `<!doctype html><html${carried(assets.site.html)}><head><meta charset="utf-8">`
      + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
      + '<meta name="viewport" content="width=device-width, initial-scale=1">'
      + '<meta name="referrer" content="no-referrer">'
      + '<style>@layer pe-base{svg[data-icon]{width:1em;height:1em}}</style>'
      + `<style>${sheet}</style>`
      // After the page's own styles: the page scrolls as a whole, whatever they say.
      + `<style>html{overflow:auto!important}body{overflow:visible!important}[data-pe-shown]{opacity:1!important;transform:none!important;filter:none!important}${focus ? 'html{scrollbar-width:none}*{animation:none!important;transition:none!important}' : ''}</style>`
      + `</head><body${carried(assets.site.body)}>${parts.page}`
      + `<div id="pe-store" style="display:none!important">${parts.store}</div>`
      + `<script nonce="${n}">window.__PE__=${JSON.stringify(config).replace(/</g, '\\u003c')};${BRIDGE}</script>`
      + '</body></html>';
  }
  return `<!doctype html><html lang="en"${root}><head><meta charset="utf-8">`
    + `<meta http-equiv="Content-Security-Policy" content="${csp}">`
    + '<meta name="viewport" content="width=device-width, initial-scale=1">'
    // A named icon has the size of the text around it unless the project's styles give it one: in
    // a layer of its own, declared first, so that any rule of the project wins over it.
    + '<style>@layer pe-base{svg[data-icon]{width:1em;height:1em}}</style>'
    // An app that scrolls inside a pane of its own locks the page (body{overflow:hidden}); drawn
    // without the pane's fixed height, the page itself has to scroll.
    + `<style>html,body{margin:0}html{overflow:auto!important}body{overflow:visible!important}[data-picture]{display:inline-block;background:rgba(128,128,128,.22);min-width:1em;min-height:1em}svg:not([width]):not([class]):not([style]){width:1em;height:1em}${focus ? 'html{scrollbar-width:none}*{animation:none!important;transition:none!important}' : ''}</style>`
    + (analysis.conversation ? '<style>:where([data-chat-composer] textarea){width:100%;box-sizing:border-box}</style>' : '')
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
          const view = this.pending;
          this.load(this.loaded.analysis, this.loaded.assets, this.loaded.choices, this.loaded.title);
          this.pending = view;
        }
      } else if (message.type === 'ready') {
        this.ready = true;
        if (this.changed) this.post({ ...this.changed, choices: this.loaded.choices });
        else this.post({ type: 'apply', choices: this.loaded.choices });
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
    const parts = documentParts(analysis, assets.sectionGrids);
    this.drawn = JSON.stringify(parts);
    const frame = makeFrame(title);
    frame.srcdoc = buildDocument(analysis, assets, { token: this.token, choices, parts });
    this.holder.replaceChildren(frame);
    this.frame = frame;
    this.fit();
  }

  /** The analysis that is shown has grown (it is still being written): the frame takes it in without loading again. */
  update(analysis, choices) {
    if (!this.frame || !this.loaded) return;
    this.loaded.analysis = analysis;
    this.loaded.choices = choices;
    const parts = documentParts(analysis, this.loaded.assets.sectionGrids);
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
    if (!this.loaded) return;
    this.loaded.choices = choices;
    if (this.ready) this.post({ type: 'apply', choices });
  }

  view(open, chosen) {
    this.pending = { type: 'view', open, chosen };
    this.post(this.pending);
  }

  focusDot(id) {
    this.frame?.focus();
    this.post({ type: 'focus', id });
  }

  /** How tall the page in the frame is, in its own pixels. */
  get height() {
    return this.frame ? Math.round(this.frame.offsetHeight) : 900;
  }

  /** Where an area and its dot are, in the coordinates of this page. */
  place(id) {
    const rects = this.layout?.rects?.[id];
    if (!rects?.dot || !this.frame) return null;
    const at = this.frame.getBoundingClientRect();
    const k = this.scale;
    const shift = (r) => ({ left: r.left * k + at.left, top: r.top * k + at.top, right: r.right * k + at.left, bottom: r.bottom * k + at.top });
    return { area: shift(rects), dot: shift(rects.dot), port: at };
  }
}

/**
 * One option, drawn small: the whole page with that option in place, as large as the preview's
 * page (`width` × `height`, so that it is laid out the same), moved and scaled so that the area
 * fills the box. `onFit(height)` is called when the box has changed its height, with
 * the height the area has with that option, in the page's own pixels. Returns a
 * function that removes it; its `refit()` fits the picture again at once, after the box has
 * changed its width.
 */
export function mountThumb(box, analysis, assets, areaId, choices, { width, height }, onFit) {
  const emptyState = analysis.areas.find((area) => area.id === areaId)?.decision === 'nothing-to-show';
  const token = newToken();
  const frame = makeFrame('');
  frame.setAttribute('tabindex', '-1');
  frame.setAttribute('aria-hidden', 'true');
  frame.style.cssText = `position:absolute;left:0;top:50%;border:0;width:${width}px;height:${height}px;transform-origin:0 0;pointer-events:none;visibility:hidden`;
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
    // Empty states use the surrounding space to place their content. Fit that space
    // inside the thumbnail so its center stays visible even in portrait previews.
    const maxHeight = Math.min(150, box.clientWidth * 0.7);
    const scale = Math.min(box.clientWidth / w, emptyState ? maxHeight / h : 1, 1);
    const tall = Math.max(44, Math.min(h * scale, maxHeight));
    box.style.height = `${Math.round(tall)}px`;
    const x = (box.clientWidth - w * scale) / 2 - r.left * scale;
    const y = Math.max(0, (tall - h * scale) / 2) - r.top * scale - tall / 2;
    frame.style.transform = `translate(${x}px,${y}px) scale(${scale})`;
    frame.style.visibility = '';
    box.classList.add('has-preview');
    onFit?.(rect.bottom - rect.top);
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
  const remove = () => {
    watcher.disconnect();
    window.removeEventListener('message', listen);
    frame.remove();
  };
  // Fits the picture to the box as wide as it is now, at once, so that the box can be measured.
  remove.refit = () => {
    if (!lastRect || box.clientWidth === boxWidth) return;
    boxWidth = box.clientWidth;
    fit(lastRect);
  };
  return remove;
}
