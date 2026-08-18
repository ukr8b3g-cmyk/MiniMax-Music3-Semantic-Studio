import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const shell = fs.readFileSync(new URL("../../web/studio_shell.js", import.meta.url), "utf8");

test("studio shell persists normal position and supports drag-to-restore", () => {
  assert.match(shell, /readStoredObject\(storageKey, "position"\)/);
  assert.match(shell, /writeStoredObject\(storageKey, "position"/);
  assert.match(shell, /header\.addEventListener\("pointerdown", dragStart\)/);
  assert.match(shell, /Math\.hypot\(dx, dy\) < 4/);
  assert.match(shell, /if \(dragState\.wasMaximized\)/);
  assert.match(shell, /setMaximized\(false\)/);
  assert.match(shell, /placeWindow\(/);
});
