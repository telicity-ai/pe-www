import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Piece, Reader, SOURCE_CODE, asHtml, planArea } from '../api/_lib/answer.js';
import { DECISIONS, PATTERNS } from '../api/_lib/catalog.js';
import { optionTask, pageTask, systemPrompt, todayTask } from '../api/_lib/brief.js';
import { newBoard, take } from '../site/assets/board.js';

/** Feeds text to a reader in pieces of `size` characters and returns what it made of it. */
function read(text, size) {
  const out = [];
  const reader = new Reader((name, rest) => out.push(['marker', name, rest]), (piece) => {
    if (out.at(-1)?.[0] === 'text') out.at(-1)[1] += piece;
    else out.push(['text', piece]);
  });
  for (let i = 0; i < text.length; i += size) reader.push(text.slice(i, i + size));
  reader.end();
  return out;
}

test('markers are found however the text is cut into pieces', () => {
  const text = '```\n@@AREA a | - | checkbox | <div> in X\n@@PAGE\n<div>\n  <p>a@@b</p>\n@@AREA a\n</div>\n@@TITLE Home\n@@END\n```';
  const whole = read(text, text.length);
  assert.deepEqual(whole, [
    ['marker', 'AREA', 'a | - | checkbox | <div> in X'],
    ['marker', 'PAGE', ''],
    ['text', '<div>\n  <p>a@@b</p>\n'],
    ['marker', 'AREA', 'a'],
    ['text', '</div>\n'],
    ['marker', 'TITLE', 'Home'],
    ['marker', 'END', ''],
  ]);
  for (const size of [1, 2, 3, 7]) assert.deepEqual(read(text, size), whole, `in pieces of ${size}`);
});

test('text is passed on before its line has ended', () => {
  const out = [];
  const reader = new Reader(() => {}, (piece) => out.push(piece));
  reader.push('<div class="a">');
  assert.deepEqual(out, ['<div class="a">']);
  reader.push('@@END is text here\n@');
  assert.equal(out.join(''), '<div class="a">@@END is text here\n');
});

test('a line of the plan names an area, its patterns and where it is', () => {
  const seen = new Set();
  const area = planArea('Save Bar | save-settings | sticky-save-bar, nope, sticky-header | <div className={cn("a", x || y)}> in Page', seen);
  assert.deepEqual(area, {
    id: 'save-bar',
    wanted: 'save-bar',
    where: '<div className={cn("a", x || y)}> in Page',
    options: [{ id: 'sticky-save-bar', pattern: 'sticky-save-bar' }, { id: 'sticky-header', pattern: 'sticky-header' }],
    decision: 'save-settings',
  });
  assert.equal(planArea('save-bar | - | checkbox | again', seen), null, 'the same area twice');
  assert.equal(planArea('other | - | no-such-pattern | x', seen), null, 'no pattern of the catalog');
});

function piece(area, option, text) {
  const answer = new Piece(area, option);
  const reader = new Reader((name, rest) => answer.marker(name, rest), (part) => answer.text(part));
  reader.push(text);
  reader.end();
  return answer.result();
}

test('the answer about an area as it is today gives its label, its element and the suggestion', () => {
  const area = planArea('save | save-settings | sticky-save-bar, sticky-header | <div> in Page', new Set());
  const events = piece(area, null, '@@LABEL Where Save sits\n@@NOW At the end of the page\n@@HTML\n<div><button>Save</button></div>\n<script>alert(1)</script>\n@@SUGGEST sticky-save-bar | The list is long.\n@@END\nmore');
  assert.deepEqual(events, [
    { t: 'area', id: 'save', label: 'Where Save sits', decision: 'save-settings' },
    { t: 'option', area: 'save', id: 'keep', keep: true, label: 'At the end of the page', html: '<div><button>Save</button></div>' },
    { t: 'suggest', area: 'save', id: 'sticky-save-bar', because: 'The list is long.' },
  ]);
  assert.equal(piece(area, null, '@@LABEL x\n@@NOW y\n@@END'), null, 'no HTML');
});

test('the answer about an option gives its label and its element', () => {
  const area = planArea('save | - | sticky-save-bar | <div> in Page', new Set());
  assert.deepEqual(piece(area, area.options[0], '@@OPTION A bar that stays at the bottom\n@@HTML\n<div class="sticky">Save</div>\n@@END'), [
    { t: 'option', area: 'save', id: 'sticky-save-bar', pattern: 'sticky-save-bar', label: 'A bar that stays at the bottom', html: '<div class="sticky">Save</div>' },
  ]);
});

test('source code is told from HTML', () => {
  for (const html of ['<div class="a [&_svg]:size-4 data-[state=open]:b">{"key":"value"}</div>', '<p>Use {name} here, a@b.com at 12:30</p>', '<svg data-icon="lucide:x" viewBox="0 0 24 24"></svg>']) {
    assert.equal(SOURCE_CODE.test(html), false, html);
  }
  for (const code of ['<Button className="a">', '<div class="a">{isActive && <span>x</span>}</div>', '<li class:active={x}>', '<a :class="x">', '<div v-if="x">', '{#if user}<a>', '{items.map((i) => <li>{i}</li>)}']) {
    assert.equal(SOURCE_CODE.test(code), true, code);
  }
  assert.equal(asHtml('<div className="a">{open && (<span>x</span>)}{label}</div>'), '<div class="a"><span>x</span></div>');
});

test('the examples in the instructions use the catalog and the form they describe', () => {
  const patterns = new Set(PATTERNS.map((p) => p.id));
  const decisions = new Set(DECISIONS.map((d) => d.id));
  const task = pageTask();
  const example = task.slice(task.indexOf('EXAMPLE'));
  const lines = example.split('\n').filter((line) => line.startsWith('@@AREA') && line.includes('|'));
  assert.equal(lines.length, 2);
  const seen = new Set();
  for (const line of lines) {
    const area = planArea(line.slice('@@AREA'.length), seen);
    assert.equal(area.options.length, 2, line);
    assert.ok(decisions.has(area.decision), line);
    assert.match(example, new RegExp(`\\n@@AREA ${area.id}\\n`), 'the area has its place in the page');
    assert.match(todayTask(area), /@@SUGGEST checkbox \|/);
    assert.match(optionTask(area, area.options[0]), new RegExp(area.options[0].pattern));
  }
  assert.ok(patterns.has('checkbox'));
  assert.doesNotMatch(systemPrompt('en') + task, /<path\s+d=/, 'no drawing of an icon in the instructions');
  assert.match(systemPrompt('ko'), /Korean/);
});

test('the page puts the lines of an answer together', () => {
  const board = newBoard('src/Page.tsx');
  const lines = [
    { t: 'plan', areas: [{ id: 'save', options: ['sticky-save-bar'] }] },
    { t: 'page', text: '<main><h1>T</h1>' },
    { t: 'page', text: '<pe-area id="save"></pe-area></main>' },
    { t: 'page-end' },
    { t: 'screen', title: 'Settings', summary: 'S' },
    { t: 'area', id: 'save', label: 'Where Save sits' },
    { t: 'option', area: 'save', id: 'keep', keep: true, label: 'At the end', html: '<div>Save</div>' },
    { t: 'option', area: 'save', id: 'sticky-save-bar', pattern: 'sticky-save-bar', label: 'A bar', html: '<div class="bar">Save</div>' },
    { t: 'suggest', area: 'save', id: 'sticky-save-bar', because: 'Long list.' },
    { t: 'done' },
  ];
  for (const line of lines) take(board, line);
  assert.equal(board.page, '<main><h1>T</h1><pe-area id="save"></pe-area></main>');
  assert.equal(board.done, true);
  const area = board.areas.get('save');
  assert.equal(area.keep.html, '<div>Save</div>');
  assert.deepEqual(area.options.map((o) => o.id), ['sticky-save-bar']);
  assert.deepEqual(area.suggest, { id: 'sticky-save-bar', because: 'Long list.' });
});
