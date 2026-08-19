import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("V1.0 Audio Editor exposes one AUDIO input while preserving legacy schema internals", () => {
  const node = source("audio_editor_node.py");
  assert.match(node, /V1\.0 non-destructive single-audio editor/);
  assert.match(node, /io\.Audio\.Input\("audio"/);
  assert.doesNotMatch(node, /io\.Audio\.Input\("take_[234]"/);
  assert.doesNotMatch(node, /take_2=None/);
  assert.doesNotMatch(node, /def validate_inputs/);
  assert.match(node, /collect_sources\(audio\)/);
  assert.match(node, /render_audio_edit\(audio, edit_json\)\.audio/);
  assert.match(node, /return io\.NodeOutput\(rendered_audio\)/);
  assert.doesNotMatch(node, /AudioSaveHelper/);
  assert.doesNotMatch(node, /"takes": source_previews/);
  assert.match(node, /future schemas are interpreted where possible/);
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
