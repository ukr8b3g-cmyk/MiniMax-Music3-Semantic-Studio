import test from 'node:test';
import assert from 'node:assert/strict';
import { filterPresetOptions } from '../../web/semantic_controls.js';

test('preset filtering is case-insensitive and removes duplicates', () => {
  const values = ['Lo-fi Hip-Hop', 'Hip-Hop', 'Jazz', 'jazz', 'City Pop'];
  assert.deepEqual(filterPresetOptions(values, 'lo'), ['Lo-fi Hip-Hop']);
  assert.deepEqual(filterPresetOptions(values, 'JAZZ'), ['Jazz']);
});

test('empty query exposes presets while custom unmatched text is not forced', () => {
  const values = ['Pop', 'Rock', 'Ambient'];
  assert.deepEqual(filterPresetOptions(values, ''), values);
  assert.deepEqual(filterPresetOptions(values, 'custom-only-value'), []);
});
