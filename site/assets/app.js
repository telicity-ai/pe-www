import { assemble, newBoard, streamBoard, take } from './board.js';
import { API_BASE } from './config.js';
import { RepoError, collectFiles, parseRepo, scanRepo } from './github.js';
import { iconsIn, loadIcons } from './icons.js';
import { getLang, initLang, setLang, t } from './i18n.js';
import { Preview, mountThumb } from './preview.js';
import { buildProjectPrompt, diffPrompt, mergePrompt } from './prompt.js';
import { sampleProject } from './sample.js';

const $ = (id) => document.getElementById(id);
const frame = $('frame');
const pop = $('pop');
const stage = $('stage');
const textarea = $('prompt');

const ESCAPES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (c) => ESCAPES[c]);

const STEPS = ['tree', 'screens', 'stack', 'read', 'draw'];
const SCENE_MS = 2950;

const state = {
  project: null,
  screen: null,
  open: null, // id of the area whose options are showing
  preview: null, // { area, option } while an option is pointed at
  run: 0, // increases with every analysis; an answer for an older run is dropped
  retry: null,
  // Light or dark, for a project that has both: as this person's own system has it.
  scheme: window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light',
};

// ---------- what is kept between visits ----------

// The picks of a project, and for a repository the analyses they were made on, so that coming
// back to the page finds them again. One entry per project, the five latest repositories.
const STORE = 'pe-picks:';
const storeKey = (project) => `${STORE}${project.sample ? 'sample' : `${project.repo.owner}/${project.repo.name}`.toLowerCase()}`;

function saveNow(project) {
  const screens = {};
  for (const screen of project.screens) {
    if (!screen.analysis || screen.status !== 'ready') continue;
    screens[screen.id] = { title: screen.title, choices: screen.choices, ...(project.sample ? {} : { analysis: screen.analysis }) };
  }
  const data = { v: 1, at: Date.now(), tree: project.scan?.treeSha ?? null, screens, generated: project.generated, ...(project.text !== project.generated ? { text: project.text } : {}) };
  try {
    localStorage.setItem(storeKey(project), JSON.stringify(data));
    const others = Object.keys(localStorage).filter((key) => key.startsWith(STORE) && key !== `${STORE}sample`)
      .map((key) => { try { return [key, JSON.parse(localStorage.getItem(key)).at ?? 0]; } catch { return [key, 0]; } })
      .sort((a, b) => b[1] - a[1]);
    for (const [key] of others.slice(5)) localStorage.removeItem(key);
  } catch {
    // No room, or no storage at all: the picks then last as long as the page.
    try { localStorage.removeItem(storeKey(project)); } catch { /* nothing more to try */ }
  }
}

let saveTimer = null;
function save(project) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => saveNow(project), 300);
}

/** What was kept for this project, or null. Analyses of a repository count only for the same state of its files. */
function kept(project) {
  try {
    const data = JSON.parse(localStorage.getItem(storeKey(project)));
    if (data?.v !== 1 || typeof data.screens !== 'object') return null;
    if (!project.sample && data.tree !== (project.scan?.treeSha ?? null)) return null;
    return data;
  } catch {
    return null;
  }
}

// ---------- the picks and the prompt ----------

function prepare(screen, choices = {}) {
  const valid = {};
  for (const area of screen.analysis.areas) {
    if (area.options.some((o) => o.id === choices?.[area.id])) valid[area.id] = choices[area.id];
  }
  screen.choices = valid;
}

/** The screens that the prompt speaks of: those with a pick, or else the one that is shown. `tried` stands in for the picks of the screen that is shown. */
function spoken(project, tried = null) {
  const choicesOf = (screen) => (tried && screen === state.screen ? tried : screen.choices ?? {});
  const picked = project.screens.filter((s) => s.analysis && Object.keys(choicesOf(s)).length);
  const list = picked.length || !state.screen?.analysis || !project.screens.includes(state.screen) ? picked : [state.screen];
  return list.map((screen) => ({ analysis: screen.analysis, choices: choicesOf(screen) }));
}
const promptOf = (project, tried = null) => buildProjectPrompt(spoken(project, tried), getLang());

/**
 * Writes the project's one prompt anew after something changed (a pick, another screen, an
 * analysis that has grown), keeping what the person typed into it. Returns what changed.
 */
function rewrite(project = state.project) {
  if (!project) return { added: [], removed: [] };
  const before = project.generated ?? '';
  const after = promptOf(project);
  project.text = project.text === undefined || project.text === before ? after : mergePrompt(project.text, before, after);
  project.generated = after;
  if (project.restored) {
    // What was typed into the prompt on an earlier visit belongs to the prompt as it then was.
    if (project.restored.text && project.restored.generated === after) project.text = project.restored.text;
    project.restored = null;
  }
  save(project);
  return diffPrompt(before, after);
}

/** The analysis of a screen has grown while it is shown: its picks follow, and the prompt. */
function grow(screen, analysis) {
  screen.analysis = analysis;
  for (const id of Object.keys(screen.choices)) {
    if (!analysis.areas.some((a) => a.id === id && a.options.some((o) => o.id === screen.choices[id]))) delete screen.choices[id];
  }
  if (state.project?.screens.includes(screen)) rewrite();
}

function choose(areaId, optionId) {
  const screen = state.screen;
  if (screen.choices[areaId] === optionId) delete screen.choices[areaId];
  else screen.choices[areaId] = optionId;
  const change = rewrite();
  if (change.added.length || change.removed.length) state.project.last = change;
}

// ---------- the interface in the middle ----------

/** What stands in each area right now: what was chosen, and on top of that what is pointed at. */
function shown() {
  const choices = { ...state.screen.choices };
  if (state.preview) choices[state.preview.area] = state.preview.option;
  return choices;
}

const preview = new Preview(frame, {
  layout: placePop,
  dot: ({ id, keyboard }) => openArea(state.open === id ? null : id, keyboard),
  away: closePop,
  escape: () => {
    const id = state.open;
    closePop();
    if (id) preview.focusDot(id);
  },
});

function syncStage() {
  if (!state.screen) return;
  preview.apply(shown());
  preview.view(state.open, Object.keys(state.screen.choices));
}

let thumbs = [];
let tallest = 0; // the height of the open area with its tallest option, in the page's own pixels
function dropThumbs() {
  for (const remove of thumbs) remove();
  thumbs = [];
  tallest = 0;
}

function renderPop() {
  const screen = state.screen;
  const area = screen?.analysis.areas.find((a) => a.id === state.open);
  dropThumbs();
  if (!area) {
    pop.className = 'pop';
    pop.innerHTML = '';
    return;
  }
  // Only pictures: what an option is called and why one is suggested are read by pointing at it
  // (and by a screen reader), so that the options take as little of the page as possible.
  pop.setAttribute('aria-label', area.label);
  pop.innerHTML = `<div class="pop-h">${esc(area.label)}</div><div class="pop-o">${area.options.map((option) => {
    const selected = screen.choices[area.id] === option.id;
    const label = option.label || t('pop.keep');
    const reason = option.suggested ? `${t('pop.suggested')}${option.because ? `: ${option.because}` : ''}` : '';
    const name = reason ? `${label}. ${reason}` : label;
    return `<button type="button" class="opt${selected ? ' sel' : ''}" data-option="${esc(option.id)}" aria-pressed="${selected}" aria-label="${esc(name)}" title="${esc(label)}">${
      option.suggested ? `<i class="star" title="${esc(reason)}">★</i>` : ''
    }<div class="th">${option.keep ? `<span class="now">${esc(t('pop.now'))}</span>` : ''}</div></button>`;
  }).join('')}</div>`;
  pop.className = 'pop show';
  pop.style.visibility = 'hidden';
  // Each picture is the page itself with that option in place, at the width the page has now.
  const width = preview.width || 1024;
  for (const option of area.options) {
    const box = pop.querySelector(`[data-option="${CSS.escape(option.id)}"] .th`);
    thumbs.push(mountThumb(box, screen.analysis, screen.assets, area.id, { ...screen.choices, [area.id]: option.id }, width, (height) => {
      tallest = Math.max(tallest, height);
      placePop();
    }));
  }
}

function markSelection() {
  const chosen = state.screen?.choices[state.open];
  for (const option of pop.querySelectorAll('.opt')) {
    const on = option.dataset.option === chosen;
    option.classList.toggle('sel', on);
    option.setAttribute('aria-pressed', String(on));
  }
}

/**
 * Puts the options by the dot of the part they change. In this order: beside a narrow page (a
 * phone leaves room in the stage itself), above that part, below it when it is low enough for
 * that to be near the dot, and otherwise right under the dot, over the part.
 *
 * The part is taken as it was when it was opened (the frame holds that still) and as tall as
 * its tallest option makes it: the options stay where they are while one of them is tried.
 */
function placePop() {
  if (!state.open) return;
  const at = preview.place(state.open);
  if (!at) {
    pop.style.visibility = 'hidden';
    return;
  }
  const outer = stage.getBoundingClientRect();
  const { area: box, dot, port } = at;
  const top = Math.max(box.top, port.top);
  const bottom = Math.min(Math.max(box.bottom, box.top + tallest * preview.scale), port.bottom);
  if (bottom <= top) {
    pop.style.visibility = 'hidden';
    return;
  }
  pop.style.visibility = '';
  const GAP = 10;
  const EDGE = 6;
  const NEAR = 150; // how far below the dot the options may begin and still be by it
  const clamp = (value, min, max) => Math.max(min, Math.min(value, max));

  const set = (left, y) => {
    pop.style.left = `${left}px`;
    pop.style.top = `${y}px`;
  };
  const beside = (room, leftOf) => {
    pop.classList.add('pop--col');
    const width = pop.offsetWidth;
    const height = pop.offsetHeight;
    if (width > room - 2 * EDGE || height > outer.height - 2 * EDGE) return false;
    set(leftOf ? port.left - outer.left - EDGE - width : port.right - outer.left + EDGE, clamp(dot.top - outer.top - 10, EDGE, outer.height - height - EDGE));
    return true;
  };
  if (beside(outer.right - port.right, false) || beside(port.left - outer.left, true)) return;

  pop.classList.remove('pop--col');
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  // The options end where the dot does, on its side of the part.
  const left = clamp(dot.right - outer.left - width + 8, EDGE, Math.max(EDGE, outer.width - width - EDGE));
  const lowest = Math.max(EDGE, outer.height - height - EDGE);
  if (height <= top - outer.top - GAP - EDGE) return set(left, top - outer.top - GAP - height);
  if (bottom + GAP - dot.bottom <= NEAR && height <= outer.bottom - bottom - GAP - EDGE) return set(left, bottom - outer.top + GAP);
  set(left, clamp(dot.bottom - outer.top + GAP, EDGE, lowest));
}

function openArea(id, fromKeyboard = false) {
  state.open = id;
  state.preview = null;
  syncStage();
  renderPop();
  placePop();
  renderDiff();
  if (id && fromKeyboard) pop.querySelector('.opt')?.focus();
}

function closePop() {
  if (!state.open && !state.preview) return;
  openArea(null);
}

// ---------- around it ----------

function renderToolbar() {
  const project = state.project;
  const repo = project.repo;
  $('rname').textContent = `${repo.owner}/${repo.name}`;
  $('rsub').textContent = repo.sub ? `/${repo.sub}` : '';
  $('rtag').hidden = !project.sample;
  // The choice between light and dark is offered when the project's styles have both.
  $('scheme').hidden = !state.screen?.assets?.dark;
  for (const button of $('scheme').children) button.classList.toggle('on', button.dataset.s === state.scheme);
  const areas = state.screen?.analysis?.areas ?? [];
  const chosen = areas.filter((a) => state.screen.choices[a.id]).length;
  $('pips').innerHTML = areas.map((a) => `<i class="${state.screen.choices[a.id] ? 'f' : ''}"></i>`).join('');
  // While a screen is still being written, the toolbar says what is on its way.
  const writing = state.screen?.status === 'loading';
  $('pcount').classList.toggle('busy', writing);
  if (writing) $('pcount').textContent = t(state.screen.analysis?.pageDone ? 'pg.options' : 'pg.drawing');
  else $('pcount').textContent = areas.length ? t('pg.chosen', { n: chosen, m: areas.length }) : '';
}

function renderRail() {
  const project = state.project;
  $('screens').innerHTML = project.screens.map((screen) => {
    const badge = screen.status === 'loading' ? '<b class="spin"></b>' : screen.analysis ? `<b${Object.keys(screen.choices ?? {}).length ? ' class="has"' : ''}>${Object.keys(screen.choices ?? {}).length ? `${Object.keys(screen.choices).length}/` : ''}${screen.analysis.areas.length}</b>` : '';
    return `<button type="button" class="scr${screen === state.screen ? ' on' : ''}" data-screen="${esc(screen.id)}" title="${esc(screen.path)}">${badge}${esc(screen.title)}<small>${esc(screen.path)}</small></button>`;
  }).join('');
  $('stack').innerHTML = project.stack.map((item) => `<span>${esc(item)}</span>`).join('');
}

function renderDiff() {
  const screen = state.screen;
  const project = state.project;
  if (!screen || !project) return;
  let change = project.last;
  let previewing = false;
  if (state.preview) {
    change = diffPrompt(project.generated, promptOf(project, shown()));
    previewing = true;
  }
  const box = $('df');
  const head = (label, counts = '') => `<div class="dfh${previewing ? ' pv' : ''}">${esc(label)}${counts}</div>`;
  if (!change || (!change.added.length && !change.removed.length)) {
    box.innerHTML = head(t(previewing ? 'diff.preview' : 'diff.changes')) + `<div class="dl m">${esc(t(previewing ? 'diff.same' : 'diff.none'))}</div>`;
    return;
  }
  const rows = [...change.removed.map((line) => ['r', line]), ...change.added.map((line) => ['a', line])];
  const visible = rows.slice(0, 4);
  box.innerHTML = head(t(previewing ? 'diff.preview' : 'diff.last'), `<b>+${change.added.length}</b><s>−${change.removed.length}</s>`)
    + visible.map(([kind, line]) => `<div class="dl ${kind}"><span>${esc(line)}</span></div>`).join('')
    + (rows.length > visible.length ? `<div class="dl m">${esc(t('diff.more', { n: rows.length - visible.length }))}</div>` : '');
}

function renderPrompt() {
  const screen = state.screen;
  if (!screen) return;
  const project = state.project;
  if (textarea.value !== project.text) textarea.value = project.text ?? '';
  $('reset').hidden = project.text === project.generated;
  renderDiff();
}

/** Everything except the interface itself, which stays as it is loaded. */
function renderAround() {
  renderToolbar();
  renderRail();
  renderPrompt();
}

function select(screen, { open = null } = {}) {
  state.screen = screen;
  state.open = open;
  state.preview = null;
  screen.assets.scheme = state.scheme;
  // With no pick anywhere the prompt speaks of the screen that is shown.
  rewrite();
  preview.load(screen.analysis, screen.assets, screen.choices, screen.title);
  preview.view(open, Object.keys(screen.choices));
  renderAround();
  renderPop();
}

// ---------- the sample ----------

function loadSample({ hint = false } = {}) {
  state.run += 1;
  hideOverlay();
  $('er').hidden = true;
  const project = sampleProject(getLang());
  const before = kept(project);
  for (const screen of project.screens) prepare(screen, before?.screens[screen.id]?.choices);
  project.restored = before;
  state.project = project;
  const first = project.screens[0];
  state.screen = first;
  // One choice is already made and one area is open, so that the first look shows how it works;
  // a person who has been here before finds their own picks instead.
  if (hint && !before) choose('sections', 'cards');
  select(first, { open: hint && window.matchMedia('(min-width: 861px)').matches ? 'sections' : null });
}

function forgetRepo() {
  const url = new URL(location.href);
  if (!url.searchParams.has('repo')) return;
  url.searchParams.delete('repo');
  history.replaceState(null, '', url);
}

// ---------- analysis ----------

let sceneTimer = null;
let sceneIndex = 0;
const scenes = [...document.querySelectorAll('#scn .sc')];
const nextSteps = [...document.querySelectorAll('#nx li')];

function showScene(index) {
  sceneIndex = index;
  for (const scene of scenes) scene.classList.remove('on');
  void $('scn').offsetWidth; // restart the animations of the scene that comes on
  scenes[index].classList.add('on');
  nextSteps.forEach((item, i) => item.classList.toggle('on', i === index));
}

function showOverlay() {
  $('er').hidden = true;
  if (!$('ov').hidden) return;
  closePop();
  $('ov').hidden = false;
  showScene(0);
  clearInterval(sceneTimer);
  sceneTimer = setInterval(() => showScene((sceneIndex + 1) % scenes.length), SCENE_MS);
}

function hideOverlay() {
  $('ov').hidden = true;
  clearInterval(sceneTimer);
  sceneTimer = null;
  $('try').querySelector('button').disabled = false;
}

let step = null;
function setStep(name, values) {
  step = { name, values };
  const index = STEPS.indexOf(name);
  $('anst').textContent = t(`an.${name}`, values);
  $('ann').textContent = `${index + 1}/${STEPS.length}`;
  $('anbar').style.width = `${((index + 1) / STEPS.length) * 100 - 6}%`;
}

const ERROR_KEYS = {
  bad_input: 'err.bad_input', not_found: 'err.not_found', network: 'err.network', github: 'err.github', empty: 'err.empty',
  no_screens: 'err.no_screens', not_configured: 'err.not_configured', busy: 'err.busy', offline: 'err.offline',
  file_not_found: 'err.file', file_too_small: 'err.file',
};

function showError(error) {
  hideOverlay();
  const code = error instanceof RepoError ? error.code : 'failed';
  let message;
  if (code === 'rate_limited') message = error.detail ? t('err.rate_limited', { n: error.detail }) : t('err.rate_limited_soon');
  else message = t(ERROR_KEYS[code] ?? 'err.failed');
  if (!(error instanceof RepoError)) console.error(error);
  $('ermsg').textContent = message;
  $('erretry').hidden = code === 'bad_input' || code === 'not_found' || code === 'not_configured' || code === 'no_screens';
  $('er').hidden = false;
}

function boardUrl(project, screen, files) {
  const params = new URLSearchParams({ repo: `${project.repo.owner}/${project.repo.name}`, ref: project.repo.ref, path: screen.path, lang: getLang() });
  for (const path of files.related) params.append('rel', path);
  for (const path of files.styles) params.append('css', path);
  if (project.stack.length) params.set('stack', project.stack.join(', '));
  if (project.scan.treeSha) params.set('v', project.scan.treeSha.slice(0, 12));
  // An answer that failed is kept by the CDN under its address: asking again needs another one.
  params.set('try', String(screen.tries));
  return `${API_BASE}/api/storyboard?${params}`;
}

const DRAW_EVERY_MS = 180;
/** All the markup of an answer so far, to look for the icons it names. */
const markupOf = (board) => board.page + [...board.areas.values()].map((a) => a.options.map((o) => o.html).join('')).join('');

/**
 * Analyzes a screen and shows it while the answer is written: the page first, then each area as
 * it becomes a choice. The answer is read to its end even when the person has moved on to
 * another screen meanwhile; coming back to it picks it up where it is.
 */
async function analyzeScreen(screen, run = ++state.run) {
  if (screen.status === 'ready') {
    hideOverlay();
    $('er').hidden = true;
    select(screen);
    return;
  }
  if (screen.status === 'loading' && screen.resume) {
    screen.resume(run);
    return;
  }
  const project = state.project;
  const fallbackTitle = screen.title;
  let board = null;
  let showing = false; // the screen has taken the stage at least once
  let timer = null;
  // A run that nobody watches (run 0: a screen read ahead) shows nothing until it is come back to.
  const watched = () => run !== 0 && run === state.run;
  const wait = () => {
    if (!watched()) return;
    state.retry = () => analyzeScreen(screen);
    showOverlay();
    setStep(board?.plan.length ? 'draw' : 'read', { file: screen.path.split('/').slice(-2).join('/') });
  };
  if (screen.status === 'stored') {
    // Kept from an earlier visit: only the project's styles are fetched again.
    screen.status = 'loading';
    screen.resume = (again) => { run = again; wait(); };
    wait();
    renderRail();
    try {
      const files = await collectFiles(project.scan, screen.path);
      screen.assets = files.assets;
      await loadIcons(iconsIn(screen.analysis.page + screen.analysis.areas.map((a) => a.options.map((o) => o.html).join('')).join('')));
      screen.status = 'ready';
      screen.resume = null;
      if (watched()) {
        hideOverlay();
        select(screen);
      } else renderRail();
      readAhead();
      return;
    } catch {
      // The styles did not come: the screen is analyzed anew.
      screen.analysis = null;
      screen.choices = {};
    }
  }
  screen.failed = false;
  screen.status = 'loading';
  screen.tries = (screen.tries ?? 0) + 1;
  screen.resume = (again) => {
    run = again;
    if (showing) {
      hideOverlay();
      $('er').hidden = true;
      select(screen);
    } else wait();
  };
  wait();
  renderRail();

  const current = () => ({ ...assemble(board, fallbackTitle), pageDone: board.pageDone });
  // Shows what has arrived. The first time, the screen takes the stage; after that it grows in place.
  const draw = () => {
    clearTimeout(timer);
    timer = null;
    if (!watched() || !board) return;
    const analysis = current();
    if (!/<[a-z]/i.test(analysis.page)) return;
    const asked = iconsIn(markupOf(board));
    if (asked.length) loadIcons(asked).then((found) => found && draw());
    if (analysis.screen.title) screen.title = analysis.screen.title;
    if (!showing) {
      showing = true;
      screen.analysis = analysis;
      prepare(screen);
      hideOverlay();
      select(screen);
      return;
    }
    grow(screen, analysis);
    if (state.screen !== screen) return;
    if (state.open && !analysis.areas.some((a) => a.id === state.open)) closePop();
    preview.update(analysis, shown());
    renderAround();
  };
  const soon = () => { timer ??= setTimeout(draw, DRAW_EVERY_MS); };

  try {
    const files = await collectFiles(project.scan, screen.path);
    screen.assets = files.assets;
    // A failure that comes at once is one the CDN kept: the next address is asked instead.
    for (let attempt = 0; ; attempt += 1) {
      board = newBoard(screen.path);
      try {
        await streamBoard(boardUrl(project, screen, files), (event) => {
          if (event.t === 'plan' && watched() && !showing) setStep('draw');
          if (take(board, event)) soon();
        });
        // An answer in which no area found its place in the page is asked for once more.
        if (attempt === 0 && !current().areas.length) {
          screen.tries += 1;
          continue;
        }
        break;
      } catch (error) {
        // What arrived before the answer broke off is kept when it is enough to work with.
        board.done = true;
        if (showing && current().areas.length) break;
        if (!(error.fast && attempt < 2 && !showing)) throw error;
        screen.tries += 1;
      }
    }
    clearTimeout(timer);
    timer = null;
    const analysis = current();
    if (!analysis.areas.length) throw new RepoError('failed');
    await loadIcons(iconsIn(markupOf(board)));
    screen.status = 'ready';
    screen.resume = null;
    if (analysis.screen.title) screen.title = analysis.screen.title;
    if (showing) grow(screen, analysis);
    else {
      screen.analysis = analysis;
      prepare(screen);
    }
    if (state.project?.screens.includes(screen)) rewrite();
    readAhead();
    if (!watched()) {
      renderRail();
      return;
    }
    if (!showing || state.screen !== screen) {
      hideOverlay();
      select(screen);
      return;
    }
    if (state.open && !analysis.areas.some((a) => a.id === state.open)) closePop();
    preview.update(analysis, shown());
    renderAround();
  } catch (error) {
    clearTimeout(timer);
    screen.status = 'idle';
    screen.resume = null;
    // A screen that failed is not read ahead a second time; asking for it tries again.
    screen.failed = true;
    renderRail();
    if (watched()) showError(error);
    readAhead();
  }
}

/**
 * Reads the next screen of the project ahead, one at a time, while the person is busy with the
 * one that is shown: going to another screen then finds it there. Not while the page is hidden.
 */
function readAhead() {
  const project = state.project;
  if (!project || project.sample || document.hidden) return;
  if (project.screens.some((s) => s.status === 'loading')) return;
  const next = project.screens.find((s) => s.status === 'stored') ?? project.screens.find((s) => s.status === 'idle' && !s.failed);
  if (next) analyzeScreen(next, 0);
}
document.addEventListener('visibilitychange', readAhead);

async function analyzeRepo(input) {
  const run = ++state.run;
  state.retry = () => analyzeRepo(input);
  $('try').querySelector('button').disabled = true;
  showOverlay();
  setStep('tree');
  try {
    const scan = await scanRepo(input, (name) => run === state.run && setStep(name));
    if (run !== state.run) return;
    state.project = { sample: false, repo: scan.repo, stack: scan.stack, scan, screens: scan.screens.map((s) => ({ ...s, status: 'idle' })) };
    state.screen = null;
    // What was analyzed and picked on an earlier visit, for the same state of the repository's files.
    const before = kept(state.project);
    for (const screen of state.project.screens) {
      const was = before?.screens[screen.id];
      if (!was?.analysis?.areas?.length || typeof was.analysis.page !== 'string') continue;
      screen.analysis = was.analysis;
      screen.title = was.title || screen.title;
      prepare(screen, was.choices);
      screen.status = 'stored';
    }
    state.project.restored = before;
    $('rname').textContent = `${scan.repo.owner}/${scan.repo.name}`;
    $('rsub').textContent = scan.repo.sub ? `/${scan.repo.sub}` : '';
    $('rtag').hidden = true;
    $('pips').innerHTML = '';
    $('pcount').textContent = '';
    renderRail();
    const url = new URL(location.href);
    url.searchParams.set('repo', `${scan.repo.owner}/${scan.repo.name}${scan.repo.sub ? `/tree/${scan.repo.ref}/${scan.repo.sub}` : ''}`);
    history.replaceState(null, '', url);
    await analyzeScreen(state.project.screens[0], run);
  } catch (error) {
    if (run === state.run) showError(error);
  }
}

// ---------- events ----------

$('try').addEventListener('submit', (event) => {
  event.preventDefault();
  const value = $('repo').value.trim();
  if (!value) {
    $('repo').focus();
    return;
  }
  $('playground').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  analyzeRepo(value);
});

$('sample').addEventListener('click', () => {
  forgetRepo();
  loadSample();
  $('playground').scrollIntoView({ behavior: 'smooth', block: 'nearest' });
});
$('ersample').addEventListener('click', () => {
  const ready = !state.project?.sample && state.project?.screens.find((s) => s.status === 'ready');
  if (ready) {
    state.run += 1;
    $('er').hidden = true;
    select(ready);
  } else {
    forgetRepo();
    loadSample();
  }
});
$('erretry').addEventListener('click', () => state.retry?.());

$('screens').addEventListener('click', (event) => {
  const button = event.target.closest('[data-screen]');
  const screen = button && state.project.screens.find((s) => s.id === button.dataset.screen);
  if (!screen || (screen === state.screen && screen.status !== 'idle')) return;
  if (screen.status === 'ready') {
    state.run += 1;
    select(screen);
  } else analyzeScreen(screen);
});

function pointAt(option) {
  if (!option || !state.open) return;
  if (state.preview?.option === option.dataset.option) return;
  state.preview = { area: state.open, option: option.dataset.option };
  syncStage();
  renderDiff();
}
function pointAway() {
  if (!state.preview) return;
  state.preview = null;
  syncStage();
  renderDiff();
}
pop.addEventListener('mouseover', (event) => pointAt(event.target.closest('.opt')));
pop.addEventListener('focusin', (event) => pointAt(event.target.closest('.opt')));
pop.addEventListener('mouseleave', pointAway);
pop.addEventListener('focusout', (event) => { if (!pop.contains(event.relatedTarget)) pointAway(); });
pop.addEventListener('click', (event) => {
  const option = event.target.closest('.opt');
  if (!option || !state.open) return;
  event.stopPropagation();
  choose(state.open, option.dataset.option);
  state.preview = null;
  syncStage();
  markSelection();
  renderAround();
});

document.addEventListener('click', (event) => {
  if (state.open && !event.target.closest('.pop')) closePop();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !state.open) return;
  const id = state.open;
  closePop();
  preview.focusDot(id);
});
window.addEventListener('resize', placePop);

function setDevice(device) {
  for (const button of $('seg').children) button.classList.toggle('on', button.dataset.w === device);
  closePop();
  stage.classList.toggle('phone', device === 'phone');
  preview.setNarrow(device === 'phone');
}
$('scheme').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button || button.dataset.s === state.scheme) return;
  state.scheme = button.dataset.s;
  if (state.screen) select(state.screen);
});
$('seg').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (button) setDevice(button.dataset.w);
});

textarea.addEventListener('input', () => {
  if (!state.screen) return;
  state.project.text = textarea.value;
  $('reset').hidden = state.project.text === state.project.generated;
  save(state.project);
});
$('reset').addEventListener('click', () => {
  state.project.text = state.project.generated;
  save(state.project);
  renderPrompt();
});

async function copyText(text) {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement('textarea');
    helper.value = text;
    helper.style.cssText = 'position:fixed;opacity:0';
    document.body.append(helper);
    helper.select();
    let done = false;
    try { done = document.execCommand('copy'); } catch { /* nothing more to try */ }
    helper.remove();
    return done;
  }
}
function flash(button) {
  const label = button.querySelector('span');
  const key = label.dataset.i18n;
  label.textContent = t('copied');
  button.classList.add('ok');
  setTimeout(() => {
    label.textContent = t(key);
    button.classList.remove('ok');
  }, 1400);
}
$('copy').addEventListener('click', async (event) => {
  const button = event.currentTarget;
  if (await copyText(textarea.value)) flash(button);
});
for (const button of document.querySelectorAll('[data-copy]')) {
  button.addEventListener('click', async () => {
    if (await copyText(button.dataset.copy)) flash(button);
  });
}

for (const button of document.querySelectorAll('[data-lang]')) {
  button.addEventListener('click', () => {
    if (button.dataset.lang === getLang()) return;
    setLang(button.dataset.lang);
    const project = state.project;
    if (project.sample) {
      // The sample exists in both languages: its words are swapped, its interface stays as it is.
      const fresh = sampleProject(getLang());
      const current = state.screen?.id;
      for (const screen of fresh.screens) prepare(screen, project.screens.find((s) => s.id === screen.id)?.choices);
      state.project = fresh;
      state.screen = fresh.screens.find((s) => s.id === current) ?? fresh.screens[0];
    } else {
      // An analysis keeps the language it was made in; the prompt around it follows the page.
      project.text = undefined;
      project.last = null;
    }
    rewrite();
    if (state.screen) {
      const open = state.open;
      state.preview = null;
      renderAround();
      renderPop();
      if (open) placePop();
    }
    if (!$('ov').hidden && step) setStep(step.name, step.values);
  });
}

// ---------- start ----------

initLang();
// On a phone the page is shown as a phone shows it; a desktop layout would be too small to read.
if (window.matchMedia('(max-width: 720px)').matches) setDevice('phone');
const asked = new URLSearchParams(location.search).get('repo');
loadSample({ hint: !asked });
if (asked && parseRepo(asked)) {
  $('repo').value = asked.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  analyzeRepo(asked);
}
