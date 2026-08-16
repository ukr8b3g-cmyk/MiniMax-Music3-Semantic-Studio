import test from 'node:test';
import assert from 'node:assert/strict';
import {
  extractTimelineRange,
  pasteTimelineClipboard,
  removeTimelineRange,
  sliceClipToRange,
} from '../../web/audio_edit_commands.js';

function clip(overrides = {}) {
  return {
    id: 'c1', source_id: 'take-1', source_in: 0, source_out: 10, timeline_start: 0,
    gain_db: 0, pan: 0, muted: false, reverse: false,
    fade_in: { duration: 1, curve: 'linear' }, fade_out: { duration: 1, curve: 'linear' },
    gain_envelope: [{ time: 2, gain_db: -3 }, { time: 7, gain_db: 2 }],
    ...overrides,
  };
}

test('slice remaps source range, fades and envelope', () => {
  const out = sliceClipToRange(clip(), 2, 8);
  assert.equal(out.source_in, 2);
  assert.equal(out.source_out, 8);
  assert.equal(out.timeline_start, 2);
  assert.equal(out.fade_in.duration, 0);
  assert.equal(out.fade_out.duration, 0);
  assert.deepEqual(out.gain_envelope, [{ time: 0, gain_db: -3 }, { time: 5, gain_db: 2 }]);
});

test('reverse slice maps timeline trims to reversed source boundaries', () => {
  const out = sliceClipToRange(clip({ reverse: true }), 2, 8);
  assert.equal(out.source_in, 2);
  assert.equal(out.source_out, 8);
});

test('extract creates relative internal clipboard clips', () => {
  const track = { clips: [clip({ timeline_start: 5, source_in: 10, source_out: 20 })] };
  const payload = extractTimelineRange(track, 8, 12);
  assert.equal(payload.duration, 4);
  assert.equal(payload.clips.length, 1);
  assert.equal(payload.clips[0].timeline_start, 0);
  assert.equal(payload.clips[0].source_in, 13);
  assert.equal(payload.clips[0].source_out, 17);
});

test('non-ripple removal leaves a gap while ripple removal closes it', () => {
  const gap = { clips: [clip({ source_out: 20 }), clip({ id: 'c2', source_in: 0, source_out: 5, timeline_start: 25 })] };
  removeTimelineRange(gap, 5, 10, { ripple: false, makeId: () => 'right' });
  assert.deepEqual(gap.clips.map((c) => [c.id, c.timeline_start]), [['c1', 0], ['right', 10], ['c2', 25]]);

  const ripple = { clips: [clip({ source_out: 20 }), clip({ id: 'c2', source_in: 0, source_out: 5, timeline_start: 25 })] };
  removeTimelineRange(ripple, 5, 10, { ripple: true, makeId: () => 'right' });
  assert.deepEqual(ripple.clips.map((c) => [c.id, c.timeline_start]), [['c1', 0], ['right', 5], ['c2', 20]]);
});

test('paste re-ids clips and anchors them at the playhead', () => {
  const track = { clips: [] };
  const pasted = pasteTimelineClipboard(track, { duration: 4, clips: [clip({ timeline_start: 1 })] }, 20, { makeId: () => 'new' });
  assert.equal(pasted[0].id, 'new');
  assert.equal(pasted[0].timeline_start, 21);
  assert.equal(track.clips.length, 1);
});
