import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), "utf8");
}

test("Semantic Studio compresses chrome without shrinking Song Timeline rows", () => {
  const css = source("web/semantic_timeline_priority.css");
  assert.match(css, /\.m3ss-dialog \.m3shell-heading\{display:flex/);
  assert.match(css, /\.m3ss-final-polish \.m3ss-effective-key\{display:none!important\}/);
  assert.match(css, /\.m3ss-phase-a \.m3ss-timeline-view-head>div:first-child\{display:none!important\}/);
  assert.match(css, /\.m3ss-final-polish \.m3ss-history-actions\{order:20/);
  assert.doesNotMatch(css, /m3ss-tl-(?:row|structure-row|energy-row|detail-row|vocal-row).*height/);
});

test("Main Vocal receives the new collapsed release default once and remains user-toggleable", () => {
  const migration = source("web/zz_semantic_timeline_priority.js");
  assert.match(migration, /semantic-main-vocal-default-v2/);
  assert.match(migration, /semantic-main-vocal-open/);
  assert.match(migration, /setItem\(MAIN_VOCAL_KEY, "0"\)/);
  assert.match(migration, /setItem\(MIGRATION_KEY, "1"\)/);

  const studio = source("web/semantic_studio.js");
  assert.match(studio, /mainVocalOpen = !mainVocalOpen/);
  assert.match(studio, /writeLayoutNumber\("semantic-main-vocal-open", mainVocalOpen \? 1 : 0\)/);
});

test("Song Settings stay above Song Timeline and timeline content remains intact", () => {
  const studio = source("web/semantic_studio.js");
  const settings = studio.indexOf("center.appendChild(renderSongSettings())");
  const timeline = studio.indexOf('el("section", "m3ss-timeline-accordion")');
  assert.ok(settings >= 0 && timeline > settings);
  assert.match(studio, /renderSemanticTimeline\(host, project, selectedId/);
  assert.match(studio, /m3ss-main-vocal-summary/);
});

test("Timeline front restores only CFG and Duration quick generation controls", () => {
  const quick = source("web/zz_semantic_quick_generation_controls.js");
  const css = source("web/semantic_quick_generation_controls.css");
  assert.match(quick, /makeField\("CFG"/);
  assert.match(quick, /makeField\("Duration"/);
  assert.doesNotMatch(quick, /makeField\("Seed"/);
  assert.doesNotMatch(quick, /makeField\("Top-K"/);
  assert.doesNotMatch(quick, /makeField\("Auto Sync/);
  assert.match(quick, /syncDraftBeforeSave/);
  assert.match(quick, /durationDirty/);
  assert.match(quick, /auto\.checked = false/);
  assert.match(css, /m3ss-semantic-quick-field\.is-cfg/);
  assert.match(css, /m3ss-semantic-quick-field\.is-duration/);
});

test("Studio shell supports persisted drag position and drag-to-restore from maximized", () => {
  const shell = source("web/studio_shell.js");
  assert.match(shell, /function readPosition/);
  assert.match(shell, /function writePosition/);
  assert.match(shell, /header\.addEventListener\("pointerdown", dragStart\)/);
  assert.match(shell, /header\.setPointerCapture/);
  assert.match(shell, /dragState\.wasMaximized/);
  assert.match(shell, /setMaximized\(false\)/);
  assert.match(shell, /writePosition\(storageKey/);
  assert.match(shell, /m3shell-window-controls,button,input,select,textarea,a/);
});
