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
