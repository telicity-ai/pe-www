import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Reader, SOURCE_CODE, isCompleteConversation, repeatedLine } from '../api/_lib/answer.js';
import { PATTERNS } from '../api/_lib/catalog.js';
import { ARRANGEMENTS, areasSystem, areasTask, screenTask, systemPrompt } from '../api/_lib/brief.js';
import { candidates, markPage, outline } from '../api/_lib/page.js';
import { planEvents, planOf, readAreas } from '../api/_lib/plan.js';
import { conversationParts } from '../site/assets/github.js';
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
  const text = '```\n@@CSS\n@@PAGE\n<div>\n  <p>a@@b</p>\n</div>\n@@TITLE Home\n@@SUMMARY A page | with a bar.\n@@END\n```';
  const whole = read(text, text.length);
  assert.deepEqual(whole, [
    ['marker', 'CSS', ''],
    ['marker', 'PAGE', ''],
    ['text', '<div>\n  <p>a@@b</p>\n</div>\n'],
    ['marker', 'TITLE', 'Home'],
    ['marker', 'SUMMARY', 'A page | with a bar.'],
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

test('source code is told from HTML', () => {
  for (const html of ['<div class="a [&_svg]:size-4 data-[state=open]:b">{"key":"value"}</div>', '<p>Use {name} here, a@b.com at 12:30</p>', '<svg data-icon="lucide:x" viewBox="0 0 24 24"></svg>']) {
    assert.equal(SOURCE_CODE.test(html), false, html);
  }
  for (const code of ['<Button className="a">', '<div class="a">{isActive && <span>x</span>}</div>', '<li class:active={x}>', '<a :class="x">', '<div v-if="x">', '{#if user}<a>', '{items.map((i) => <li>{i}</li>)}']) {
    assert.equal(SOURCE_CODE.test(code), true, code);
  }
});

test('the instructions describe the form that is read, and name arrangements the catalog knows', () => {
  const task = screenTask();
  const example = task.slice(task.indexOf('EXAMPLE'));
  // The example is an answer in the form the task asks for: the screen's name, then its page.
  const seen = read(example.slice(example.indexOf('@@TITLE'), example.indexOf('@@END') + 5), 9).filter(([kind]) => kind === 'marker').map(([, name]) => name);
  assert.deepEqual(seen, ['TITLE', 'SUMMARY', 'CSS', 'PAGE', 'END']);
  assert.doesNotMatch(systemPrompt('en') + task, /<path\s+d=/, 'no drawing of an icon in the instructions');
  assert.doesNotMatch(systemPrompt('en') + task, /@@AREA|@@WHERE|catalog/i, 'the screen is written without a plan of areas');
  assert.match(screenTask('short'), /stopped in the middle/);
  // An arrangement that has a name in picky-eater's catalog carries it into the prompt a visitor takes away.
  const patterns = new Set(PATTERNS.map((p) => p.id));
  for (const [id, arrangement] of Object.entries(ARRANGEMENTS)) assert.ok(!arrangement.pattern || patterns.has(arrangement.pattern), `${id}: ${arrangement.pattern}`);
  for (const kind of ['site', 'screen']) {
    assert.match(areasSystem('ko', kind), /Korean/);
    for (const lang of ['en', 'ko']) {
      // The example of each task is an answer that is read: its arrangements are ones the parts can take.
      const text = areasTask({ kind, name: 'x', outline: '[1] …', lang });
      const sample = text.slice(text.indexOf('EXAMPLE'));
      const list = [1, 2, 3, 4].map((n) => ({ n, from: n * 10, to: n * 10 + 5, fits: Object.keys(ARRANGEMENTS) }));
      const { areas } = readAreas(sample.slice(sample.indexOf('@@AREA'), sample.indexOf('@@END') + 5), list);
      assert.ok(areas.length >= 2 && areas.every((area) => area.label && area.picks.every((pick) => pick.because)), `${kind} ${lang}`);
    }
  }
});

const SCREEN = `<div class="min-h-screen bg-background" style="min-height:100vh"><aside data-slot="sidebar"><a class="l"><svg data-icon="lucide:home"></svg><span>All my projects</span></a><a class="l"><svg data-icon="lucide:cog"></svg><span>Account and billing</span></a></aside>
<main class="p-6"><div class="flex items-center justify-between"><div class="text-2xl font-semibold">Projects</div><button class="btn">New project</button></div>
<div class="grid grid-cols-3 gap-4" data-pe-group="9">${['Website', 'Mobile app', 'Billing'].map((name) => `<div class="rounded-lg border p-4"><div class="font-medium">${name}</div><p class="text-sm">Updated two days ago</p></div>`).join('')}</div>
<form class="space-y-4"><div class="grid gap-2"><label>Name</label><input></div><div class="grid gap-2"><label>Owner</label><select><option>Me</option></select></div><div class="grid gap-2"><label>Notes</label><textarea></textarea></div></form>
<select class="trigger"><span>Sort by name</span></select><p class="cut">The page was cut off he`;

test('a screen written from source is marked and its parts are found as an application has them', () => {
  const marked = markPage(SCREEN.replace(/<[^>]*$/, ''));
  // Read as a browser reads it: what was open at the cut is closed, a styled trigger is a button.
  assert.match(marked, /<button type="button" class="trigger"><span>Sort by name<\/span><\/button><p class="cut">The page was cut off he<\/p><\/main><\/div>$/);
  assert.doesNotMatch(marked, /data-pe-group="9"/, 'a mark that the model wrote is taken off');
  assert.match(marked, /<div class="grid grid-cols-3 gap-4" data-pe-group="3"><div class="rounded-lg border p-4" data-pe-item="">/);
  assert.match(marked, /<form class="space-y-4" data-pe-group="3">/, 'the fields of a form are a group');
  assert.doesNotMatch(marked, /<aside[^>]*data-pe-group/, 'the bar at the side is not');
  const list = candidates(marked, { app: true });
  assert.deepEqual(list.map((c) => c.kind), ['block', 'group', 'group']);
  // Words set large head a part as a heading does; a name set bold heads a card.
  assert.equal(list[0].heading, 'Projects');
  assert.equal(list[0].opens, true);
  assert.deepEqual(list[1].each, ['a heading', 'text']);
  assert.deepEqual(list[1].fits, ['grid', 'rows', 'scroller', 'featured']);
  // Fields are laid out in columns or in rows; none of them is put first or scrolled sideways.
  assert.deepEqual(list[2].fits, ['grid', 'rows']);
  assert.equal(outline(list).split('\n')[2], '[3] 3 items, each with text, a field: "Name" / "Owner" / "Notes". Can be: grid, rows');
  assert.equal(marked.slice(list[1].from, list[1].to).startsWith('<div class="grid grid-cols-3 gap-4" data-pe-group="3">'), true);
  const plan = planOf(list, [], 'ko', 'screen');
  assert.deepEqual(plan.map((area) => area.label), ['화면 위쪽 배치', '항목 배치 방식', '항목 배치 방식']);
  assert.deepEqual(planEvents([], { file: 'a.tsx' }), [{ t: 'plan', arranged: true, areas: [], file: 'a.tsx' }]);
});

test('the page puts the lines of an answer together', () => {
  const MARKED = '<main><h1>T</h1><div data-pe-group="2"><p data-pe-item="">One</p><p data-pe-item="">Two</p></div></main>';
  const board = newBoard('src/Page.tsx');
  const lines = [
    { t: 'page', text: '<main><h1>T</h1>' },
    { t: 'page', text: '<div><p>One</p><p>Two</p>' },
    { t: 'page-end' },
    { t: 'screen', title: 'Settings', summary: 'S' },
    { t: 'marked', text: MARKED },
    { t: 'plan', arranged: true, areas: [{ id: 'area-1', label: 'How the two are laid out', options: ['grid', 'rows'] }] },
    { t: 'place', area: 'area-1', from: MARKED.indexOf('<div'), to: MARKED.indexOf('</main>') },
    { t: 'option', area: 'area-1', id: 'grid', recipe: 'grid', pattern: 'card-grid', because: 'Two short things.' },
    { t: 'option', area: 'area-1', id: 'rows', recipe: 'rows', pattern: 'list-row' },
    { t: 'done' },
  ];
  for (const line of lines.slice(0, 2)) take(board, line);
  assert.equal(board.page, '<main><h1>T</h1><div><p>One</p><p>Two</p>');
  for (const line of lines.slice(2)) take(board, line);
  // The marked page takes the place of the pieces, and the area is a stretch of it.
  assert.equal(board.arranged, true);
  assert.equal(board.done, true);
  const area = board.areas.get('area-1');
  assert.match(board.page.slice(area.place.from, area.place.to), /^<div data-pe-group="2">.*<\/div>$/);
  assert.equal(area.label, 'How the two are laid out');
  assert.deepEqual(area.options.map((o) => [o.id, o.recipe, o.pattern, o.because]), [['grid', 'grid', 'card-grid', 'Two short things.'], ['rows', 'rows', 'list-row', undefined]]);
});

test('a page that repeats one line is noticed, closing tags are not', () => {
  const wrapper = '<div class="flex min-h-0 min-w-0 flex-1 flex-col">';
  assert.equal(repeatedLine(`<main>\n${`${wrapper}\n`.repeat(3)}`), wrapper);
  assert.equal(repeatedLine(`<main>\n${`${wrapper}\n`.repeat(2)}${wrapper.slice(0, 9)}`), null);
  assert.equal(repeatedLine(`<main>\n${`${wrapper}\n`.repeat(2)}<p>Hi</p>\n`), null);
  assert.equal(repeatedLine(`<main>\n${'</div>\n'.repeat(6)}`), null);
});

test('open conversation previews require the title above messages and a separate composer below', () => {
  const column = '<div data-chat-column class="flex flex-col">';
  const header = '<header data-chat-header>Release notes</header>';
  const history = '<main role="log"><p>What changed?</p><p>The search is faster now.</p></main>';
  const composer = '<footer data-chat-composer><textarea placeholder="Reply"></textarea></footer>';
  assert.equal(isCompleteConversation(column + header + history + composer + '</div>'), true);
  assert.equal(isCompleteConversation(column + header + history.replace('<p>', '<div><p>') + composer + '</div>'), true);
  for (const body of [header + composer, history + header + composer, header + '<div>' + history + composer + '</div>',
    header + '<main role="log"><p>Load earlier turns</p></main>' + composer, header + history + composer.slice(0, -9)]) {
    assert.equal(isCompleteConversation(column + body + '</div>'), false);
  }
  assert.deepEqual(conversationParts('return <><ChatHeader/><ThreadTimeline/><ChatComposer/></>'), ['ChatHeader', 'ThreadTimeline', 'ChatComposer']);
  assert.deepEqual(conversationParts('import { ChatComposer } from "./ChatComposer"; return <ThreadTimeline/>'), []);
});
