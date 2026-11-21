import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ElementScan, Reader, SOURCE_CODE, Variant, findElement, findStart, planChoice } from '../api/_lib/answer.js';
import { DECISIONS, PATTERNS } from '../api/_lib/catalog.js';
import { screenTask, systemPrompt, variantTask } from '../api/_lib/brief.js';
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
  const text = '```\n@@AREA a | - | checkbox | Label | <div class="x">\n@@PAGE\n<div>\n  <p>a@@b</p>\n</div>\n@@WHERE a | <div class="x">\n@@TITLE Home\n@@END\n```';
  const whole = read(text, text.length);
  assert.deepEqual(whole, [
    ['marker', 'AREA', 'a | - | checkbox | Label | <div class="x">'],
    ['marker', 'PAGE', ''],
    ['text', '<div>\n  <p>a@@b</p>\n</div>\n'],
    ['marker', 'WHERE', 'a | <div class="x">'],
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

test('a line of the plan names an area, its patterns, its label and how its element begins', () => {
  const seen = new Set();
  const area = planChoice('Save Bar | save-settings | sticky-save-bar, nope, sticky-header | Where Save sits | <div class="a || b"><button class="x"', seen);
  assert.deepEqual(area, {
    id: 'save-bar',
    wanted: 'save-bar',
    label: 'Where Save sits',
    options: [{ id: 'sticky-save-bar', pattern: 'sticky-save-bar', suggested: true }, { id: 'sticky-header', pattern: 'sticky-header' }],
    decision: 'save-settings',
    anchor: '<div class="a || b"><button class="x"',
  });
  assert.equal(planChoice('save-bar | - | checkbox | again', seen), null, 'the same area twice');
  assert.equal(planChoice('other | - | no-such-pattern | x', seen), null, 'no pattern of the catalog');
  assert.equal(planChoice('third | - | checkbox | Only a label', seen).anchor, undefined);
});

const PAGE = '<div>\n<div class="flex flex-col gap-2"><h1>T</h1></div>\n<form><section class="card [&>svg]:size-4" data-x="1>2"><!-- a > b --><img src=x><br/>\n<div class="flex flex-col gap-2">\n<label>Email</label><input></div></section></form><p>after</p></div>';

test('the end of an element is found as it arrives', () => {
  const text = '\n  <ul class="a"><li>1<br></li>\n<li><svg data-icon="a:b"></svg></li></ul><p>next</p>';
  for (const size of [1, 4, text.length]) {
    const scan = new ElementScan();
    let end = -1;
    for (let i = 0; i < text.length && end < 0; i += size) end = scan.push(text.slice(i, i + size));
    assert.equal(text.slice(scan.from, end), '<ul class="a"><li>1<br></li>\n<li><svg data-icon="a:b"></svg></li></ul>', `in pieces of ${size}`);
  }
  const single = new ElementScan();
  const end = single.push('<input type="x"> <p>');
  assert.equal(end, 16);
  assert.equal(new ElementScan().push('<div><p>never closed'), -1);
});

test('an element is found by how it begins', () => {
  const at = (anchor) => { const found = findElement(PAGE, anchor); return found && PAGE.slice(found.from, found.to); };
  assert.equal(at('<section class="card [&>svg]:size-4" data-x="1>2">'), PAGE.slice(PAGE.indexOf('<section'), PAGE.indexOf('</form>')));
  // Two elements open alike: what follows the opening tag tells them apart.
  assert.equal(at('<div class="flex flex-col gap-2"><label>Email'), '<div class="flex flex-col gap-2">\n<label>Email</label><input></div>');
  assert.equal(at('<div class="flex flex-col gap-2">'), '<div class="flex flex-col gap-2"><h1>T</h1></div>');
  // A copy that is off after its opening tag is still found by that tag, unless it must be exact.
  assert.equal(at('<div class="flex  flex-col gap-2" ><h2>Other'), '<div class="flex flex-col gap-2"><h1>T</h1></div>');
  assert.equal(findStart(PAGE, '<div class="flex flex-col gap-2"><h2>Other', true), -1);
  // A beginning that was cut short in the middle of its opening tag.
  assert.equal(at('<section class="card [&>svg]:si...'), PAGE.slice(PAGE.indexOf('<section'), PAGE.indexOf('</form>')));
  assert.equal(at('<nav class="none">'), null);
  assert.equal(at('not a tag'), null);
});

function variant(area, option, text) {
  const answer = new Variant(area, option);
  const reader = new Reader((name, rest) => answer.marker(name, rest), (part) => answer.text(part));
  reader.push(text);
  reader.end();
  return answer.result();
}

test('the answer about an option gives its label, its reason and its element', () => {
  const area = planChoice('save | - | sticky-save-bar, sticky-header | Where Save sits', new Set());
  assert.deepEqual(variant(area, area.options[0], '@@OPTION A bar that stays at the bottom\n@@WHY The list is long.\n@@HTML\n<div class="sticky">Save</div>\n<script>alert(1)</script>\n@@END\nmore'), {
    t: 'option', area: 'save', id: 'sticky-save-bar', pattern: 'sticky-save-bar', label: 'A bar that stays at the bottom', suggested: true, because: 'The list is long.', html: '<div class="sticky">Save</div>',
  });
  assert.deepEqual(variant(area, area.options[1], '@@OPTION In the header\n@@WHY not asked for\n@@HTML\n<header>Save</header>\n@@END'), {
    t: 'option', area: 'save', id: 'sticky-header', pattern: 'sticky-header', label: 'In the header', html: '<header>Save</header>',
  });
  assert.equal(variant(area, area.options[0], '@@OPTION x\n@@END'), null, 'no HTML');
});

test('source code is told from HTML', () => {
  for (const html of ['<div class="a [&_svg]:size-4 data-[state=open]:b">{"key":"value"}</div>', '<p>Use {name} here, a@b.com at 12:30</p>', '<svg data-icon="lucide:x" viewBox="0 0 24 24"></svg>']) {
    assert.equal(SOURCE_CODE.test(html), false, html);
  }
  for (const code of ['<Button className="a">', '<div class="a">{isActive && <span>x</span>}</div>', '<li class:active={x}>', '<a :class="x">', '<div v-if="x">', '{#if user}<a>', '{items.map((i) => <li>{i}</li>)}']) {
    assert.equal(SOURCE_CODE.test(code), true, code);
  }
});

test('the example in the instructions uses the catalog and the form it describes', () => {
  const patterns = new Set(PATTERNS.map((p) => p.id));
  const decisions = new Set(DECISIONS.map((d) => d.id));
  const task = screenTask();
  const example = task.slice(task.indexOf('EXAMPLE'));
  const page = example.slice(example.indexOf('@@PAGE\n') + 7, example.indexOf('@@WHERE'));
  const lines = example.split('\n').filter((line) => line.startsWith('@@AREA'));
  assert.equal(lines.length, 2);
  const seen = new Set();
  for (const line of lines) {
    const area = planChoice(line.slice('@@AREA'.length), seen);
    assert.equal(area.options.length, 2, line);
    assert.ok(area.options.every((o) => patterns.has(o.pattern)), line);
    assert.ok(decisions.has(area.decision), line);
    // The beginning that the plan gives is in the page, and the @@WHERE line repeats it.
    assert.ok(findStart(page, area.anchor, true) >= 0, `${area.id} begins in the page as the plan says`);
    assert.ok(example.includes(`@@WHERE ${area.id} | ${area.anchor}`), `${area.id} has its @@WHERE line`);
    const found = findElement(page, area.anchor);
    assert.match(variantTask(area, area.options[0], page.slice(found.from, found.to)), /@@WHY/);
    assert.doesNotMatch(variantTask(area, area.options[1], '<div></div>'), /@@WHY/);
  }
  assert.doesNotMatch(systemPrompt('en') + task, /<path\s+d=/, 'no drawing of an icon in the instructions');
  assert.match(systemPrompt('ko'), /Korean/);
});

test('the page puts the lines of an answer together', () => {
  const board = newBoard('src/Page.tsx');
  const lines = [
    { t: 'plan', areas: [{ id: 'save', label: 'Where Save sits', decision: 'save-settings', options: ['sticky-save-bar', 'sticky-header'] }] },
    { t: 'page', text: '<main><h1>T</h1>' },
    { t: 'page', text: '<div>Save</div></main>' },
    { t: 'place', area: 'save', from: 16, to: 31 },
    { t: 'page-end' },
    { t: 'screen', title: 'Settings', summary: 'S' },
    { t: 'option', area: 'save', id: 'sticky-save-bar', pattern: 'sticky-save-bar', label: 'A bar', suggested: true, because: 'Long list.', html: '<div class="bar">Save</div>' },
    { t: 'miss', area: 'save', id: 'sticky-header' },
    { t: 'done' },
  ];
  for (const line of lines) take(board, line);
  assert.equal(board.page, '<main><h1>T</h1><div>Save</div></main>');
  assert.equal(board.done, true);
  const area = board.areas.get('save');
  assert.equal(board.page.slice(area.place.from, area.place.to), '<div>Save</div>');
  assert.equal(area.label, 'Where Save sits');
  assert.deepEqual(area.options, [{ id: 'sticky-save-bar', label: 'A bar', pattern: 'sticky-save-bar', html: '<div class="bar">Save</div>', suggested: true, because: 'Long list.' }]);
  assert.deepEqual([...area.missing], ['sticky-header']);
});
