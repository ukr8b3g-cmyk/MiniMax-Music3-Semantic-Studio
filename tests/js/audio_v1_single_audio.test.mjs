import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("V1.0 diagnostic Audio Editor restores preview metadata without final rendering", () => {
  const node = source("audio_editor_node.py");
  assert.match(node, /V1\.0 diagnostic preview\/meta-only build/);
  assert.match(node, /io\.Audio\.Input\("audio"/);
  assert.doesNotMatch(node, /io\.Audio\.Input\("take_[234]"/);
  assert.doesNotMatch(node, /take_2=None/);
  assert.doesNotMatch(node, /def validate_inputs/);
  assert.match(node, /sources, infos = collect_sources\(audio\)/);
  assert.match(node, /normalize_edit_project\(edit_json, infos\)/);
  assert.match(node, /AudioSaveHelper\.save_audio/);
  assert.match(node, /"takes": source_previews/);
  assert.match(node, /"m3ss_v2": \[metadata\]/);
  assert.match(node, /return io\.NodeOutput\(rendered_audio, ui=ui_payload\)/);
  assert.doesNotMatch(node, /render_audio_edit\(/);
  assert.doesNotMatch(node, /\.clone\(/);
  assert.doesNotMatch(node, /normalized_edit_json/);
  assert.doesNotMatch(node, /state_b64/);
});

test("V1.0 frontend removes user-facing take and Track/Master concepts", () => {
  const release = source("web/zz_audio_v1_single_audio.js");
  assert.match(release, /Main Track Waveform", "Audio Waveform"/);
  assert.match(release, /"Track"\) tab\.textContent = "Audio"/);
  assert.match(release, /"Master"\) tab\.textContent = "Output"/);
  assert.match(release, /text === "Takes"/);
  assert.match(release, /removeFieldByLabel\(dialog, "Source take"\)/);
  assert.match(release, /text === "Use Preview Take"/);
  assert.match(release, /Original Audio/);
});

test("package release version is 1.0.0", () => {
  const pyproject = source("pyproject.toml");
  assert.match(pyproject, /version = "1\.0\.0"/);
});
