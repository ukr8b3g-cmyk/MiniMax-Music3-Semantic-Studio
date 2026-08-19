import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Semantic node delegates compatibility to the connected Music3-style CLIP", () => {
  const node = source("nodes.py");
  assert.doesNotMatch(node, /def validate_inputs/);
  assert.doesNotMatch(node, /model[_ ]?(?:name|type)|checkpoint[_ ]?name|allowlist/i);
  assert.match(node, /clip\.tokenize\(/);
  assert.match(node, /clip\.encode_from_tokens_scheduled\(tokens\)/);
});

test("Semantic project mistakes normalize instead of preflight stopping", () => {
  const project = source("semantic_project.py");
  assert.match(project, /Invalid project JSON was ignored for this run/);
  assert.match(project, /return "Instrumental"/);
  assert.match(project, /sections = sections\[:MAX_SECTIONS\]/);
  assert.match(project, /No usable timeline sections were present/);
  assert.doesNotMatch(project, /Unsupported Semantic Studio schema_version/);
  assert.doesNotMatch(project, /requires at least one timeline section/);
});

test("Audio edit normalization repairs legacy references and limits without stopping", () => {
  const edit = source("audio_edit_project.py");
  assert.match(edit, /source_id = "take-1"/);
  assert.match(edit, /tracks_raw = tracks_raw\[:MAX_TRACKS\]/);
  assert.match(edit, /remaining = max\(0, MAX_CLIPS - total_clips\)/);
  assert.doesNotMatch(edit, /supports at most .* edit tracks/);
  assert.doesNotMatch(edit, /references .* but that take is not connected/);
  assert.doesNotMatch(edit, /has an empty source range/);
});

test("Optional DSP and VST3 failures bypass the individual effect", () => {
  const dsp = source("audio_effects_dsp.py");
  const vst = source("vst3_host.py");
  assert.match(dsp, /bypassing unsupported effect/);
  assert.doesNotMatch(dsp, /has enabled unsupported effect/);
  assert.match(vst, /bypassing VST3/);
  assert.match(vst, /except Exception as exc/);
});

test("Prompt Import remains usable as recovery surface", () => {
  const importer = source("web/prompt_import_extension.js");
  assert.match(importer, /current = normalizeProject\(\{\}\)/);
  assert.doesNotMatch(importer, /cannot import until project_json is valid/);
});
