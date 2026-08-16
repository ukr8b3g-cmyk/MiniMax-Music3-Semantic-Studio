# Music3 Semantic Studio UX Foundation

Status: implemented between V2.0 and V2.1. This is a cross-phase UI architecture refactor, not a new model-generation phase.

## Goals

- keep both ComfyUI nodes compact by hiding raw persisted JSON widgets
- provide one shared resizable/maximizable editor shell for Semantic Studio and Audio Editor
- use progressive disclosure: navigation + contextual inspector instead of showing every control at once
- preserve the V1 `project_json` and V2 `edit_json` public data contracts
- leave explicit extension points for future effects, automation, take management, and V3 conditioning tracks

## Shared frontend layers

```text
studio_shell.js / studio_shell.css
  └─ shared window lifecycle, native resize, maximize/restore, remembered size, container-responsive layout

layout_splitter.js
  └─ reusable keyboard-accessible pane/column resizing with local UI-size persistence

node_compact.js
  └─ hide internal JSON widgets and expose read-only node summaries

Semantic Studio
  ├─ semantic_studio_core.js  state normalization, compiler preview helpers, controls
  └─ semantic_studio.js       navigation, workspace, resizable structure table, section inspector, save lifecycle

Audio Editor
  ├─ audio_editor_core.js      edit model and commands
  ├─ audio_waveform.js         waveform, transport, wheel zoom, fit/reset, selected-clip envelope overlay
  ├─ audio_timeline.js         clip plan and optional take lanes on the waveform time scale
  ├─ audio_panels.js           Clip / Envelope / Master / Takes inspectors
  └─ audio_editor.js           workspace controller, resizable inspector, undo/redo, save lifecycle
```

## Window behavior

Both editors use the shared shell. Desktop behavior:

- native corner/edge resize
- Maximize / Restore
- remembered non-maximized dimensions in browser local storage
- responsive internal layout follows the **editor window width**, not only the browser viewport
- Escape closes the editor

On narrow viewports the shell automatically uses the available viewport and disables manual resize.

## Semantic Studio interaction model

Left navigation:

- Overview
- Global
- Lyrics
- Vocal
- Arrangement
- Advanced
- Prompt Preview

The center area contains the selected workspace. The right Section Inspector stays contextual to the selected song section.

The center/Inspector separator is draggable. Inspector width is stored as UI preference in browser local storage rather than in `project_json`.

Song Structure behaves like a compact editing table:

- larger row and text sizing for readability
- visible column separators
- Section / Type / Duration / Energy / Instruments columns are individually resizable
- double-click a column divider to restore its default width
- column widths are UI preferences and are not part of the song data

Finite fields such as section type, vocal mode, key/scale, and meter use selectors; expressive fields such as genre, mood, production and instrument descriptions remain free-form. Instruments, Lyrics, and Arrangement use multi-line editing where longer text is expected.

Section duration supports direct numeric entry and focused mouse-wheel stepping. Energy keeps a mouse-operated range control.

## Audio Editor interaction model

The waveform/timeline receives most of the available area. The right Inspector width is draggable and persisted as a local UI preference. The Inspector shows one panel at a time:

- Clip
- Envelope
- Master
- Takes

Take lanes are collapsed by default and expand only when requested.

Waveform navigation:

- mouse wheel: cursor-centered zoom
- Shift + mouse wheel: horizontal pan
- Fit button: reset to full waveform
- Ctrl/Cmd + 0: Fit
- zoom and scroll position are persisted in the V2 view state

### Shared time scale

Waveform and Main Comp use the same pixel/time scale. The Main Comp timeline receives the current waveform pixel width and scroll position, so zooming or panning the waveform keeps clips aligned to the same time coordinate. Take lanes use the same scale when expanded.

### Envelope semantics

V2 `gain_envelope` is **clip-local**, not a master/global envelope and not the same thing as a waveform Selection.

- Selection: a timeline region used by Cut/Delete and future region actions
- Clip Gain Envelope: automation stored on the currently selected clip
- Envelope Inspector: edits points relative to the selected clip
- Waveform `Envelope: On/Off`: overlays that same selected-clip curve on the rendered waveform
- the backend remains authoritative and anchors 0 dB at clip start/end around user envelope points

This separation leaves room for later Master/Track automation without overloading the V2 clip envelope format.

## Future extension points

The UI architecture must remain compatible with later additions without rewriting the shell or save lifecycle.

Planned extension points:

- clip / track / master effect racks
- `effects[]` and automation data attached to the V2 edit model in a versioned migration
- pitch, time stretch, EQ, compressor/limiter, delay, reverb and spectrogram in V2.1
- richer take/comping views
- V3 semantic conditioning tracks and automation lanes

Backend rendering remains authoritative. Browser preview is an authoring aid and must never become the saved source of truth.

## UI smoke tests

Playwright smoke coverage is kept separate from runtime dependencies. `package.json` pins `@playwright/test` as a development-only dependency. The smoke fixture covers the shared shell, native window resize, numeric wheel input, and the reusable vertical pane splitter.

```bash
npm install
npx playwright install chromium
npm run test:ui
```

These development dependencies are not required to run the ComfyUI custom node.
