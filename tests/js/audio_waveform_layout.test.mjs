import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const waveform = fs.readFileSync(new URL("../../web/audio_waveform.js", import.meta.url), "utf8");

test("Audio Editor waveform no longer reserves the removed semantic section band", () => {
  assert.match(waveform, /const WAVE_TOP = 8;/);
  assert.doesNotMatch(waveform, /m3ssv2-semantic-overlay/);
  assert.doesNotMatch(waveform, /renderSections\(\)/);
  assert.match(waveform, /setSemanticSections\(\) \{\}/);
});
