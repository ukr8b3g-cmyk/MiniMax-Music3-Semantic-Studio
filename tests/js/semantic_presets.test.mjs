import test from 'node:test';
import assert from 'node:assert/strict';
import {
  GENRE_PRESETS, INSTRUMENT_PRESETS, BPM_PRESETS, VOCAL_TIMBRE_PRESETS,
} from '../../web/semantic_presets.js';

function uniqueCaseInsensitive(values) {
  return new Set(values.map((value) => String(value).toLowerCase())).size === values.length;
}

test('preset catalogs remain unique and contain official-guide anchors', () => {
  assert.equal(uniqueCaseInsensitive(GENRE_PRESETS), true);
  assert.equal(uniqueCaseInsensitive(INSTRUMENT_PRESETS), true);
  assert.ok(GENRE_PRESETS.includes('Lo-fi Hip-Hop'));
  assert.ok(GENRE_PRESETS.includes('Jazz Fusion'));
  assert.ok(GENRE_PRESETS.includes('City Pop'));
  assert.ok(INSTRUMENT_PRESETS.includes('Rhodes piano'));
  assert.ok(INSTRUMENT_PRESETS.includes('brushed jazz drums'));
  assert.ok(VOCAL_TIMBRE_PRESETS.includes('breathy and intimate'));
});

test('BPM presets cover MiniMax prompt-guide feel bands without restricting numeric input', () => {
  assert.deepEqual(BPM_PRESETS.map((item) => item.value), [50, 70, 95, 120, 140]);
  assert.ok(BPM_PRESETS.every((item) => Number.isFinite(item.value)));
});
