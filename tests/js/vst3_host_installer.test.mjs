import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

function source(path) {
  return fs.readFileSync(new URL(`../../${path}`, import.meta.url), 'utf8');
}

test('VST3 host setup is manual and exposes no backend install route', () => {
  const ui = source('web/zz_vst3_host_installer.js');
  const backend = source('__init__.py');
  const setup = source('vst3_install.py');
  assert.match(ui, /Copy Install Command/);
  assert.match(ui, /manual_install_required/);
  assert.doesNotMatch(ui, /\/m3ss\/vst3\/install-host/);
  assert.doesNotMatch(backend, /\/m3ss\/vst3\/install-host/);
  assert.doesNotMatch(setup, /subprocess|install_vst3_host/);
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

test('native editor process routes require the explicit local action marker', () => {
  const ui = source('web/vst3_browser.js');
  const backend = source('__init__.py');
  assert.match(ui, /X-M3SS-Local-Action/);
  assert.match(ui, /vst3-ui/);
  assert.match(backend, /local_vst3_route\(require_user_action=True\)/);
});
