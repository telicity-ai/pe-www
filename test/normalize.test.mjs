import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../api/_lib/normalize.js';
import { EXAMPLE, SCHEMA } from '../api/_lib/prompt.js';

const block = (extra) => ({ t: 'text', text: null, items: null, n: 2, cols: null, style: null, children: null, ...extra });
const option = (extra) => ({ id: 'o', label: 'An option', pattern: null, keep: false, suggested: false, because: null, blocks: [block()], ...extra });

test('the example in the prompt is a valid storyboard', () => {
  const board = normalize(EXAMPLE);
  assert.equal(board.areas.length, 2);
  assert.equal(board.areas[0].options[0].keep, true);
  assert.equal(board.areas[0].options[1].suggested, true);
  assert.equal(board.areas[0].options[1].pattern, 'toggle-button');
  assert.deepEqual(board.page.at(-1), { t: 'area', text: 'actions' });
});

test('one keep first, one suggestion, unknown patterns dropped', () => {
  const board = normalize({
    title: 'T', summary: 'S', page: [block()],
    areas: [{ id: 'A One', label: 'Area', decision: 'nope', options: [
      option({ id: 'x', pattern: 'not-a-pattern', suggested: true, because: 'why' }),
      option({ id: 'x', keep: true, pattern: 'card', suggested: true }),
      option({ id: 'y', pattern: 'card', suggested: true, because: 'second' }),
    ] }],
  });
  const [area] = board.areas;
  assert.equal(area.id, 'a-one');
  assert.equal(area.decision, undefined);
  assert.deepEqual(area.options.map((o) => o.id), ['x-2', 'x', 'y']);
  assert.deepEqual(area.options.map((o) => Boolean(o.keep)), [true, false, false]);
  assert.equal(area.options[0].pattern, undefined);
  assert.equal(area.options[1].pattern, undefined);
  assert.deepEqual(area.options.map((o) => Boolean(o.suggested)), [false, true, false]);
  assert.equal(area.options[2].because, undefined);
  // The area was not placed by the model: it is appended.
  assert.deepEqual(board.page.at(-1), { t: 'area', text: 'a-one' });
});

test('markup and control characters stay text, sizes are bounded', () => {
  const board = normalize({
    title: '<script>alert(1)</script>', summary: 'x'.repeat(999),
    page: [block({ t: 'heading', text: 'a\u0000b\n c', items: Array.from({ length: 30 }, (_, i) => `item ${i}`), n: 99, cols: -3, style: 'javascript:alert(1)' }), { t: 'evil' }, null],
    areas: [{ id: 'a', label: 'A', decision: null, options: [option({ keep: true }), option({ id: 'p', blocks: [block({ t: 'area', text: 'a' }), block()] })] }],
  });
  assert.equal(board.title, '<script>alert(1)</script>');
  assert.ok(board.summary.length <= 220);
  const [heading] = board.page;
  assert.equal(heading.text, 'a b c');
  assert.equal(heading.items.length, 8);
  assert.equal(heading.n, 8);
  assert.equal(heading.cols, 1);
  assert.equal(heading.style, undefined);
  assert.equal(board.page.length, 2);
  // An option may not hold an area slot.
  assert.equal(board.areas[0].options[1].blocks.length, 1);
});

test('an answer without usable areas is refused', () => {
  assert.throws(() => normalize({ title: 'T', summary: '', page: [], areas: [{ id: 'a', label: 'A', options: [option()] }] }));
  assert.throws(() => normalize(null));
});

test('the schema keeps to what Upstage accepts', () => {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    for (const key of ['anyOf', 'oneOf', 'allOf', 'not']) assert.equal(key in node, false);
    Object.values(node).forEach(visit);
  };
  visit(SCHEMA);
  // No recursion: a leaf does not refer to anything.
  assert.equal(JSON.stringify(SCHEMA.$defs.leaf).includes('$ref'), false);
});
