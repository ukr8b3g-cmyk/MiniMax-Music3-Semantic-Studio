import test from 'node:test';
import assert from 'node:assert/strict';
import { renderDraftProject } from '../../web/audio_draft_core.js';

const source = (items, sampleRate = 4) => ({ sampleRate, channels: [Float32Array.from(items)] });

function project(trackEffects = [], masterEffects = []) {
  return {
    tracks: [{
      id: 'main', name: 'Audio', muted: false, solo: false, gain_db: 0, pan: 0,
      gain_envelope: [], effects: trackEffects,
      clips: [{
        id: 'clip', source_id: 'take-1', source_in: 0, source_out: 1, timeline_start: 0,
        gain_db: 0, pan: 0, muted: false, reverse: false,
        fade_in: { duration: 0, curve: 'linear' },
        fade_out: { duration: 0, curve: 'linear' },
        gain_envelope: [],
      }],
    }],
    master: {
      gain_db: 0,
      channel_mode: 'preserve',
      normalize: { enabled: false, target_peak_dbfs: -1 },
      effects: masterEffects,
    },
  };
}

test('Browser Draft bypasses enabled VST3 while preserving built-in DSP', () => {
  const input = { 'take-1': source([.25, .25, .25, .25]) };
  const vst = { id: 'vst', type: 'vst3', enabled: true, params: { path: 'test.vst3' } };
  const gain = { id: 'gain', type: 'gain', enabled: true, params: { gain_db: 6.020599913 } };

  const trackRendered = renderDraftProject(project([vst, gain]), input);
  assert.ok([...trackRendered.channels[0]].every((value) => Math.abs(value - .5) < 1e-5));

  const masterRendered = renderDraftProject(project([], [vst, gain]), input);
  assert.ok([...masterRendered.channels[0]].every((value) => Math.abs(value - .5) < 1e-5));
});

test('Browser Draft still rejects unknown non-VST effects', () => {
  const input = { 'take-1': source([.25, .25, .25, .25]) };
  const unknown = { id: 'future', type: 'future_fx', enabled: true, params: {} };
  assert.throws(() => renderDraftProject(project([unknown]), input), /unsupported effect/);
});
