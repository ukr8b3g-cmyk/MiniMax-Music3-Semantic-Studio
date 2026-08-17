import test from 'node:test';
import assert from 'node:assert/strict';
import { applyEffectChain } from '../../web/audio_effects_dsp.js';

const fx = (type, params = {}, enabled = true) => ({ id: `fx-${type}`, type, enabled, params });

function peak(channels) {
  let value = 0;
  for (const channel of channels) for (const sample of channel) value = Math.max(value, Math.abs(sample));
  return value;
}

test('gain and stereo width have deterministic parity-friendly behavior', () => {
  const gained = applyEffectChain([Float32Array.from([.25, -.25])], 48000, [fx('gain', { gain_db: 6.020599913 })]);
  assert.ok(Math.abs(gained[0][0] - .5) < 1e-6);
  assert.ok(Math.abs(gained[0][1] + .5) < 1e-6);

  const width = applyEffectChain([
    Float32Array.from([1, 0]),
    Float32Array.from([0, 1]),
  ], 48000, [fx('stereo_width', { width_percent: 0 })]);
  assert.deepEqual([...width[0]], [.5, .5]);
  assert.deepEqual([...width[1]], [.5, .5]);
});

test('filters attenuate their rejection bands', () => {
  const dc = [new Float32Array(48000).fill(1)];
  const highPassed = applyEffectChain(dc, 48000, [fx('high_pass', { cutoff_hz: 120, slope_db_oct: 24 })]);
  let tail = 0;
  for (let i = 47000; i < 48000; i++) tail += Math.abs(highPassed[0][i]);
  assert.ok(tail / 1000 < 1e-3);

  const alternating = [Float32Array.from({ length: 48000 }, (_, i) => i % 2 ? -1 : 1)];
  const lowPassed = applyEffectChain(alternating, 48000, [fx('low_pass', { cutoff_hz: 1000, slope_db_oct: 24 })]);
  assert.ok(peak(lowPassed) < .1);
});

test('compressor reduces sustained level and limiter respects ceiling', () => {
  const loud = [new Float32Array(48000).fill(.9)];
  const compressed = applyEffectChain(loud, 48000, [fx('compressor', {
    threshold_db: -12, ratio: 4, attack_ms: 10, release_ms: 100, makeup_db: 0,
  })]);
  let tail = 0;
  for (let i = 47000; i < 48000; i++) tail += Math.abs(compressed[0][i]);
  assert.ok(tail / 1000 < .5);

  const hot = [Float32Array.from({ length: 4000 }, (_, i) => [0.2, 2, -2, .5][i % 4])];
  const limited = applyEffectChain(hot, 48000, [fx('limiter', {
    input_gain_db: 0, ceiling_db: -1, release_ms: 100, lookahead_ms: 1,
  })]);
  assert.ok(peak(limited) <= Math.pow(10, -1 / 20) + 1e-6);
});

test('disabled effects are neutral and unsupported enabled effects fail closed', () => {
  const input = [Float32Array.from([.1, .2])];
  const disabled = applyEffectChain(input, 48000, [fx('gain', { gain_db: 12 }, false)]);
  assert.equal(disabled, input);
  assert.throws(() => applyEffectChain(input, 48000, [fx('reverb')]), /unsupported effect/);
});
