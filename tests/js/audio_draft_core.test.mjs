import test from 'node:test';
import assert from 'node:assert/strict';
import { buildEnvelopeAmplitude, renderDraftProject } from '../../web/audio_draft_core.js';
import { makeWaveformDisplayProject } from '../../web/audio_draft_preview.js';

const source = (channels, sampleRate = 4) => ({ sampleRate, channels: channels.map((items) => Float32Array.from(items)) });
const project = (track = {}, master = {}) => ({
  tracks: [{
    id: 'main', name: 'Main Track', muted: false, solo: false, gain_db: 0, pan: 0,
    gain_envelope: [], effects: [],
    clips: [{
      id: 'clip', source_id: 'take-1', source_in: 0, source_out: 1, timeline_start: 0,
      gain_db: 0, pan: 0, muted: false, reverse: false,
      fade_in: { duration: 0, curve: 'linear' }, fade_out: { duration: 0, curve: 'linear' }, gain_envelope: [],
    }],
    ...track,
  }],
  master: { gain_db: 0, channel_mode: 'preserve', normalize: { enabled: false, target_peak_dbfs: -1 }, effects: [], ...master },
});

test('track mute and envelope affect draft output', () => {
  const input = { 'take-1': source([[1, 1, 1, 1]]) };
  const muted = renderDraftProject(project({ muted: true }), input);
  assert.deepEqual([...muted.channels[0]], [0, 0, 0, 0]);

  const automated = renderDraftProject(project({ gain_envelope: [{ time: .25, gain_db: -6.020599913 }, { time: .75, gain_db: 0 }] }), input);
  assert.ok(Math.abs(automated.channels[0][0] - .5) < 1e-4);
  assert.ok(Math.abs(automated.channels[0][3] - 1) < 1e-4);
});

test('waveform display project removes only track envelope automation', () => {
  const state = project({
    gain_db: 3,
    pan: -.25,
    gain_envelope: [{ time: .25, gain_db: -12 }, { time: .75, gain_db: 3 }],
    custom_future_field: { keep: true },
  });
  const display = makeWaveformDisplayProject(state);
  assert.notEqual(display, state);
  assert.notEqual(display.tracks[0], state.tracks[0]);
  assert.deepEqual(display.tracks[0].gain_envelope, []);
  assert.deepEqual(state.tracks[0].gain_envelope, [{ time: .25, gain_db: -12 }, { time: .75, gain_db: 3 }]);
  assert.equal(display.tracks[0].gain_db, 3);
  assert.equal(display.tracks[0].pan, -.25);
  assert.deepEqual(display.tracks[0].custom_future_field, { keep: true });
  assert.equal(display.tracks[0].clips, state.tracks[0].clips);
});

test('clip cuts, reverse and track pan mirror the declarative model', () => {
  const input = { 'take-1': source([[1, 2, 3, 4], [5, 6, 7, 8]]) };
  const state = project({ pan: 1 });
  Object.assign(state.tracks[0].clips[0], { source_in: .25, source_out: 1, reverse: true });
  const rendered = renderDraftProject(state, input);
  assert.deepEqual([...rendered.channels[0]], [0, 0, 0]);
  assert.deepEqual([...rendered.channels[1]], [8, 7, 6]);
});

test('envelope builder holds outer track points', () => {
  const curve = buildEnvelopeAmplitude(4, 4, [{ time: .25, gain_db: -6.020599913 }, { time: .75, gain_db: 0 }]);
  assert.ok(Math.abs(curve[0] - .5) < 1e-4);
  assert.ok(Math.abs(curve[1] - .5) < 1e-4);
  assert.ok(Math.abs(curve[3] - 1) < 1e-4);
});

test('draft fades match backend endpoint direction', () => {
  const input = { 'take-1': source([[1, 1, 1, 1]]) };
  const state = project();
  state.tracks[0].clips[0].fade_in = { duration: .5, curve: 'linear' };
  state.tracks[0].clips[0].fade_out = { duration: .5, curve: 'linear' };
  const rendered = renderDraftProject(state, input);
  assert.ok(Math.abs(rendered.channels[0][0] - 0) < 1e-6);
  assert.ok(Math.abs(rendered.channels[0][1] - 1) < 1e-6);
  assert.ok(Math.abs(rendered.channels[0][2] - 1) < 1e-6);
  assert.ok(Math.abs(rendered.channels[0][3] - 0) < 1e-6);
});
