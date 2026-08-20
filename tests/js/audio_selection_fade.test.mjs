import test from 'node:test';
import assert from 'node:assert/strict';
import { applySelectionFade, canApplySelectionFade } from '../../web/audio_selection_fade_core.js';

function clip(overrides = {}) {
  return {
    id: 'c1', source_id: 'take-1', source_in: 0, source_out: 10, timeline_start: 0,
    gain_db: 0, pan: 0, muted: false, reverse: false,
    fade_in: { duration: 0, curve: 'linear' }, fade_out: { duration: 0, curve: 'linear' },
    gain_envelope: [],
    ...overrides,
  };
}

test('Fade Out carves the selected tail and fades exactly across the selection', () => {
  const track = { clips: [clip()], gain_envelope: [] };
  let serial = 0;
  const selected = applySelectionFade(track, 7, 10, 'fade_out', {
    curve: 'linear',
    makeId: () => `new-${++serial}`,
  });
  assert.ok(selected);
  assert.equal(track.clips.length, 2);
  assert.equal(track.clips[0].timeline_start, 0);
  assert.equal(track.clips[0].source_out, 7);
  assert.equal(selected.id, 'c1');
  assert.equal(selected.timeline_start, 7);
  assert.equal(selected.source_in, 7);
  assert.equal(selected.source_out, 10);
  assert.deepEqual(selected.fade_out, { duration: 3, curve: 'linear' });
});

test('Fade In works on an interior selection and preserves audio outside it', () => {
  const track = { clips: [clip()], gain_envelope: [] };
  let serial = 0;
  const selected = applySelectionFade(track, 2, 5, 'fade_in', {
    curve: 'equal_power',
    makeId: () => `new-${++serial}`,
  });
  assert.ok(selected);
  assert.equal(track.clips.length, 3);
  assert.deepEqual(track.clips.map((item) => [item.timeline_start, item.source_in, item.source_out]), [
    [0, 0, 2], [2, 2, 5], [5, 5, 10],
  ]);
  assert.deepEqual(selected.fade_in, { duration: 3, curve: 'equal_power' });
});

test('selection fade accepts a small rounded overshoot at the final clip end', () => {
  const track = { clips: [clip({ source_out: 54.988 })], gain_envelope: [] };
  assert.equal(canApplySelectionFade(track, 50, 55), true);
  const selected = applySelectionFade(track, 50, 55, 'fade_out');
  assert.ok(selected);
  assert.equal(selected.timeline_start, 50);
  assert.equal(selected.source_out, 54.988);
  assert.ok(Math.abs(selected.fade_out.duration - 4.988) < 1e-9);
});

test('selection fade accepts clip-end overshoot below 50 ms', () => {
  const track = { clips: [clip()], gain_envelope: [] };
  assert.equal(canApplySelectionFade(track, 7, 10.01), true);
  assert.equal(canApplySelectionFade(track, 7, 10.049), true);
});

test('selection fade rejects clip-end overshoot above 50 ms', () => {
  const track = { clips: [clip()], gain_envelope: [] };
  assert.equal(canApplySelectionFade(track, 7, 10.1), false);
  assert.equal(applySelectionFade(track, 7, 10.1, 'fade_out'), null);
});

test('selection fade rejects ranges that cross multiple clips', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_in: 5, source_out: 10, timeline_start: 5 }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(track, 4, 6), false);
  assert.equal(applySelectionFade(track, 4, 6, 'fade_out'), null);
  assert.equal(track.clips.length, 2);
});

test('small overshoot into an adjacent clip is not treated as endpoint rounding', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_in: 5, source_out: 10, timeline_start: 5 }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(track, 4, 5.03), false);
  assert.equal(applySelectionFade(track, 4, 5.03, 'fade_out'), null);
});
