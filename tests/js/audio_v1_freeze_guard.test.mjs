import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

const scopedRuntimeLayers = [
  "web/zz_audio_v1_single_audio.js",
  "web/zz_semantic_quick_generation_controls.js",
  "web/zz_generation_seed_behavior.js",
  "web/zz_audio_effects_foundation.js",
  "web/zz_audio_dsp_ui.js",
  "web/zz_audio_phase2d_chrome.js",
  "web/vst3_extension.js",
];

test("release runtime layers never observe the whole ComfyUI document", () => {
  for (const path of scopedRuntimeLayers) {
    const text = source(path);
    assert.doesNotMatch(text, /\.observe\(\s*document\.(?:documentElement|body)\b/, path);
  }
});

test("Audio and Semantic Studio enhancements are mounted from explicit open/dialog scope", () => {
  const audio = source("web/zz_audio_effects_foundation.js");
  const dsp = source("web/zz_audio_dsp_ui.js");
  const chrome = source("web/zz_audio_phase2d_chrome.js");
  const vst3 = source("web/vst3_extension.js");
  const seed = source("web/zz_generation_seed_behavior.js");

  assert.match(audio, /m3ss-audio-workspace-ready/);
  assert.match(dsp, /m3ss-audio-workspace-ready/);
  assert.match(chrome, /m3ss-audio-workspace-ready/);
  assert.match(vst3, /m3ss-audio-workspace-ready/);
  assert.match(seed, /observer\.observe\(dialog, \{ childList: true, subtree: true \}\)/);
});

test("Audio Editor completion restores previews but never clones connected waveform state", () => {
  const node = source("audio_editor_node.py");
  const render = source("audio_render.py");

  assert.match(node, /AudioSaveHelper\.save_audio/);
  assert.match(node, /"m3ss_v2": \[metadata\]/);
  assert.match(node, /return io\.NodeOutput\(rendered_audio, ui=ui_payload\)/);
  assert.doesNotMatch(node, /\.clone\(/);
  assert.doesNotMatch(render, /\.clone\(/);
  assert.doesNotMatch(node, /normalized_edit_json/);
  assert.doesNotMatch(node, /state_b64/);
  assert.match(render, /rendered = waveform\[\.\.\., start:end\]/);
  assert.match(render, /rendered = rendered \* control\.view\(1, 1, -1\)/);
});
