// Draws a storyboard as a wireframe. Everything that comes from an analysis is text: it is
// escaped here and never treated as markup.

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
export const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const WIDTHS = [92, 78, 86, 64, 88, 72, 58, 81];
const lines = (n, from = 0) => Array.from({ length: n }, (_, i) => `<i class="w-ln" style="width:${WIDTHS[(i + from) % WIDTHS.length]}%"></i>`).join('');
const list = (block, fallback) => (block.items?.length ? block.items : fallback);
const count = (block, fallback) => Math.max(1, Math.min(8, block.n ?? block.items?.length ?? fallback));
const styleOf = (block, allowed) => (allowed.includes(block.style) ? block.style : allowed[0]);

function button(label, index, alone) {
  const danger = label.startsWith('!');
  const quiet = label.startsWith('~');
  const text = danger || quiet ? label.slice(1).trim() : label;
  const kind = danger ? 'danger' : quiet ? 'secondary' : index === 0 || alone ? 'primary' : 'secondary';
  return `<span class="w-btn w-btn--${kind}">${esc(text)}</span>`;
}

const DRAW = {
  nav(b) {
    const style = styleOf(b, ['bar', 'side']);
    const links = list(b, []).map((item, i) => `<span${i === 0 && style === 'side' ? ' class="is-on"' : ''}>${esc(item)}</span>`).join('');
    return `<div class="w-nav w-nav--${style}"><b class="w-brand"><i></i>${esc(b.text ?? '')}</b><span class="w-links">${links}</span><i class="w-burger"></i></div>`;
  },
  heading(b) {
    const tag = b.style === 'section' ? 'h2' : 'h1';
    const sub = b.items?.[0] ? `<p class="w-sub">${esc(b.items[0])}</p>` : '';
    return `<div class="w-head"><${tag} class="w-${tag}">${esc(b.text ?? '')}</${tag}>${sub}</div>`;
  },
  text(b) {
    return `<div class="w-text">${lines(count(b, 3))}</div>`;
  },
  hero(b) {
    const style = styleOf(b, ['center', 'split']);
    const [sub, cta] = b.items ?? [];
    return `<div class="w-hero w-hero--${style}"><div class="w-hero-copy"><h1 class="w-h1">${esc(b.text ?? '')}</h1>${
      sub ? `<p class="w-sub">${esc(sub)}</p>` : `<div class="w-text">${lines(2)}</div>`
    }${cta ? `<span class="w-btn w-btn--primary">${esc(cta)}</span>` : ''}</div>${style === 'split' ? '<div class="w-img"></div>' : ''}</div>`;
  },
  section(b, ctx) {
    const style = styleOf(b, ['line', 'card', 'split', 'plain', 'danger']);
    const desc = b.items?.[0] ? `<p class="w-sub">${esc(b.items[0])}</p>` : '';
    const head = b.text || desc ? `<header><h3 class="w-h3">${esc(b.text ?? '')}</h3>${desc}</header>` : '';
    return `<section class="w-sec w-sec--${style}">${head}<div class="w-sec-body">${renderBlocks(b.children ?? [], ctx)}</div></section>`;
  },
  fields(b) {
    const style = styleOf(b, ['label-top', 'label-left']);
    const cols = Math.min(3, b.cols ?? 1);
    const items = list(b, ['', '']).map((label) => `<div class="w-field"><span>${esc(label)}</span><i></i></div>`).join('');
    return `<div class="w-fields w-fields--${style}" style="--cols:${cols}">${items}</div>`;
  },
  choices(b) {
    const style = styleOf(b, ['checkbox', 'radio', 'switch', 'chips', 'segmented', 'select']);
    const items = list(b, ['', '', '']);
    const label = b.text ? `<span class="w-label">${esc(b.text)}</span>` : '';
    if (style === 'select') {
      return `<div class="w-choices w-choices--select">${label}<div class="w-select"><span>${esc(items[0])}</span><i></i></div></div>`;
    }
    const on = (i) => (style === 'radio' || style === 'segmented' ? i === 0 : i % 3 === 0);
    const body = items.map((item, i) => `<span class="w-opt${on(i) ? ' is-on' : ''}"><i></i><em>${esc(item)}</em></span>`).join('');
    const cols = b.cols && b.cols > 1 ? ` style="--cols:${Math.min(4, b.cols)}"` : '';
    return `<div class="w-choices w-choices--${style}${cols ? ' has-cols' : ''}">${label}<div class="w-opts"${cols}>${body}</div></div>`;
  },
  input(b) {
    const style = styleOf(b, ['text', 'search', 'textarea']);
    return `<div class="w-input w-input--${style}"><i></i><span>${esc(b.text ?? '')}</span></div>`;
  },
  buttons(b) {
    const style = styleOf(b, ['left', 'right', 'between', 'stacked', 'sticky']);
    const items = list(b, ['']);
    return `<div class="w-btns w-btns--${style}">${items.map((label, i) => button(label, i, items.length === 1)).join('')}</div>`;
  },
  cards(b) {
    const style = styleOf(b, ['plain', 'media', 'stat', 'pricing', 'row']);
    const items = b.items?.length ? b.items : Array.from({ length: count(b, 3) }, () => '');
    const cols = Math.min(4, b.cols ?? (style === 'row' ? 1 : Math.min(3, items.length)));
    const body = items.map((title, i) => {
      const head = `<b class="w-card-title">${esc(title)}</b>`;
      if (style === 'media') return `<div class="w-card"><div class="w-img"></div>${head}${lines(2, i)}</div>`;
      if (style === 'stat') return `<div class="w-card w-card--stat"><strong></strong>${head}</div>`;
      if (style === 'pricing') {
        return `<div class="w-card w-card--pricing${i === 1 ? ' is-on' : ''}">${head}<strong></strong><div class="w-ticks">${lines(3, i)}</div><span class="w-btn w-btn--${i === 1 ? 'primary' : 'secondary'}"></span></div>`;
      }
      if (style === 'row') return `<div class="w-card w-card--row"><div class="w-img"></div><div>${head}${lines(2, i)}</div></div>`;
      return `<div class="w-card">${head}${lines(2, i)}</div>`;
    }).join('');
    return `<div class="w-cards" style="--cols:${cols}">${body}</div>`;
  },
  list(b) {
    const style = styleOf(b, ['plain', 'divided', 'avatar', 'accordion']);
    const rows = b.items?.length ? b.items : Array.from({ length: count(b, 4) }, () => '');
    const body = rows.map((title, i) => {
      const head = title ? `<b>${esc(title)}</b>` : `<i class="w-ln" style="width:${WIDTHS[i % WIDTHS.length] / 2}%"></i>`;
      if (style === 'accordion') return `<div class="w-row${i === 0 ? ' is-open' : ''}"><div class="w-row-main">${head}${i === 0 ? lines(2) : ''}</div><i class="w-chev"></i></div>`;
      return `<div class="w-row">${style === 'avatar' ? '<i class="w-avatar"></i>' : ''}<div class="w-row-main">${head}${lines(1, i)}</div></div>`;
    }).join('');
    return `<div class="w-list w-list--${style}">${body}</div>`;
  },
  table(b) {
    const style = styleOf(b, ['plain', 'stacked']);
    const cols = list(b, ['', '', '']).slice(0, 6);
    const rows = count({ n: b.n }, 3);
    if (style === 'stacked') {
      const card = (r) => `<div class="w-card w-card--kv">${cols.map((c, i) => `<div><span>${esc(c)}</span><i class="w-ln" style="width:${WIDTHS[(i + r) % WIDTHS.length] / 2}%"></i></div>`).join('')}</div>`;
      return `<div class="w-stacked">${Array.from({ length: Math.min(rows, 3) }, (_, r) => card(r)).join('')}</div>`;
    }
    const head = `<div class="w-tr w-tr--head">${cols.map((c) => `<span>${esc(c)}</span>`).join('')}</div>`;
    const body = Array.from({ length: rows }, (_, r) => `<div class="w-tr">${cols.map((_, i) => `<span><i class="w-ln" style="width:${WIDTHS[(i + r) % WIDTHS.length] - 20}%"></i></span>`).join('')}</div>`).join('');
    return `<div class="w-table" style="--cols:${cols.length}">${head}${body}</div>`;
  },
  tabs(b) {
    const style = styleOf(b, ['underline', 'pill', 'vertical']);
    return `<div class="w-tabs w-tabs--${style}">${list(b, ['', '', '']).map((item, i) => `<span${i === 0 ? ' class="is-on"' : ''}>${esc(item)}</span>`).join('')}</div>`;
  },
  image(b) {
    const style = styleOf(b, ['wide', 'square', 'banner']);
    return `<figure class="w-figure w-figure--${style}"><div class="w-img"></div>${b.text ? `<figcaption>${esc(b.text)}</figcaption>` : ''}</figure>`;
  },
  notice(b) {
    const style = styleOf(b, ['info', 'success', 'warning', 'danger', 'toast', 'empty']);
    const action = b.items?.[0] ? `<span class="w-btn w-btn--secondary">${esc(b.items[0])}</span>` : '';
    return `<div class="w-notice w-notice--${style}"><i></i><span>${esc(b.text ?? '')}</span>${action}</div>`;
  },
  steps(b) {
    const style = styleOf(b, ['horizontal', 'vertical']);
    return `<div class="w-steps w-steps--${style}">${list(b, ['', '', '']).map((item, i) => `<div class="w-step${i === 0 ? ' is-on' : ''}"><i>${i + 1}</i><span>${esc(item)}</span></div>`).join('')}</div>`;
  },
  dialog(b) {
    const style = styleOf(b, ['modal', 'sheet', 'drawer']);
    const [body, ...actions] = b.items ?? [];
    const buttons = actions.length ? `<div class="w-btns w-btns--right">${actions.map((label, i) => button(label, actions.length - 1 - i, false)).join('')}</div>` : '';
    return `<div class="w-dialog w-dialog--${style}"><div class="w-dialog-box"><b>${esc(b.text ?? '')}</b>${body ? `<p class="w-sub">${esc(body)}</p>` : lines(2)}${buttons}</div></div>`;
  },
  footer(b) {
    return `<div class="w-footer"><b>${esc(b.text ?? '')}</b><span class="w-links">${list(b, []).map((item) => `<span>${esc(item)}</span>`).join('')}</span></div>`;
  },
};

function drawArea(block, ctx) {
  const area = ctx.areas.get(block.text);
  if (!area || ctx.stack.includes(area.id)) return '';
  const optionId = ctx.pick(area.id);
  const option = area.options.find((o) => o.id === optionId) ?? area.options[0];
  const inner = renderBlocks(option.blocks, { ...ctx, stack: [...ctx.stack, area.id] });
  if (!ctx.dots) return inner;
  const state = `${ctx.chosen(area.id) ? ' is-done' : ''}${ctx.open === area.id ? ' is-open' : ''}`;
  return `<div class="w-area${state}" data-area="${esc(area.id)}">${inner}<button type="button" class="dot${state}" data-dot="${esc(area.id)}" aria-expanded="${ctx.open === area.id}" aria-label="${esc(area.label)}"></button></div>`;
}

export function renderBlocks(blocks, ctx) {
  return (blocks ?? []).map((block) => {
    if (!block || typeof block !== 'object') return '';
    if (block.t === 'area') return drawArea(block, ctx);
    const draw = DRAW[block.t];
    return draw ? draw(block, ctx) : '';
  }).join('');
}

/**
 * The whole screen. `ctx.pick(areaId)` says which option to draw, `ctx.chosen(areaId)` whether
 * the person has decided, `ctx.open` which area's options are showing.
 */
export function renderPage(analysis, ctx) {
  const full = { dots: true, stack: [], open: null, ...ctx, areas: new Map(analysis.areas.map((a) => [a.id, a])) };
  const side = analysis.page.find((b) => b.t === 'nav' && b.style === 'side');
  const rest = side ? analysis.page.filter((b) => b !== side) : analysis.page;
  const body = renderBlocks(rest, full);
  return side
    ? `<div class="w-page w-page--side">${DRAW.nav(side)}<div class="w-main">${body}</div></div>`
    : `<div class="w-page"><div class="w-main">${body}</div></div>`;
}

/** One option, drawn small. Areas inside it show what is currently chosen there. */
export function renderThumb(analysis, area, option, ctx) {
  const full = { ...ctx, dots: false, stack: [area.id], areas: new Map(analysis.areas.map((a) => [a.id, a])) };
  return `<div class="th-in"><div class="w-page"><div class="w-main">${renderBlocks(option.blocks, full)}</div></div></div>`;
}
