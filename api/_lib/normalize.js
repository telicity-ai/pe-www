import { DECISIONS, PATTERNS } from './catalog.js';
import { BLOCK_TYPES } from './prompt.js';

const PATTERN_IDS = new Set(PATTERNS.map((p) => p.id));
const DECISION_IDS = new Set(DECISIONS.map((d) => d.id));
const TYPES = new Set(BLOCK_TYPES);

const LIMITS = { pageBlocks: 20, optionBlocks: 6, children: 8, items: 8, areas: 5, options: 4 };

function str(value, max) {
  if (typeof value !== 'string') return null;
  const clean = value.replace(/[\u0000-\u001f\u007f]+/g, ' ').replace(/\s+/g, ' ').trim();
  if (!clean) return null;
  return clean.length > max ? `${clean.slice(0, max - 1).trimEnd()}…` : clean;
}

function slug(value, fallback) {
  const s = typeof value === 'string' ? value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 40) : '';
  return s || fallback;
}

function int(value, min, max) {
  return Number.isInteger(value) ? Math.min(max, Math.max(min, value)) : null;
}

function leaf(raw, { allowArea }) {
  if (!raw || typeof raw !== 'object' || !TYPES.has(raw.t)) return null;
  if (raw.t === 'area') {
    if (!allowArea) return null;
    const id = slug(raw.text, '');
    return id ? { t: 'area', text: id } : null;
  }
  const block = { t: raw.t };
  const text = str(raw.text, 90);
  if (text) block.text = text;
  if (Array.isArray(raw.items)) {
    const items = raw.items.map((item) => str(item, 48)).filter(Boolean).slice(0, LIMITS.items);
    if (items.length) block.items = items;
  }
  const n = int(raw.n, 1, 8);
  if (n) block.n = n;
  const cols = int(raw.cols, 1, 4);
  if (cols) block.cols = cols;
  const style = typeof raw.style === 'string' && /^[a-z][a-z-]{0,20}$/.test(raw.style) ? raw.style : null;
  if (style) block.style = style;
  return block;
}

function blocks(raw, max, { allowArea }) {
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const item of raw) {
    const block = leaf(item, { allowArea });
    if (!block) continue;
    if (block.t === 'section' && Array.isArray(item.children)) {
      const children = item.children
        .map((child) => (child && child.t === 'section' ? null : leaf(child, { allowArea })))
        .filter(Boolean)
        .slice(0, LIMITS.children);
      if (children.length) block.children = children;
    }
    out.push(block);
    if (out.length >= max) break;
  }
  return out;
}

function unique(id, seen) {
  let candidate = id;
  for (let i = 2; seen.has(candidate); i += 1) candidate = `${id}-${i}`;
  seen.add(candidate);
  return candidate;
}

function slots(list, visit) {
  for (const block of list) {
    if (block.t === 'area') visit(block);
    for (const child of block.children ?? []) if (child.t === 'area') visit(child);
  }
}

function dropSlots(list, keep) {
  return list
    .filter((block) => block.t !== 'area' || keep(block))
    .map((block) => (block.children ? { ...block, children: block.children.filter((c) => c.t !== 'area' || keep(c)) } : block));
}

/**
 * Turns whatever the model answered into a storyboard the page can draw, or throws.
 * Nothing in the result is trusted markup: every string is plain text of bounded length.
 */
export function normalize(raw) {
  if (!raw || typeof raw !== 'object') throw new Error('The answer is not an object');

  const areaIds = new Set();
  const renamed = new Map();
  const areas = [];
  for (const rawArea of Array.isArray(raw.areas) ? raw.areas : []) {
    if (areas.length >= LIMITS.areas) break;
    if (!rawArea || typeof rawArea !== 'object') continue;
    const label = str(rawArea.label, 70);
    if (!label) continue;

    const optionIds = new Set();
    const options = [];
    for (const rawOption of Array.isArray(rawArea.options) ? rawArea.options : []) {
      if (options.length >= LIMITS.options) break;
      if (!rawOption || typeof rawOption !== 'object') continue;
      const optionLabel = str(rawOption.label, 70);
      const optionBlocks = blocks(rawOption.blocks, LIMITS.optionBlocks, { allowArea: false });
      if (!optionLabel || !optionBlocks.length) continue;
      const option = { id: unique(slug(rawOption.id, 'option'), optionIds), label: optionLabel, blocks: optionBlocks };
      if (rawOption.keep === true) option.keep = true;
      const pattern = typeof rawOption.pattern === 'string' && PATTERN_IDS.has(rawOption.pattern) ? rawOption.pattern : null;
      if (pattern && !option.keep) option.pattern = pattern;
      if (rawOption.suggested === true && !option.keep) option.suggested = true;
      const because = str(rawOption.because, 200);
      if (because && option.suggested) option.because = because;
      options.push(option);
    }
    if (options.length < 2) continue;

    // Exactly one "as it is today", and it comes first.
    const keeps = options.filter((o) => o.keep);
    const keep = keeps[0] ?? options[0];
    for (const option of options) {
      if (option === keep) {
        option.keep = true;
        delete option.pattern;
        delete option.suggested;
        delete option.because;
      } else {
        delete option.keep;
      }
    }
    options.splice(options.indexOf(keep), 1);
    options.unshift(keep);

    // Exactly one suggestion among the alternatives.
    const suggested = options.filter((o) => o.suggested);
    const pick = suggested[0] ?? options[1];
    for (const option of options.slice(1)) {
      if (option === pick) option.suggested = true;
      else {
        delete option.suggested;
        delete option.because;
      }
    }

    const wanted = slug(rawArea.id, 'area');
    const id = unique(wanted, areaIds);
    if (!renamed.has(wanted)) renamed.set(wanted, id);
    const area = { id, label, options };
    if (typeof rawArea.decision === 'string' && DECISION_IDS.has(rawArea.decision)) area.decision = rawArea.decision;
    areas.push(area);
  }
  if (!areas.length) throw new Error('The answer has no area with at least two options');

  let page = blocks(raw.page, LIMITS.pageBlocks, { allowArea: true });
  const placed = new Set();
  page = dropSlots(page, (slot) => {
    const id = renamed.get(slot.text);
    if (!id || placed.has(id)) return false;
    slot.text = id;
    placed.add(id);
    return true;
  });
  // An area nobody placed goes to the end, so that it can still be chosen.
  for (const area of areas) if (!placed.has(area.id)) page.push({ t: 'area', text: area.id });

  let count = 0;
  slots(page, () => { count += 1; });
  if (count !== areas.length) throw new Error('Areas and their places on the page do not match');

  return {
    title: str(raw.title, 48) ?? 'Screen',
    summary: str(raw.summary, 220) ?? '',
    page,
    areas,
  };
}
