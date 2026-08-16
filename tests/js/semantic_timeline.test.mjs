import test from 'node:test';
import assert from 'node:assert/strict';
import { fitTimelineScale, resizeSectionDurations, sectionTimelineGeometry } from '../../web/semantic_timeline.js';

test('timeline geometry accumulates section durations', () => {
  const sections = [{ duration: 8 }, { duration: 24 }, { duration: 16 }];
  const geometry = sectionTimelineGeometry(sections);
  assert.deepEqual(geometry.map((item) => [item.start, item.end]), [[0, 8], [8, 32], [32, 48]]);
  assert.equal(geometry[1].center, 20);
});

test('shift-style resize preserves adjacent total duration', () => {
  const sections = [{ duration: 20 }, { duration: 10 }, { duration: 8 }];
  const result = resizeSectionDurations(sections, 0, 24, true);
  assert.equal(result.current, 24);
  assert.equal(result.next, 6);
  assert.equal(sections[0].duration + sections[1].duration, 30);
});

test('preserve-total resize respects minimum next duration', () => {
  const sections = [{ duration: 20 }, { duration: 1 }];
  const result = resizeSectionDurations(sections, 0, 30, true);
  assert.equal(result.next, 0.5);
  assert.equal(result.current, 20.5);
});

test('fit scale stays inside interactive bounds', () => {
  assert.equal(fitTimelineScale(2000, 100), 18.5);
  assert.equal(fitTimelineScale(300, 200), 3);
  assert.equal(fitTimelineScale(10000, 10), 20);
});
