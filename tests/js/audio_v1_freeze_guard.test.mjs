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

test("single-audio compatibility layer installs no MutationObserver", () => {
  const release = source("web/zz_audio_v1_single_audio.js");
  assert.doesNotMatch(release, /new MutationObserver/);
  assert.doesNotMatch(release, /observer\.observe/);
  assert.match(release, /function prepareAudioDialog/);
  assert.match(release, /simplifyAudioEditor\(dialog\)/);
});

test("Semantic Studio observers are bounded to center replacement and cleaned on shell close", () => {
  const seed = source("web/zz_generation_seed_behavior.js");
  const quick = source("web/zz_semantic_quick_generation_controls.js");

  for (const [path, text] of [["seed", seed], ["quick", quick]]) {
    assert.doesNotMatch(text, /\.observe\(dialog,\s*\{[^}]*subtree:\s*true/, path);
    assert.match(text, /\.observe\(center, \{ childList: true, subtree: false \}\)/, path);
    assert.match(text, /m3ss-shell-close/, path);
    assert.match(text, /\.disconnect\(\)/, path);
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
  assert.match(seed, /m3ss-shell-close/);
});

test("Audio Editor DSP refresh cannot feed back from high-frequency dialog text updates", () => {
  const dsp = source("web/zz_audio_dsp_ui.js");
  const audio = source("web/zz_audio_effects_foundation.js");
  const shell = source("web/studio_shell.js");

  assert.doesNotMatch(dsp, /\.observe\(dialog,\s*\{[^}]*characterData:\s*true/);
  assert.match(dsp, /bodyObserver\?\.observe\(body, \{ childList: true, subtree: false \}\)/);
  assert.match(dsp, /dialog\.addEventListener\("m3ss-workspace-mode-change", workspaceChange\)/);
  assert.match(dsp, /dialog\.addEventListener\("m3ss-shell-close", cleanup, \{ once: true \}\)/);
  assert.match(shell, /windowEl\.dispatchEvent\(new CustomEvent\("m3ss-shell-close"\)\)/);
  assert.match(audio, /dialog\.addEventListener\("m3ss-shell-close", cleanupObservers, \{ once: true \}\)/);
  assert.doesNotMatch(audio, /characterData:\s*true/);
});

test("final renderer is restored without reintroducing the single-audio freeze observer", () => {
  const node = source("audio_editor_node.py");
  const release = source("web/zz_audio_v1_single_audio.js");

  assert.match(node, /render_audio_edit\(audio, edit_json\)/);
  assert.match(node, /AudioSaveHelper\.save_audio/);
  assert.match(node, /"m3ss_v2": \[metadata\]/);
  assert.match(node, /return io\.NodeOutput\(rendered_audio, ui=ui_payload\)/);
  assert.doesNotMatch(node, /\.clone\(/);
  assert.doesNotMatch(node, /normalized_edit_json/);
  assert.doesNotMatch(node, /state_b64/);
  assert.doesNotMatch(release, /new MutationObserver/);
});
