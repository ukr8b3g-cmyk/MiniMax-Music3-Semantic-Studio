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

test('Fade Out treats contiguous fragments from the same source as one logical clip', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 54.596, timeline_start: 0 }),
      clip({ id: 'b', source_in: 54.596, source_out: 59.893, timeline_start: 54.596,
        fade_out: { duration: 5.297, curve: 'linear' } }),
      clip({ id: 'c', source_in: 59.893, source_out: 59.98875283446712, timeline_start: 59.893 }),
    ],
    gain_envelope: [],
  };

  assert.equal(canApplySelectionFade(track, 50, 60), true);
  const selected = applySelectionFade(track, 50, 60, 'fade_out');
  assert.ok(selected);
  assert.equal(track.clips.length, 2);
  assert.equal(track.clips[0].source_in, 0);
  assert.equal(track.clips[0].source_out, 50);
  assert.equal(selected.timeline_start, 50);
  assert.equal(selected.source_in, 50);
  assert.ok(Math.abs(selected.source_out - 59.98875283446712) < 1e-9);
  assert.ok(Math.abs(selected.fade_out.duration - 9.98875283446712) < 1e-9);
});

test('Fade In can start at the true beginning across contiguous fragments', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 2, timeline_start: 0 }),
      clip({ id: 'b', source_in: 2, source_out: 5, timeline_start: 2 }),
      clip({ id: 'c', source_in: 5, source_out: 10, timeline_start: 5 }),
    ],
    gain_envelope: [],
  };

  assert.equal(canApplySelectionFade(track, 0, 4), true);
  const selected = applySelectionFade(track, 0, 4, 'fade_in');
  assert.ok(selected);
  assert.equal(selected.timeline_start, 0);
  assert.equal(selected.source_in, 0);
  assert.equal(selected.source_out, 4);
  assert.deepEqual(selected.fade_in, { duration: 4, curve: 'linear' });
  assert.deepEqual(track.clips.map((item) => [item.timeline_start, item.source_in, item.source_out]), [
    [0, 0, 4], [4, 4, 5], [5, 5, 10],
  ]);
});

test('selection fade still rejects different source takes', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_id: 'take-1', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_id: 'take-2', source_in: 5, source_out: 10, timeline_start: 5 }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(track, 4, 6), false);
  assert.equal(applySelectionFade(track, 4, 6, 'fade_out'), null);
  assert.equal(track.clips.length, 2);
});

test('selection fade rejects a timeline gap between fragments', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_in: 5, source_out: 10, timeline_start: 5.1 }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(track, 4, 6), false);
});

test('selection fade rejects non-contiguous source ranges even when timeline is continuous', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_in: 6, source_out: 11, timeline_start: 5 }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(track, 4, 6), false);
});

test('selection fade rejects contiguous fragments with different gain or automation', () => {
  const gainTrack = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_in: 5, source_out: 10, timeline_start: 5, gain_db: -3 }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(gainTrack, 4, 6), false);

  const envelopeTrack = {
    clips: [
      clip({ id: 'a', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_in: 5, source_out: 10, timeline_start: 5,
        gain_envelope: [{ time: 0, gain_db: 0 }, { time: 5, gain_db: -6 }] }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(envelopeTrack, 4, 6), false);
});

test('small overshoot into an adjacent different-source clip is not endpoint rounding', () => {
  const track = {
    clips: [
      clip({ id: 'a', source_id: 'take-1', source_in: 0, source_out: 5, timeline_start: 0 }),
      clip({ id: 'b', source_id: 'take-2', source_in: 5, source_out: 10, timeline_start: 5 }),
    ],
    gain_envelope: [],
  };
  assert.equal(canApplySelectionFade(track, 4, 5.03), false);
  assert.equal(applySelectionFade(track, 4, 5.03, 'fade_out'), null);
});
