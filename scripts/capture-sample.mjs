// Builds site/assets/sample-data.js from the running example app of picky-eater
// (examples/react-app): the real markup and the real CSS of three of its screens, cut into the
// areas and options that the sample on the page offers. The words (labels, reasons) are in
// site/assets/sample.js.
//
//   cd ../picky-eater/examples/react-app && npm install && npx vite --port 5199
//   PLAYWRIGHT=/path/to/node_modules/playwright-core/index.mjs node scripts/capture-sample.mjs http://localhost:5199
import { writeFileSync } from 'node:fs';

const { chromium } = await import(process.env.PLAYWRIGHT ?? 'playwright-core');
const url = process.argv[2] ?? 'http://localhost:5199';

// Styles of the options that the app does not have yet. They use the app's own tokens.
const EXTRA_CSS = `
.form-section.pe-card{padding:20px 24px;border:1px solid var(--color-neutral-300);border-radius:12px;background:var(--color-neutral-0)}
.form-section.pe-card + .form-section.pe-card{margin-top:-16px}
@media (min-width:720px){.form-section.pe-side{display:grid;grid-template-columns:220px minmax(0,1fr);column-gap:32px;align-content:start}.form-section.pe-side .form-section__title,.form-section.pe-side .form-section__description{grid-column:1}.form-section.pe-side .form-section__body{grid-column:2;grid-row:1 / span 3;margin-top:0}}
.weekday-list.pe-chips{gap:8px}
.weekday-list.pe-chips .checkbox{position:relative;gap:0}
.weekday-list.pe-chips .checkbox__input{position:absolute;inset:0;width:100%;height:100%;margin:0;opacity:0}
.weekday-list.pe-chips .checkbox__label{display:block;padding:6px 14px;border:1px solid var(--color-neutral-300);border-radius:999px;font-size:var(--font-size-sm)}
.weekday-list.pe-chips .checkbox:has(:checked) .checkbox__label{border-color:var(--color-brand-600);background:var(--color-brand-600);color:#fff}
.notification-list.pe-columns{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:10px 24px}
.settings-actions.pe-sticky{position:sticky;bottom:0;margin:0 -24px;padding:12px 24px;border-top:1px solid var(--color-neutral-300);background:var(--color-neutral-0);box-shadow:0 -6px 16px rgba(0,0,0,.06)}
.danger-zone{padding:20px 24px;border:1px solid #e3b3ae;border-radius:12px;background:#fdf3f2}
.danger-zone h2{margin:0;font-size:var(--font-size-md)}
.danger-zone p{margin:4px 0 12px;font-size:var(--font-size-sm);color:var(--color-neutral-700)}
.danger-zone .button{border-color:var(--color-danger-600);color:var(--color-danger-600)}
.pe-tabs{display:flex;gap:24px;margin:0 0 20px;border-bottom:1px solid var(--color-neutral-300)}
.pe-tabs span{padding:8px 0;margin-bottom:-1px;border-bottom:2px solid transparent;font-size:var(--font-size-sm);color:var(--color-neutral-700)}
.pe-tabs .is-on{border-bottom-color:var(--color-brand-600);color:var(--color-neutral-900);font-weight:var(--font-weight-semibold)}
.pe-tiles{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:12px;margin:0 0 20px}
.pe-tile{padding:14px 16px;border:1px solid var(--color-neutral-300);border-radius:12px;background:var(--color-neutral-0)}
.pe-tile b{display:block;font-size:26px;line-height:1.1;color:var(--color-neutral-900)}
.pe-tile span{font-size:var(--font-size-sm);color:var(--color-neutral-700)}
.pe-rows{list-style:none;margin:0;padding:0;border-top:1px solid var(--color-neutral-300)}
.pe-rows li{display:flex;align-items:center;gap:16px;padding:12px 4px;border-bottom:1px solid var(--color-neutral-300)}
.pe-rows time{flex:0 0 96px;font-weight:var(--font-weight-semibold);color:var(--color-neutral-900)}
.pe-rows .pe-main{flex:1;min-width:0}
.pe-rows .pe-main b{display:block;color:var(--color-neutral-900)}
.pe-rows .pe-main span,.pe-rows .pe-side{font-size:var(--font-size-sm);color:var(--color-neutral-700)}
.pe-cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px}
.pe-card-item{display:flex;flex-direction:column;gap:6px;padding:16px;border:1px solid var(--color-neutral-300);border-radius:12px;background:var(--color-neutral-0)}
.pe-card-item b{color:var(--color-neutral-900)}
.pe-card-item span{font-size:var(--font-size-sm);color:var(--color-neutral-700)}
.pe-card-item .button{align-self:flex-start;margin-top:6px}
.pe-badge{display:inline-block;padding:2px 10px;border-radius:999px;font-size:12px;font-weight:var(--font-weight-semibold)}
.pe-badge.is-ok{background:var(--color-brand-50,#e6f4ee);color:var(--color-brand-700,#14532d)}
.pe-badge.is-wait{background:#fdf3d7;color:#8a5a00}
@media (max-width:560px){.pe-tiles,.pe-cards{grid-template-columns:minmax(0,1fr)}.pe-rows time{flex-basis:76px}}
`;

/** Runs in the page. `kind` names the screen that is showing. */
function capture(kind) {
  const root = document.getElementById('root') ?? document.body.firstElementChild;
  const copy = root.cloneNode(true);
  const slot = (id) => `<pe-area id="${id}"></pe-area>`;
  const place = (nodes, id) => {
    const holder = document.createElement('pe-area');
    holder.id = id;
    nodes[0].before(holder);
    for (const node of nodes) node.remove();
  };
  const html = (nodes) => nodes.map((n) => n.outerHTML).join('');
  const withClass = (node, name) => {
    const twin = node.cloneNode(true);
    twin.classList.add(name);
    return twin;
  };
  const text = (el) => (el?.textContent ?? '').trim();
  const areas = [];

  if (kind === 'settings') {
    const form = copy.querySelector('.settings-form');

    const days = form.querySelector('.weekday-list');
    areas.push({ id: 'days', options: [
      { id: 'keep', keep: true, html: html([days]) },
      { id: 'chips', pattern: 'toggle-button', suggested: true, html: html([withClass(days, 'pe-chips')]) },
    ] });
    place([days], 'days');

    const list = form.querySelector('.notification-list');
    const lead = list.parentElement.querySelector('.select-field');
    areas.push({ id: 'notifications', options: [
      { id: 'keep', keep: true, html: html([list, lead]) },
      { id: 'columns', pattern: 'checkbox-group', suggested: true, html: html([withClass(list, 'pe-columns'), lead]) },
      { id: 'lead-first', pattern: 'select', html: html([lead, list]) },
    ] });
    place([list, lead], 'notifications');

    const sections = [...form.querySelectorAll(':scope > .form-section')];
    areas.unshift({ id: 'sections', options: [
      { id: 'keep', keep: true, html: html(sections) },
      { id: 'cards', pattern: 'card', suggested: true, html: html(sections.map((s) => withClass(s, 'pe-card'))) },
      { id: 'side-titles', pattern: 'label-left', html: html(sections.map((s) => withClass(s, 'pe-side'))) },
    ] });
    place(sections, 'sections');

    const actions = form.querySelector(':scope > .settings-actions');
    const apart = (sticky) => {
      const row = actions.cloneNode(true);
      if (sticky) row.classList.add('pe-sticky');
      const remove = row.querySelector('.button--secondary');
      remove.remove();
      return `${row.outerHTML}<section class="danger-zone"><h2>Delete account</h2><p>Removes your profile, shifts and logged hours. This cannot be undone.</p>${remove.outerHTML}</section>`;
    };
    areas.push({ id: 'actions', options: [
      { id: 'keep', keep: true, html: html([actions]) },
      { id: 'danger-zone', pattern: 'destructive-button', suggested: true, html: apart(false) },
      { id: 'sticky', pattern: 'sticky-save-bar', html: apart(true) },
    ] });
    place([actions], 'actions');
  } else {
    const page = copy.querySelector('.stub-page');
    const title = page.querySelector('h1');
    const intro = page.querySelector('.stub-page__intro');
    const wrap = page.querySelector('.stub-table-wrap');
    const rows = [...wrap.querySelectorAll('tbody tr')].map((tr) => [...tr.children]);
    const tile = (value, label) => `<div class="pe-tile"><b>${value}</b><span>${label}</span></div>`;

    if (kind === 'shifts') {
      const open = rows.filter((cells) => cells[5].querySelector('button')).length;
      const spots = rows.reduce((sum, cells) => {
        const [taken, total] = text(cells[3]).split(/[/ ]/).map(Number);
        return sum + Math.max(0, total - taken);
      }, 0);
      areas.push({ id: 'top', options: [
        { id: 'keep', keep: true, html: html([title, intro]) },
        { id: 'tabs', pattern: 'nav-tabs', suggested: true, html: `${html([title, intro])}<div class="pe-tabs"><span class="is-on">Upcoming</span><span>Signed up</span><span>Past</span></div>` },
        { id: 'numbers', pattern: 'stat-tile', html: `${html([title])}<div class="pe-tiles">${tile(open, 'Open shifts')}${tile(spots, 'Spots left')}${tile(0, 'You signed up')}</div>` },
      ] });
      const action = (cells) => cells[5].innerHTML;
      areas.push({ id: 'list', options: [
        { id: 'keep', keep: true, html: html([wrap]) },
        { id: 'rows', pattern: 'list-row', suggested: true, html: `<ul class="pe-rows">${rows.map((c) => `<li><time>${text(c[0])}</time><div class="pe-main"><b>${text(c[1])}</b><span>${text(c[2])} · ${text(c[4])}</span></div><span class="pe-side">${text(c[3])}</span>${action(c)}</li>`).join('')}</ul>` },
        { id: 'cards', pattern: 'card', html: `<div class="pe-cards">${rows.map((c) => `<div class="pe-card-item"><b>${text(c[1])}</b><span>${text(c[0])} · ${text(c[2])}</span><span>${text(c[3])} · ${text(c[4])}</span>${action(c)}</div>`).join('')}</div>` },
      ] });
    } else {
      const hours = (cells) => Number(text(cells[2]));
      const total = rows.reduce((sum, c) => sum + hours(c), 0);
      const approved = rows.filter((c) => text(c[3]) === 'Approved').reduce((sum, c) => sum + hours(c), 0);
      const badge = (c) => `<span class="pe-badge ${text(c[3]) === 'Approved' ? 'is-ok' : 'is-wait'}">${text(c[3])}</span>`;
      const note = intro.cloneNode(true);
      note.textContent = 'Crew leads approve hours after each shift.';
      areas.push({ id: 'total', options: [
        { id: 'keep', keep: true, html: html([title, intro]) },
        { id: 'tiles', pattern: 'stat-tile', suggested: true, html: `${html([title, note])}<div class="pe-tiles">${tile(total.toFixed(1), 'Hours logged')}${tile(approved.toFixed(1), 'Approved')}${tile((total - approved).toFixed(1), 'Pending approval')}</div>` },
      ] });
      areas.push({ id: 'list', options: [
        { id: 'keep', keep: true, html: html([wrap]) },
        { id: 'rows', pattern: 'status-badge', suggested: true, html: `<ul class="pe-rows">${rows.map((c) => `<li><time>${text(c[0])}</time><div class="pe-main"><b>${text(c[1])}</b><span>${text(c[2])} hours</span></div>${badge(c)}</li>`).join('')}</ul>` },
        { id: 'cards', pattern: 'card', html: `<div class="pe-cards">${rows.map((c) => `<div class="pe-card-item"><b>${text(c[1])}</b><span>${text(c[0])} · ${text(c[2])} hours</span>${badge(c)}</div>`).join('')}</div>` },
      ] });
    }
    place([title, intro], kind === 'shifts' ? 'top' : 'total');
    place([wrap], 'list');
  }

  const css = [...document.styleSheets].map((sheet) => {
    try { return [...sheet.cssRules].map((rule) => rule.cssText).join('\n'); } catch { return ''; }
  }).join('\n');
  return { page: copy.outerHTML, areas, css };
}

const browser = await chromium.launch({ executablePath: process.env.CHROME ?? '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true });
const page = await browser.newPage({ viewport: { width: 1100, height: 900 } });
await page.goto(url, { waitUntil: 'networkidle' });

const screens = [];
let css = '';
for (const [kind, nav, file, ready] of [
  ['settings', 'Settings', 'src/pages/SettingsPage.tsx', '.settings-form .settings-actions'],
  ['shifts', 'Shifts', 'src/pages/ShiftsPage.tsx', '.stub-table tbody tr'],
  ['hours', 'My hours', 'src/pages/MyHoursPage.tsx', '.stub-table tbody tr'],
]) {
  await page.getByRole('button', { name: nav, exact: true }).first().click();
  await page.waitForSelector(ready);
  await page.waitForTimeout(150);
  const shot = await page.evaluate(capture, kind);
  css = shot.css;
  screens.push({ id: kind, file, page: shot.page, areas: shot.areas });
}
await browser.close();

const data = { css: `${css}\n${EXTRA_CSS.trim()}`, screens };
writeFileSync(new URL('../site/assets/sample-data.js', import.meta.url), `// Generated by scripts/capture-sample.mjs from picky-eater's examples/react-app. Do not edit by hand.\nexport const SAMPLE = ${JSON.stringify(data)};\n`);
console.log(screens.map((s) => `${s.id}: ${s.areas.map((a) => `${a.id}(${a.options.length})`).join(' ')}`).join('\n'), `\ncss ${data.css.length} chars`);
