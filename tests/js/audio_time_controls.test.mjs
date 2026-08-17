import test from 'node:test';
import assert from 'node:assert/strict';
import {
  formatClock,
  parseClock,
  semanticDisplayValue,
  snapIntervalSeconds,
  snapTime,
} from '../../web/audio_time_controls.js';

test('formats editor position with hours, minutes and milliseconds', () => {
  assert.equal(formatClock(7.65), '00:00:07.650');
  assert.equal(formatClock(3661.125), '01:01:01.125');
});

test('parses seconds and clock forms', () => {
  assert.equal(parseClock('7.65'), 7.65);
  assert.equal(parseClock('01:02.500'), 62.5);
  assert.equal(parseClock('01:01:01.125'), 3661.125);
  assert.equal(parseClock('bad'), null);
});

test('calculates optional beat snap intervals and clamps snapped time', () => {
  assert.equal(snapIntervalSeconds(120, '1/4'), 0.5);
  assert.equal(snapIntervalSeconds(120, '1/8'), 0.25);
  assert.equal(snapIntervalSeconds(120, 'off'), 0);
  assert.equal(snapTime(0.37, 120, '1/8'), 0.25);
  assert.equal(snapTime(9.9, 120, '1/4', 9.8), 9.8);
});

test('semantic display values preserve custom text and provide fallback', () => {
  assert.equal(semanticDisplayValue('D flat major'), 'D flat major');
  assert.equal(semanticDisplayValue(''), '—');
});
