import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLoopRange, loopPlaybackJump } from '../../web/audio_playback_loop.js';

test('loop range clamps to duration and rejects empty selections', () => {
  assert.deepEqual(normalizeLoopRange({ start: -1, end: 3 }, 2), { start: 0, end: 2 });
  assert.equal(normalizeLoopRange({ start: 1, end: 1.01 }, 2), null);
  assert.equal(normalizeLoopRange(null, 2), null);
});

test('loop jump returns range start at or beyond selection end', () => {
  const range = { start: 1, end: 2 };
  assert.equal(loopPlaybackJump(.5, range, 3), 1);
  assert.equal(loopPlaybackJump(1.5, range, 3), null);
  assert.equal(loopPlaybackJump(1.995, range, 3), 1);
  assert.equal(loopPlaybackJump(2.2, range, 3), 1);
});
