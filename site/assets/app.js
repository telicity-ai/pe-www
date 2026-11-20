import { API_BASE } from './config.js';
import { RepoError, parseRepo, relatedFiles, scanRepo } from './github.js';
import { getLang, initLang, setLang, t } from './i18n.js';
import { buildPrompt, diffPrompt, mergePrompt } from './prompt.js';
import { sampleProject } from './sample.js';
import { esc, renderPage, renderThumb } from './wire.js';

const $ = (id) => document.getElementById(id);
const frame = $('frame');
const pop = $('pop');
const stage = $('stage');
const textarea = $('prompt');

const STEPS = ['tree', 'stack', 'screens', 'read', 'match', 'draw'];
const SCENE_MS = 2950;
const MIN_OVERLAY_MS = 900;

const state = {
  project: null,
  screen: null,
  open: null, // id of the area whose options are showing
  preview: null, // { area, option } while an option is pointed at
  run: 0, // increases with every analysis; an answer for an older run is dropped
  retry: null,
};

// ---------- a screen and its prompt ----------

function prepare(screen, choices = {}) {
  const valid = {};
  for (const area of screen.analysis.areas) {
    if (area.options.some((o) => o.id === choices[area.id])) valid[area.id] = choices[area.id];
  }
  screen.choices = valid;
  screen.generated = buildPrompt(screen.analysis, valid, getLang());
  screen.text = screen.generated;
  screen.last = null;
}

function choose(areaId, optionId) {
  const screen = state.screen;
  const before = screen.generated;
  if (screen.choices[areaId] === optionId) delete screen.choices[areaId];
  else screen.choices[areaId] = optionId;
  const after = buildPrompt(screen.analysis, screen.choices, getLang());
  screen.text = mergePrompt(screen.text, before, after);
  screen.generated = after;
  const change = diffPrompt(before, after);
  if (change.added.length || change.removed.length) screen.last = change;
}

// ---------- drawing ----------

function context() {
  const screen = state.screen;
  return {
    pick: (id) => (state.preview?.area === id ? state.preview.option : screen.choices[id]),
    chosen: (id) => Boolean(screen.choices[id]),
    open: state.open,
  };
}

function renderStage() {
  if (!state.screen) return;
  const top = frame.scrollTop;
  frame.innerHTML = renderPage(state.screen.analysis, context());
  frame.scrollTop = top;
}

function renderPop() {
  const screen = state.screen;
  const area = screen?.analysis.areas.find((a) => a.id === state.open);
  if (!area) {
    pop.className = 'pop';
    pop.innerHTML = '';
    return;
  }
  const thumbContext = { pick: (id) => screen.choices[id], chosen: () => false };
  const options = area.options.map((option) => {
    const selected = screen.choices[area.id] === option.id;
    return `<button type="button" class="opt${selected ? ' sel' : ''}" data-option="${esc(option.id)}" aria-pressed="${selected}">${
      option.suggested ? `<i class="star" title="${esc(t('pop.suggested'))}">★</i>` : ''
    }<div class="th">${renderThumb(screen.analysis, area, option, thumbContext)}${option.keep ? `<span class="now">${esc(t('pop.now'))}</span>` : ''}</div><span>${esc(option.label)}</span></button>`;
  }).join('');
  const reason = area.options.find((o) => o.suggested && o.because)?.because;
  pop.setAttribute('aria-label', area.label);
  pop.innerHTML = `<div class="pop-h">${esc(area.label)}</div><div class="pop-o">${options}</div>${reason ? `<div class="pop-why"><b>★</b><span>${esc(reason)}</span></div>` : ''}`;
  pop.className = 'pop show';
  fitThumbs();
}

/** Draws each option as large as its picture allows: a row of buttons fills the frame instead of sitting in a corner. */
function fitThumbs() {
  for (const thumb of pop.querySelectorAll('.th')) {
    const inner = thumb.firstElementChild;
    const width = thumb.clientWidth;
    const height = thumb.clientHeight;
    let scale = 0.4;
    for (const candidate of [1, 0.8, 0.64, 0.5, 0.4]) {
      inner.style.width = `${width / candidate}px`;
      scale = candidate;
      if (inner.scrollHeight * candidate <= height) break;
    }
    inner.style.transform = `scale(${scale})`;
    const spare = height - inner.scrollHeight * scale;
    inner.style.marginTop = spare > 0 ? `${spare / 2}px` : '0';
  }
}

/** Puts the options under their dot, or above it when there is no room, and keeps them inside the stage. */
function placePop() {
  if (!state.open) return;
  const dot = frame.querySelector(`[data-dot="${CSS.escape(state.open)}"]`);
  if (!dot) return;
  const outer = stage.getBoundingClientRect();
  const port = frame.getBoundingClientRect();
  const at = dot.getBoundingClientRect();
  if (at.bottom < port.top || at.top > port.bottom) {
    pop.style.visibility = 'hidden';
    return;
  }
  pop.style.visibility = '';
  const width = pop.offsetWidth;
  const height = pop.offsetHeight;
  const left = Math.max(8, Math.min(at.right - outer.left - width + 6, outer.width - width - 8));
  let top = at.bottom - outer.top + 12;
  if (top + height > outer.height - 6) top = Math.max(6, at.top - outer.top - height - 12);
  pop.style.left = `${left}px`;
  pop.style.top = `${top}px`;
}

function renderToolbar() {
  const project = state.project;
  const repo = project.repo;
  $('rname').textContent = `${repo.owner}/${repo.name}`;
  $('rsub').textContent = repo.sub ? `/${repo.sub}` : '';
  $('rtag').hidden = !project.sample;
  const areas = state.screen?.analysis.areas ?? [];
  const chosen = areas.filter((a) => state.screen.choices[a.id]).length;
  $('pips').innerHTML = areas.map((a) => `<i class="${state.screen.choices[a.id] ? 'f' : ''}"></i>`).join('');
  $('pcount').textContent = areas.length ? t('pg.chosen', { n: chosen, m: areas.length }) : '';
}

function renderRail() {
  const project = state.project;
  $('screens').innerHTML = project.screens.map((screen) => {
    const badge = screen.status === 'loading' ? '<b class="spin"></b>' : screen.analysis ? `<b>${screen.analysis.areas.length}</b>` : '';
    return `<button type="button" class="scr${screen === state.screen ? ' on' : ''}" data-screen="${esc(screen.id)}" title="${esc(screen.path)}">${badge}${esc(screen.title)}<small>${esc(screen.path)}</small></button>`;
  }).join('');
  $('stack').innerHTML = project.stack.map((item) => `<span>${esc(item)}</span>`).join('');
}

function renderDiff() {
  const screen = state.screen;
  if (!screen) return;
  let change = screen.last;
  let previewing = false;
  if (state.preview) {
    const choices = { ...screen.choices, [state.preview.area]: state.preview.option };
    change = diffPrompt(screen.generated, buildPrompt(screen.analysis, choices, getLang()));
    previewing = true;
  }
  const box = $('df');
  const head = (label, counts = '') => `<div class="dfh${previewing ? ' pv' : ''}">${esc(label)}${counts}</div>`;
  if (!change || (!change.added.length && !change.removed.length)) {
    box.innerHTML = head(t(previewing ? 'diff.preview' : 'diff.changes')) + `<div class="dl m">${esc(t(previewing ? 'diff.same' : 'diff.none'))}</div>`;
    return;
  }
  const rows = [...change.removed.map((line) => ['r', line]), ...change.added.map((line) => ['a', line])];
  const shown = rows.slice(0, 4);
  box.innerHTML = head(t(previewing ? 'diff.preview' : 'diff.last'), `<b>+${change.added.length}</b><s>−${change.removed.length}</s>`)
    + shown.map(([kind, line]) => `<div class="dl ${kind}"><span>${esc(line)}</span></div>`).join('')
    + (rows.length > shown.length ? `<div class="dl m">${esc(t('diff.more', { n: rows.length - shown.length }))}</div>` : '');
}

function renderPrompt() {
  const screen = state.screen;
  if (!screen) return;
  if (textarea.value !== screen.text) textarea.value = screen.text;
  $('reset').hidden = screen.text === screen.generated;
  renderDiff();
}

function renderAll() {
  renderToolbar();
  renderRail();
  renderStage();
  renderPop();
  placePop();
  renderPrompt();
}

function closePop() {
  if (!state.open && !state.preview) return;
  state.open = null;
  state.preview = null;
  renderStage();
  renderPop();
  renderDiff();
}

function select(screen) {
  state.screen = screen;
  state.open = null;
  state.preview = null;
  frame.scrollTop = 0;
  renderAll();
}

// ---------- the sample ----------

function loadSample({ hint = false } = {}) {
  state.run += 1;
  hideOverlay();
  $('er').hidden = true;
  const project = sampleProject(getLang());
  for (const screen of project.screens) prepare(screen);
  state.project = project;
  const first = project.screens[0];
  state.screen = first;
  // One choice is already made and one area is open, so that the first look shows how it works.
  if (hint) choose('sections', 'cards');
  select(first);
  if (hint && window.matchMedia('(min-width: 861px)').matches) {
    state.open = 'sections';
    renderStage();
    renderPop();
    placePop();
  }
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

let overlaySince = 0;
function showOverlay() {
  $('er').hidden = true;
  if (!$('ov').hidden) return;
  closePop();
  $('ov').hidden = false;
  overlaySince = Date.now();
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

async function requestAnalysis(project, screen, related) {
  const params = new URLSearchParams({ repo: `${project.repo.owner}/${project.repo.name}`, ref: project.repo.ref, path: screen.path, lang: getLang() });
  for (const path of related) params.append('rel', path);
  if (project.stack.length) params.set('stack', project.stack.join(', '));
  if (project.scan.treeSha) params.set('v', project.scan.treeSha.slice(0, 12));
  let response;
  try {
    response = await fetch(`${API_BASE}/api/analyze?${params}`);
  } catch {
    throw new RepoError('offline');
  }
  let body = null;
  try { body = await response.json(); } catch { /* not JSON: handled below */ }
  if (!response.ok || !body?.ok) throw new RepoError(body?.code ?? (response.status === 404 ? 'offline' : 'failed'));
  return body;
}

async function analyzeScreen(screen, run = ++state.run) {
  if (screen.status === 'ready') {
    hideOverlay();
    $('er').hidden = true;
    select(screen);
    return;
  }
  const project = state.project;
  state.retry = () => analyzeScreen(screen);
  showOverlay();
  setStep('read', { file: screen.path.split('/').slice(-2).join('/') });
  screen.status = 'loading';
  renderRail();
  const timers = [setTimeout(() => run === state.run && setStep('match'), 3500), setTimeout(() => run === state.run && setStep('draw'), 9000)];
  try {
    const related = await relatedFiles(project.scan, screen.path);
    const answer = await requestAnalysis(project, screen, related);
    screen.analysis = { screen: { ...answer.screen, title: answer.screen.title || screen.title }, page: answer.page, areas: answer.areas };
    screen.title = screen.analysis.screen.title;
    screen.lang = getLang();
    screen.status = 'ready';
    prepare(screen);
    const wait = MIN_OVERLAY_MS - (Date.now() - overlaySince);
    if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
    if (run !== state.run) return;
    hideOverlay();
    select(screen);
  } catch (error) {
    screen.status = 'idle';
    if (run !== state.run) return;
    renderRail();
    showError(error);
  } finally {
    timers.forEach(clearTimeout);
  }
}

async function analyzeRepo(input) {
  const run = ++state.run;
  state.retry = () => analyzeRepo(input);
  $('try').querySelector('button').disabled = true;
  showOverlay();
  setStep('tree');
  try {
    const scan = await scanRepo(input, (step) => run === state.run && setStep(step));
    if (run !== state.run) return;
    state.project = { sample: false, repo: scan.repo, stack: scan.stack, scan, screens: scan.screens.map((s) => ({ ...s, status: 'idle' })) };
    state.screen = null;
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
  if (!screen || screen === state.screen) return;
  if (screen.status === 'ready') select(screen);
  else analyzeScreen(screen);
});

frame.addEventListener('click', (event) => {
  const dot = event.target.closest('.dot');
  if (!dot) return;
  event.stopPropagation();
  state.open = state.open === dot.dataset.dot ? null : dot.dataset.dot;
  state.preview = null;
  renderStage();
  renderPop();
  placePop();
  renderDiff();
  if (state.open && event.detail === 0) pop.querySelector('.opt')?.focus(); // opened from the keyboard
});

function pointAt(option) {
  if (!option || !state.open) return;
  if (state.preview?.option === option.dataset.option) return;
  state.preview = { area: state.open, option: option.dataset.option };
  renderStage();
  renderDiff();
}
function pointAway() {
  if (!state.preview) return;
  state.preview = null;
  renderStage();
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
  const id = option.dataset.option;
  choose(state.open, id);
  state.preview = null;
  renderToolbar();
  renderRail();
  renderStage();
  renderPop();
  placePop();
  renderPrompt();
  pop.querySelector(`[data-option="${CSS.escape(id)}"]`)?.focus({ preventScroll: true });
});

document.addEventListener('click', (event) => {
  if (state.open && !event.target.closest('.pop')) closePop();
});
document.addEventListener('keydown', (event) => {
  if (event.key !== 'Escape' || !state.open) return;
  const id = state.open;
  closePop();
  frame.querySelector(`[data-dot="${CSS.escape(id)}"]`)?.focus();
});
frame.addEventListener('scroll', placePop, { passive: true });
window.addEventListener('resize', placePop);

$('seg').addEventListener('click', (event) => {
  const button = event.target.closest('button');
  if (!button) return;
  for (const other of $('seg').children) other.classList.toggle('on', other === button);
  stage.classList.toggle('phone', button.dataset.w === 'phone');
  closePop();
  // The frame changes width with a transition; the options are placed again once it is done.
  setTimeout(placePop, 280);
});

textarea.addEventListener('input', () => {
  if (!state.screen) return;
  state.screen.text = textarea.value;
  $('reset').hidden = state.screen.text === state.screen.generated;
});
$('reset').addEventListener('click', () => {
  state.screen.text = state.screen.generated;
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
  if (await copyText(textarea.value)) flash(event.currentTarget);
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
      // The sample exists in both languages: swap it and keep what was chosen.
      const fresh = sampleProject(getLang());
      const current = state.screen?.id;
      for (const screen of fresh.screens) prepare(screen, project.screens.find((s) => s.id === screen.id)?.choices);
      state.project = fresh;
      state.screen = fresh.screens.find((s) => s.id === current) ?? fresh.screens[0];
    } else {
      // An analysis keeps the language it was made in; the prompt around it follows the page.
      for (const screen of project.screens) if (screen.analysis) prepare(screen, screen.choices);
    }
    state.open = null;
    state.preview = null;
    if (state.screen) renderAll();
    if (!$('ov').hidden && step) setStep(step.name, step.values);
  });
}

// ---------- start ----------

initLang();
loadSample({ hint: true });
if (document.fonts?.ready) document.fonts.ready.then(placePop);
window.addEventListener('load', placePop);

const asked = new URLSearchParams(location.search).get('repo');
if (asked && parseRepo(asked)) {
  $('repo').value = asked.replace(/^(https?:\/\/)?(www\.)?github\.com\//i, '');
  analyzeRepo(asked);
}
