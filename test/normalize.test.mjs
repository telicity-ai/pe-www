import assert from 'node:assert/strict';
import { test } from 'node:test';
import { normalize } from '../api/_lib/normalize.js';
import { EXAMPLE, SCHEMA } from '../api/_lib/prompt.js';

const option = (extra) => ({ id: 'o', label: 'An option', pattern: null, keep: false, suggested: false, because: null, html: '<p>other</p>', ...extra });
const board = (extra) => ({ title: 'T', summary: 'S', css: '', page: '<main><h1>T</h1><p>now</p></main>', areas: [], ...extra });

test('the example in the prompt is a valid storyboard', () => {
  const result = normalize(EXAMPLE);
  assert.deepEqual(result.areas.map((a) => a.id), ['channels', 'save']);
  assert.equal(result.areas[0].options[0].keep, true);
  assert.equal(result.areas[0].options[1].pattern, 'checkbox');
  // The page repeats each area's present markup; it is replaced by the area's place.
  assert.match(result.page, /<\/header><pe-area id="channels"><\/pe-area><pe-area id="save"><\/pe-area><\/main>/);
});

test('an area is found by its present markup, also with other whitespace', () => {
  const result = normalize(board({
    page: '<main>\n  <h1>T</h1>\n  <p class="a">now</p>\n</main>',
    areas: [{ id: 'A One', label: 'Area', decision: 'nope', options: [option({ id: 'keep', keep: true, html: '<h1>T</h1><p class="a">now</p>' }), option()] }],
  }));
  assert.equal(result.areas[0].id, 'a-one');
  assert.equal(result.areas[0].decision, undefined);
  assert.equal(result.page, '<main><pe-area id="a-one"></pe-area></main>');
});

test('a place the model wrote itself is kept, an unknown one removed', () => {
  const result = normalize(board({
    page: '<main><pe-area id="a"></pe-area><pe-area id="ghost"></pe-area></main>',
    areas: [{ id: 'a', label: 'A', decision: null, options: [option({ keep: true, html: '<p>now</p>' }), option()] }],
  }));
  assert.equal(result.page, '<main><pe-area id="a"></pe-area></main>');
});

test('an area inside another is placed inside that one', () => {
  const result = normalize(board({
    page: '<main><section><h2>S</h2><button>Go</button></section></main>',
    areas: [
      { id: 'inner', label: 'Inner', decision: null, options: [option({ keep: true, html: '<button>Go</button>' }), option()] },
      { id: 'outer', label: 'Outer', decision: null, options: [option({ keep: true, html: '<section><h2>S</h2><button>Go</button></section>' }), option()] },
    ],
  }));
  assert.equal(result.page, '<main><pe-area id="outer"></pe-area></main>');
  assert.equal(result.areas.find((a) => a.id === 'outer').options[0].html, '<section><h2>S</h2><pe-area id="inner"></pe-area></section>');
});

test('one keep first, one suggestion, unknown patterns dropped', () => {
  const [area] = normalize(board({
    areas: [{ id: 'a', label: 'A', decision: 'save-settings', options: [
      option({ id: 'x', pattern: 'not-a-pattern', suggested: true, because: 'why' }),
      option({ id: 'x', keep: true, pattern: 'card', suggested: true, html: '<p>now</p>' }),
      option({ id: 'y', pattern: 'card', suggested: true, because: 'second' }),
    ] }],
  })).areas;
  assert.equal(area.decision, 'save-settings');
  assert.deepEqual(area.options.map((o) => o.id), ['x-2', 'x', 'y']);
  assert.deepEqual(area.options.map((o) => Boolean(o.keep)), [true, false, false]);
  assert.equal(area.options[0].pattern, undefined);
  assert.equal(area.options[1].pattern, undefined);
  assert.deepEqual(area.options.map((o) => Boolean(o.suggested)), [false, true, false]);
  assert.equal(area.options[2].because, undefined);
});

test('scripts are dropped and sizes are bounded', () => {
  const result = normalize(board({
    title: 'x'.repeat(200),
    page: '<main><script>alert(1)</script><p>now</p></main>',
    css: 'a{}'.repeat(50_000),
    areas: [{ id: 'a', label: 'A', decision: null, options: [option({ keep: true, html: '<p>now</p>' }), option({ html: '<p>x</p><script>steal()</script><pe-area id="a"></pe-area>' })] }],
  }));
  assert.ok(result.title.length <= 48);
  assert.ok(result.css.length <= 30_000);
  assert.doesNotMatch(result.page, /script/);
  assert.equal(result.areas[0].options[1].html, '<p>x</p>');
});

test('an answer without a placed area is refused', () => {
  assert.throws(() => normalize(board({ areas: [{ id: 'a', label: 'A', options: [option({ keep: true, html: '<p>elsewhere</p>' }), option()] }] })));
  assert.throws(() => normalize(board({ areas: [{ id: 'a', label: 'A', options: [option({ keep: true, html: '<p>now</p>' })] }] })));
  assert.throws(() => normalize(null));
});

test('the schema keeps to what Upstage accepts', () => {
  const visit = (node) => {
    if (!node || typeof node !== 'object') return;
    if (node.type === 'object') {
      assert.equal(node.additionalProperties, false);
      assert.deepEqual([...node.required].sort(), Object.keys(node.properties).sort());
    }
    for (const key of ['anyOf', 'oneOf', 'allOf', 'not', '$ref']) assert.equal(key in node, false);
    Object.values(node).forEach(visit);
  };
  visit(SCHEMA);
});
