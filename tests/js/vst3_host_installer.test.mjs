import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('VST3 host installer is explicit and fixed to the backend install route', () => {
  const ui = source('web/zz_vst3_host_installer.js');
  assert.match(ui, /Install VST3 Host/);
  assert.match(ui, /\/m3ss\/vst3\/install-host/);
  assert.match(ui, /method:\s*"POST"/);
  assert.match(ui, /install_available/);
});

test('VST3 host installer adds no mutation observer or polling loop', () => {
  const ui = source('web/zz_vst3_host_installer.js');
  assert.doesNotMatch(ui, /MutationObserver/);
  assert.doesNotMatch(ui, /setInterval/);
  assert.match(ui, /m3ss-audio-workspace-ready/);
  assert.match(ui, /m3ss-workspace-mode-change/);
  assert.match(ui, /m3ss-shell-close/);
});

test('normal installation no longer declares Pedalboard as a root dependency', () => {
  assert.equal(fs.existsSync(new URL('../../requirements.txt', import.meta.url)), false);
  const fallback = source('requirements-vst3.txt');
  assert.match(fallback, /^pedalboard>=0\.9\.24,<1/m);
});
