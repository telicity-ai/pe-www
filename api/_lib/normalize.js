import { DECISIONS, PATTERNS } from './catalog.js';

const PATTERN_IDS = new Set(PATTERNS.map((p) => p.id));
const DECISION_IDS = new Set(DECISIONS.map((d) => d.id));

const LIMITS = { areas: 5, options: 4, page: 90_000, option: 30_000, css: 30_000 };

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

/**
 * Markup from the model. It is cut to size here and nothing more: the page that shows it
 * parses it, keeps only harmless elements and attributes, and draws it in a frame that cannot
 * reach the page around it. Scripts are dropped here as well, so that no later step meets them.
 */
function markup(value, max) {
  if (typeof value !== 'string') return '';
  return value
    .replace(/\u0000/g, '')
    .replace(/<script\b[\s\S]*?(<\/script\s*>|$)/gi, '')
    .slice(0, max)
    .trim();
}

function unique(id, seen) {
  let candidate = id;
  for (let i = 2; seen.has(candidate); i += 1) candidate = `${id}-${i}`;
  seen.add(candidate);
  return candidate;
}

const SLOT = /<pe-area\b[^>]*\bid\s*=\s*(["'])([^"']*)\1[^>]*>(\s*<\/pe-area\s*>)?/gi;

/** Turns whatever the model answered into a storyboard the page can draw, or throws. */
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
      // An option may not hold a place for another area.
      const html = markup(rawOption.html, LIMITS.option).replace(SLOT, '');
      if (!optionLabel || !/<[a-z]/i.test(html)) continue;
      const option = { id: unique(slug(rawOption.id, 'option'), optionIds), label: optionLabel, html };
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
    const keep = options.find((o) => o.keep) ?? options[0];
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
    const pick = options.find((o) => o.suggested) ?? options[1];
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

  // Every area has exactly one place in the page. The model either leaves a <pe-area> element
  // there, or (more often) writes the whole page and repeats that part as the area's first
  // option: then the repeated markup is found in the page and replaced by the place.
  const placed = new Set();
  let page = markup(raw.page, LIMITS.page).replace(SLOT, (_, quote, name) => {
    const id = renamed.get(slug(name, ''));
    if (!id || placed.has(id)) return '';
    placed.add(id);
    return `<pe-area id="${id}"></pe-area>`;
  });
  const tight = (html) => html.replace(/>\s+</g, '><').trim();
  /** Replaces `part` in `whole` by the area's place. Returns the new text, or null when it is not there. */
  const cut = (whole, part, slot) => {
    let at = whole.indexOf(part);
    if (at >= 0) return whole.slice(0, at) + slot + whole.slice(at + part.length);
    // The same markup, written with other whitespace between the tags.
    const tightWhole = tight(whole);
    const tightPart = tight(part);
    at = tightPart ? tightWhole.indexOf(tightPart) : -1;
    if (at >= 0) return tightWhole.slice(0, at) + slot + tightWhole.slice(at + tightPart.length);
    // A copy that differs somewhere in the middle: the part is taken from where the copy
    // begins to where it ends, when that stretch is about as long as the copy.
    const EDGE = 100;
    if (tightPart.length < 3 * EDGE) return null;
    const from = tightWhole.indexOf(tightPart.slice(0, EDGE));
    const tail = tightPart.slice(-EDGE);
    const to = from < 0 ? -1 : tightWhole.indexOf(tail, from + EDGE);
    if (to < 0) return null;
    const length = to + tail.length - from;
    if (length < tightPart.length * 0.7 || length > tightPart.length * 1.4) return null;
    return tightWhole.slice(0, from) + slot + tightWhole.slice(from + length);
  };
  // Larger parts first: a part that lies inside another is then found inside that one.
  const bySize = areas.filter((area) => !placed.has(area.id)).sort((a, b) => b.options[0].html.length - a.options[0].html.length);
  for (const area of bySize) {
    const slot = `<pe-area id="${area.id}"></pe-area>`;
    const current = area.options[0].html;
    const inPage = cut(page, current, slot);
    if (inPage !== null) {
      page = inPage;
      placed.add(area.id);
      continue;
    }
    // Inside the present state of an area that is placed already: it is there for as long as that state stands.
    for (const outer of areas) {
      if (outer === area || !placed.has(outer.id)) continue;
      const inside = cut(outer.options[0].html, current, slot);
      if (inside === null) continue;
      outer.options[0].html = inside;
      placed.add(area.id);
      break;
    }
  }
  const kept = areas.filter((area) => placed.has(area.id));
  if (!kept.length) throw new Error('The answer has no area that is placed in the page');
  if (!/<[a-z]/i.test(page.replace(SLOT, ''))) throw new Error('The answer has no page');

  return {
    title: str(raw.title, 48) ?? 'Screen',
    summary: str(raw.summary, 220) ?? '',
    css: typeof raw.css === 'string' ? raw.css.replace(/\u0000/g, '').slice(0, LIMITS.css).trim() : '',
    page,
    areas: kept,
  };
}
