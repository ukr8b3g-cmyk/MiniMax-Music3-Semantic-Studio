import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Audio Editor top-level workspace order is Edit, Mixer, Effects before VST3", () => {
  const workspace = source("web/zz_audio_effects_foundation.js");
  const edit = workspace.indexOf('makeTab("edit"');
  const mixer = workspace.indexOf('makeTab("mixer"');
  const effects = workspace.indexOf('makeTab("effects"');
  assert.ok(edit >= 0 && mixer > edit && effects > mixer);
  assert.match(workspace, /mode:\s*"edit"/);

  const vst = source("web/vst3_extension.js");
  assert.match(vst, /dataset\.m3ssMode\s*=\s*"vst3"/);
  assert.match(vst, /data-m3ss-mode=\\"effects\\"/);
  assert.match(vst, /effectsTab\.after\(vstTab\)/);
  assert.match(vst, /m3ssv2-workspace-tab m3ssv2-vst3-tab/);
});

test("VST3 opens as a compact plugin browser with Rack as a secondary view", () => {
  const vst = source("web/vst3_browser.js");
  const plugins = vst.indexOf('button("Plugins"');
  const rack = vst.indexOf('button("Rack"');
  assert.ok(plugins >= 0 && rack > plugins);
  assert.match(vst, /dataset\.m3ssVst3View\s*=\s*"plugins"/);
  assert.match(vst, /placeholder\s*=\s*"Search VST3…"/);
  assert.match(vst, /closeVst3NativeEditor/);
  assert.doesNotMatch(vst, /VST3 Plugins · Phase 2B/);
  assert.doesNotMatch(vst, /Scan folders/);
  assert.doesNotMatch(vst, /Native Plugin UI runs in an isolated helper process/);
});

test("Audio Editor selection states share one visual language", () => {
  const css = source("web/audio_workspace_polish.css");
  assert.match(css, /\.m3ssv2-workspace-tab\.is-active/);
  assert.match(css, /\.is-tools \.m3ssv2-command-button\.is-active/);
  assert.match(css, /\.m3ssv2-fx-owner\.is-active/);
  assert.match(css, /\.m3ssv2-vst3-view-tab\.is-active/);
});

test("VST3 plugin and rack panes reserve the primary scroll area", () => {
  const css = source("web/vst3_browser.css");
  assert.match(css, /\.m3ssv2-vst3-pane\{grid-row:4;/);
  assert.match(css, /\.m3ssv2-vst3-list\{[^}]*overflow:auto/);
  assert.match(css, /\.m3ssv2-vst3-rack-pane\{[^}]*overflow:auto/);
});
