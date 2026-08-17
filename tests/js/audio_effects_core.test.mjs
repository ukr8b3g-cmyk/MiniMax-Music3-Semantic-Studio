import test from 'node:test';
import assert from 'node:assert/strict';
import {
  createEffect,
  defaultEffectParams,
  effectDefinition,
  effectOwner,
  moveEffect,
  resetEffectParams,
  setEffectParam,
} from '../../web/audio_effects_core.js';

test('known effects are created disabled with deterministic defaults', () => {
  const effect = createEffect('compressor', () => 'fx-test');
  assert.equal(effect.id, 'fx-test');
  assert.equal(effect.type, 'compressor');
  assert.equal(effect.enabled, false);
  assert.deepEqual(effect.params, {
    threshold_db: -18,
    ratio: 4,
    attack_ms: 10,
    release_ms: 80,
    makeup_db: 0,
  });
  assert.equal(effectDefinition('compressor')?.category, 'Dynamics');
});

test('parameter edits clamp to the foundation control range', () => {
  const effect = createEffect('gain', () => 'fx-gain');
  assert.equal(setEffectParam(effect, 'gain_db', 200), 24);
  assert.equal(effect.params.gain_db, 24);
  assert.equal(setEffectParam(effect, 'gain_db', -200), -24);
  assert.equal(effect.params.gain_db, -24);
});

test('reset replaces params but preserves effect identity and unknown fields', () => {
  const effect = {
    id: 'fx-future',
    type: 'reverb',
    enabled: true,
    future: { keep: true },
    params: { room_size: 1, future_param: 9 },
  };
  resetEffectParams(effect);
  assert.equal(effect.id, 'fx-future');
  assert.equal(effect.enabled, true);
  assert.deepEqual(effect.future, { keep: true });
  assert.deepEqual(effect.params, defaultEffectParams('reverb'));
});

test('rack reordering is deterministic and bounded', () => {
  const effects = [
    { id: 'a' },
    { id: 'b' },
    { id: 'c' },
  ];
  assert.equal(moveEffect(effects, 'b', -1), true);
  assert.deepEqual(effects.map((item) => item.id), ['b', 'a', 'c']);
  assert.equal(moveEffect(effects, 'b', -1), false);
  assert.deepEqual(effects.map((item) => item.id), ['b', 'a', 'c']);
});

test('track and master owners remain separate arrays', () => {
  const project = {
    tracks: [{ id: 'main', effects: [{ id: 'track-fx' }] }],
    master: { effects: [{ id: 'master-fx' }] },
  };
  assert.equal(effectOwner(project, 'track').effects[0].id, 'track-fx');
  assert.equal(effectOwner(project, 'master').effects[0].id, 'master-fx');
});
