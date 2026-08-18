import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Audio Editor top-level workspace remains Edit, Mixer, Effects before VST3", () => {
  const workspace = source("web/zz_audio_effects_foundation.js");
  const edit = workspace.indexOf('makeTab("edit"');
  const mixer = workspace.indexOf('makeTab("mixer"');
  const effects = workspace.indexOf('makeTab("effects"');
  assert.ok(edit >= 0 && mixer > edit && effects > mixer);
  assert.match(workspace, /mode:\s*"edit"/);
  assert.match(workspace, /m3ssSingleAudio\s*=\s*"1"/);
  assert.match(workspace, /renderSingleMixer/);
  assert.match(workspace, /renderSingleEffectsRack/);
  assert.match(workspace, /_m3ssSetWorkspaceMode/);
  assert.doesNotMatch(workspace, /trackTitle\.textContent\s*=\s*tr\("Track"/);
  assert.doesNotMatch(workspace, /masterTitle\.textContent\s*=\s*tr\("Master"/);

  const vst = source("web/vst3_extension.js");
  assert.match(vst, /createVst3ReleasePanel/);
  assert.match(vst, /dataset\.m3ssMode\s*=\s*"vst3"/);
  assert.match(vst, /data-m3ss-mode="effects"/);
  assert.match(vst, /effectsTab\.after\(vstTab\)/);
  assert.match(vst, /_m3ssSetWorkspaceMode\?\.\("vst3"\)/);
});

test("Single audio pipeline preserves historical internal stages until explicit reorder", () => {
  const pipeline = source("web/audio_single_pipeline.js");
  assert.match(pipeline, /pipelineLocations/);
  assert.match(pipeline, /stage:\s*"input"/);
  assert.match(pipeline, /stage:\s*"output"/);
  assert.match(pipeline, /location\.list\.splice/);
  assert.match(pipeline, /master\.effects\.push\(effect\)/);
  assert.doesNotMatch(pipeline, /track\.effects = \[\.\.\.track\.effects, \.\.\.master\.effects\]/);
  assert.match(pipeline, /const boundary = track\.effects\.length/);
  assert.match(pipeline, /track\.effects = all\.slice\(0, boundary\)/);
  assert.match(pipeline, /master\.effects = all\.slice\(boundary\)/);
  assert.match(pipeline, /Input Gain \(dB\)/);
  assert.match(pipeline, /Output Gain \(dB\)/);
  assert.doesNotMatch(pipeline, /Track Effects/);
  assert.doesNotMatch(pipeline, /Master Effects/);
});

test("VST3 release browser is one Add target and one Rack", () => {
  const vst = source("web/vst3_release_browser.js");
  assert.match(vst, /button\("Plugins"/);
  assert.match(vst, /button\("Rack"/);
  assert.match(vst, /button\("\+ Add"/);
  assert.doesNotMatch(vst, /\+ Track/);
  assert.doesNotMatch(vst, /\+ Master/);
  assert.match(vst, /Favorites/);
  assert.match(vst, /Recent/);
  assert.match(vst, /All Vendors/);
  assert.match(vst, /All Categories/);
  assert.match(vst, /saveVst3Preset/);
  assert.match(vst, /listVst3Presets/);
  assert.match(vst, /closeVst3NativeEditor/);
});

test("VST3 mutations use Audio Editor project commit for Undo and Redo", () => {
  const vst = source("web/vst3_release_browser.js");
  assert.match(vst, /ctx\.commit\(\(\) => appendPipelineEffect/);
  assert.match(vst, /ctx\.commit\(\(\) => mutatePipelineEffect/);
  assert.match(vst, /ctx\.commit\(\(\) => movePipelineEffect/);
  assert.match(vst, /ctx\.commit\(\(\) => removePipelineEffect/);
  const bridge = source("web/vst3_extension.js");
  assert.match(bridge, /label !== "Undo" && label !== "Redo"/);
  assert.match(bridge, /panel\.refreshFromProject/);
});

test("VST3 preset library uses IndexedDB rather than localStorage for state blobs", () => {
  const presets = source("web/vst3_preset_store.js");
  assert.match(presets, /indexedDB\.open/);
  assert.match(presets, /createObjectStore/);
  assert.match(presets, /plugin_key/);
  assert.doesNotMatch(presets, /localStorage/);
});

test("Phase 2D keeps the experienced-user visual language compact", () => {
  const css = source("web/audio_workspace_polish.css");
  assert.match(css, /\.m3ssv2-workspace-tab\.is-active/);
  assert.match(css, /\.is-tools \.m3ssv2-command-button\.is-active/);
  assert.match(css, /\.m3ssv2-vst3-view-tab\.is-active/);
  const phase2d = source("web/audio_phase2d.css");
  assert.match(phase2d, /m3ssv2-vst3-filters/);
  assert.match(phase2d, /m3ssv2-vst3-preset-bar/);
  assert.match(phase2d, /nth-child\(2\)\{display:none!important\}/);
});

test("Release chrome hides schema and Track/Master wording from normal summaries", () => {
  const summary = source("web/node_compact.js");
  assert.match(summary, /releaseSummary/);
  assert.match(summary, /schema\\s\*\\d\+/i);
  const empty = source("web/audio_empty_editor.js");
  assert.match(empty, /Audio Waveform/);
  assert.match(empty, /Input Gain/);
  assert.doesNotMatch(empty, /Main Track Waveform/);
  assert.doesNotMatch(empty, /Track Gain/);
  assert.doesNotMatch(empty, /Track Pan/);
});
