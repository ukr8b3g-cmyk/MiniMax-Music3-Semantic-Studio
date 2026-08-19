import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const source = fs.readFileSync(new URL("../../web/audio_single_pipeline.js", import.meta.url), "utf8");

test("Effects workspace exposes whole-audio Fade In and Fade Out controls", () => {
  assert.match(source, /Fade In \/ Fade Out/);
  assert.match(source, /Fade In \(s\)/);
  assert.match(source, /Fade Out \(s\)/);
  assert.match(source, /fade_in/);
  assert.match(source, /fade_out/);
  assert.match(source, /equal_power/);
  assert.match(source, /existing non-destructive clip fade engine/);
});

test("fade controls target the first and last timeline clips without adding a new DSP effect type", () => {
  assert.match(source, /export function audioEdgeClips/);
  assert.match(source, /Number\(clip\.timeline_start \|\| 0\)/);
  assert.match(source, /clipEnd\(clip\) > clipEnd\(best\)/);
  assert.doesNotMatch(source, /createEffect\("fade_(?:in|out)"/);
});
