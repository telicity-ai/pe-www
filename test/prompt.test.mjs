import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildProjectPrompt, buildPrompt, diffPrompt, mergePrompt } from '../site/assets/prompt.js';
import { parseRepo } from '../site/assets/github.js';

const analysis = {
  screen: { title: 'Settings', file: 'src/Settings.tsx' },
  areas: [
    { id: 'save', label: 'Where Save sits', options: [{ id: 'keep', keep: true, label: 'At the end' }, { id: 'bar', label: 'A bar that stays', pattern: 'sticky-save-bar' }] },
    { id: 'days', label: 'Days', options: [{ id: 'keep', keep: true, label: 'Checkboxes' }, { id: 'chips', label: 'A button for each day', pattern: 'toggle-button' }] },
  ],
};

test('the prompt lists picks and what is still open', () => {
  const text = buildPrompt(analysis, { save: 'bar' }, 'en');
  assert.match(text, /^Use the picky-eater skill on the Settings screen of this project \(src\/Settings\.tsx\)\./);
  assert.match(text, /- Where Save sits: a bar that stays \(sticky-save-bar\)/);
  assert.match(text, /Still open, show me options for:\n- Days/);
  assert.match(buildPrompt(analysis, { save: 'keep' }, 'en'), /- Where Save sits: keep it as it is/);
  assert.match(buildPrompt(analysis, { save: 'bar' }, 'ko'), /^picky-eater 스킬로/);
});

test('a pick shows as one line removed and one added', () => {
  const change = diffPrompt(buildPrompt(analysis, {}, 'en'), buildPrompt(analysis, { save: 'bar' }, 'en'));
  assert.deepEqual(change, { removed: ['Where Save sits'], added: ['Where Save sits: a bar that stays (sticky-save-bar)'] });
});

test('a pick is merged into a prompt the person has edited', () => {
  const before = buildPrompt(analysis, {}, 'en');
  const after = buildPrompt(analysis, { save: 'bar' }, 'en');
  assert.equal(mergePrompt(before, before, after), after);

  const edited = `${before.replace('- Days', '- Days (weekends matter most)')}\nKeep our brand colors.`;
  const merged = mergePrompt(edited, before, after);
  assert.match(merged, /- Where Save sits: a bar that stays \(sticky-save-bar\)/);
  assert.match(merged, /- Days \(weekends matter most\)/);
  assert.match(merged, /Keep our brand colors\.$/);
  assert.equal((merged.match(/Where Save sits/g) ?? []).length, 1);

  // Choosing again replaces the line that the first pick wrote.
  const back = mergePrompt(merged, after, before);
  assert.doesNotMatch(back, /sticky-save-bar/);
  assert.match(back, /Keep our brand colors\.$/);
});

test('repository addresses', () => {
  assert.deepEqual(parseRepo('vercel/commerce'), { owner: 'vercel', name: 'commerce', ref: null, sub: '' });
  assert.deepEqual(parseRepo('https://github.com/vercel/commerce.git'), { owner: 'vercel', name: 'commerce', ref: null, sub: '' });
  assert.deepEqual(parseRepo('github.com/a/b/tree/main/apps/web'), { owner: 'a', name: 'b', ref: 'main', sub: 'apps/web' });
  assert.equal(parseRepo('just-a-word'), null);
  assert.equal(parseRepo('a/b c'), null);
});

test('picks on several screens make one prompt', () => {
  const other = { screen: { title: 'Shifts', file: 'src/Shifts.tsx' }, areas: [{ id: 'list', label: 'How the shifts are listed', options: [{ id: 'keep', keep: true, label: 'A table' }, { id: 'cards', label: 'A card for each shift', pattern: 'card-grid' }] }] };
  assert.equal(buildProjectPrompt([], 'en'), '');
  assert.equal(buildProjectPrompt([{ analysis, choices: { save: 'bar' } }], 'en'), buildPrompt(analysis, { save: 'bar' }, 'en'));
  const text = buildProjectPrompt([{ analysis, choices: { save: 'bar' } }, { analysis: other, choices: { list: 'cards' } }], 'en');
  assert.match(text, /^Use the picky-eater skill on these screens of this project, one after another\./);
  assert.match(text, /\nSettings screen \(src\/Settings\.tsx\):\nI tried it on the web and lean toward:\n- Where Save sits: a bar that stays \(sticky-save-bar\)\n/);
  assert.match(text, /\nShifts screen \(src\/Shifts\.tsx\):\nI tried it on the web and lean toward:\n- How the shifts are listed: a card for each shift \(card-grid\)\n/);
  assert.match(text, /mark my leanings as suggested, and wait for my approval before you change code\.$/);
  assert.match(buildProjectPrompt([{ analysis, choices: {} }, { analysis: other, choices: { list: 'keep' } }], 'ko'), /^picky-eater 스킬로 이 프로젝트의 아래 화면들을 차례로 다듬어 줘\.\n\nSettings 화면 \(src\/Settings\.tsx\):/);
  // A pick on another screen shows as lines added, like any pick.
  const change = diffPrompt(buildProjectPrompt([{ analysis, choices: { save: 'bar' } }], 'en'), text);
  assert.deepEqual(change.added, ['How the shifts are listed: a card for each shift (card-grid)']);
});
