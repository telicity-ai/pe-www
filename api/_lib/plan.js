// Which parts of a page become its areas, and what is sent of them. The parts are found in the
// page's own structure (see page.js); the model is asked once, for what needs a reader: which
// parts matter, what each choice is called, and which arrangement it would suggest and why. The
// same holds for a live page (api/site.js) and for a screen drawn from a repository
// (api/storyboard.js).
import { Reader, clean } from './answer.js';
import { ARRANGEMENTS } from './brief.js';

const AREAS = 5; // more than are shown: an area whose arrangements do not hold on the page is left out there
const SPARE = 3; // parts the model did not name, offered when those it named do not hold

/** What an area is called when the model does not say. `opens` differs: a live page opens with a hero, a screen with its title. */
const LABELS = {
  en: { opens: { site: 'How the page opens', screen: 'How the top of the screen is laid out' }, block: 'How this part is laid out', group: 'How these items are laid out', under: (title) => `How “${title}” is laid out` },
  ko: { opens: { site: '첫 화면 구성', screen: '화면 위쪽 배치' }, block: '이 부분의 배치', group: '항목 배치 방식', under: (title) => `“${title}” 배치 방식` },
};

/**
 * Reads the model's answer into areas: `[{ candidate, label, picks: [{ id, because }] }]`, in
 * the order of the answer. A part named twice, a part inside another, and an arrangement that
 * the part cannot take are left out.
 */
export function readAreas(text, list) {
  const areas = [];
  let summary = null;
  let area = null;
  const reader = new Reader((name, rest) => {
    if (name === 'SUMMARY') summary = rest;
    if (name === 'AREA') {
      area = null;
      const [number, ...label] = rest.split('|');
      const candidate = list[Number(number.replace(/[^0-9]/g, '')) - 1];
      if (!candidate || areas.length >= AREAS || areas.some((a) => a.candidate.from < candidate.to && candidate.from < a.candidate.to)) return;
      area = { candidate, label: clean(label.join('|'), 70), picks: [] };
      areas.push(area);
    }
    if (name === 'PICK' && area) {
      const [id, ...reason] = rest.split('|');
      const recipe = id.trim().toLowerCase();
      if (area.candidate.fits.includes(recipe) && !area.picks.some((pick) => pick.id === recipe)) area.picks.push({ id: recipe, because: clean(reason.join('|'), 200) });
    }
  }, () => {});
  reader.push(text);
  reader.end();
  return { areas: areas.filter((a) => a.picks.length), summary };
}

/**
 * The areas as they are sent: `[{ id, label, place, options: [{ id, because? }] }]`. `picked`
 * is what the model named (see `readAreas`); without it, the part the page opens with and the
 * groups that follow it are offered, nothing suggested. Each area brings every arrangement its
 * part can take: those that were given a reason first, in their order. `kind` is "site" for a
 * live page, "screen" for one drawn from a repository.
 */
export function planOf(list, picked, lang, kind = 'site') {
  const areas = [...picked];
  const free = (candidate) => !areas.some((a) => a.candidate.from < candidate.to && candidate.from < a.candidate.to);
  const add = (candidate) => areas.push({ candidate, label: null, picks: [] });
  if (!areas.length) {
    const opening = list.find((c) => c.kind === 'block' && c.opens);
    const groups = list.filter((c) => c.kind === 'group');
    // A screen without a group (an empty state, a notice) still has its blocks.
    const blocks = groups.length ? [] : list.filter((c) => c.kind === 'block' && c !== opening);
    for (const candidate of [opening, ...groups, ...blocks].filter(Boolean).slice(0, AREAS)) add(candidate);
  } else {
    // What the model named may not hold when it is tried on the page: some groups that it did
    // not name stand by. Those under a heading of their own, or of items with headings, are
    // parts of the page itself rather than the inside of a picture of a product.
    const spare = list.filter((c) => c.kind === 'group' && c.items >= 3 && (c.title || c.each.includes('a heading')) && free(c));
    for (const candidate of spare.slice(0, SPARE)) add(candidate);
  }
  const names = LABELS[lang] ?? LABELS.en;
  return areas.map(({ candidate, label, picks }) => ({
    id: `area-${candidate.n}`,
    label: label ?? (candidate.kind === 'group' ? (candidate.title ? names.under(clean(candidate.title, 40)) : names.group) : candidate.opens ? names.opens[kind] ?? names.opens.site : names.block),
    place: { from: candidate.from, to: candidate.to },
    options: [...picks, ...candidate.fits.filter((id) => !picks.some((pick) => pick.id === id)).map((id) => ({ id }))],
  }));
}

/**
 * The lines of the answer that say what the areas are: the plan, where each area lies in the
 * page, and its options. `arranged` tells the page that shows them that these options are
 * arrangements to be tried there, and that a plan without areas is an answer too.
 */
export function planEvents(plan, { file }) {
  const events = [{ t: 'plan', arranged: true, areas: plan.map(({ id, label, options }) => ({ id, label, options: options.map((o) => o.id) })), file }];
  for (const area of plan) events.push({ t: 'place', area: area.id, ...area.place });
  for (const area of plan) {
    for (const option of area.options) {
      const pattern = ARRANGEMENTS[option.id].pattern;
      events.push({ t: 'option', area: area.id, id: option.id, recipe: option.id, ...(pattern ? { pattern } : {}), ...(option.because ? { because: option.because } : {}) });
    }
  }
  return events;
}
