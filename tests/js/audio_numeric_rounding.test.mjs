import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { roundedNumericText } from '../../web/zz_audio_numeric_rounding.js';

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('Audio Editor numeric presentation follows control step precision', () => {
  assert.equal(roundedNumericText(25.123456789, .001), '25.123');
  assert.equal(roundedNumericText(0.30000000000000004, .01), '0.3');
  assert.equal(roundedNumericText(-1.2500000000000002, .1), '-1.3');
  assert.equal(roundedNumericText(100.00000000001, 1), '100');
});

test('numeric rounding is event-driven and adds no MutationObserver or polling loop', () => {
  const release = source('web/zz_audio_numeric_rounding.js');
  assert.doesNotMatch(release, /MutationObserver/);
  assert.doesNotMatch(release, /setInterval/);
  assert.match(release, /m3ss-audio-workspace-ready/);
  assert.match(release, /m3ss-workspace-mode-change/);
  assert.match(release, /m3ss-shell-close/);
});
