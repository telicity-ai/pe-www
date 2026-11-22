import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { placeDot } from '../site/assets/preview.js';

const chrome = [process.env.CHROME_BIN, '/usr/bin/google-chrome', '/usr/bin/chromium', '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome']
  .find((file) => file && existsSync(file));

function checkFixture(t, file) {
  const profile = mkdtempSync(join(tmpdir(), 'pe-preview-test-'));
  t.after(() => rmSync(profile, { recursive: true, force: true }));
  const fixture = new URL(`./fixtures/${file}`, import.meta.url);
  const html = execFileSync(chrome, ['--headless', '--allow-file-access-from-files', `--user-data-dir=${profile}`, '--dump-dom', fixture.href],
    { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'], timeout: 20000 });
  assert.equal(html.match(/<output>([^<]*)<\/output>/)?.[1], 'passed');
}

const browserTest = { skip: chrome ? false : 'Chrome unavailable' };
test('preview keeps sidebar space and empty-state alignment with their content', browserTest, (t) => checkFixture(t, 'preview-layout.html'));
test('source-defined section grids keep controls in their content cell', browserTest, (t) => checkFixture(t, 'preview-section.html'));
test('only areas reachable in the selected layout contribute to progress', browserTest, (t) => checkFixture(t, 'preview-areas.html'));

test('nested areas sharing the top-right corner have separate, clickable markers', () => {
  for (const width of [320, 1280]) {
    const occupied = [];
    for (const inset of [0, 0, 3]) {
      const dot = placeDot(width - inset, -10, width, 600, occupied);
      assert.ok(dot.left >= 4 && dot.right <= width - 4);
      assert.ok(dot.top >= 4 && dot.bottom <= 596);
      for (const other of occupied) {
        assert.ok(Math.abs(dot.left - other.left) >= 40 || Math.abs(dot.top - other.top) >= 40);
      }
      occupied.push(dot);
    }
  }
});

test('a marker stays at its own corner when its hit target is clear', () => {
  const first = placeDot(100, 30, 320, 240, []);
  const next = placeDot(100, 70, 320, 240, [first]);
  assert.deepEqual(next, { left: 100, top: 70, right: 120, bottom: 90 });
});
