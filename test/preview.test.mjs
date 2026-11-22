import assert from 'node:assert/strict';
import { test } from 'node:test';
import { placeDot } from '../site/assets/preview.js';

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
