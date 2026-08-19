import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("V1.0 single-audio compatibility layer never observes the whole ComfyUI document", () => {
  const release = source("web/zz_audio_v1_single_audio.js");
  assert.doesNotMatch(release, /observe\(document\.(?:documentElement|body)/);
  assert.doesNotMatch(release, /new MutationObserver\(scan\)/);
  assert.match(release, /observer\.observe\(dialog, \{ childList: true, subtree: true \}\)/);
  assert.match(release, /Open Audio Editor/);
  assert.match(release, /_m3ssV1SingleAudioObserver/);
});
