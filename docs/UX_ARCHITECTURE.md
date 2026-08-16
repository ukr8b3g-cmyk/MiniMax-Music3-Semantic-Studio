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
  └─ shared window lifecycle, native resize, maximize/restore, remembered size

node_compact.js
  └─ hide internal JSON widgets and expose read-only node summaries

Semantic Studio
  ├─ semantic_studio_core.js  state normalization, compiler preview helpers, controls
  └─ semantic_studio.js       navigation, workspace, section inspector, save lifecycle

Audio Editor
  ├─ audio_editor_core.js      edit model and commands
  ├─ audio_waveform.js         waveform, transport, wheel zoom, fit/reset
  ├─ audio_timeline.js         clip plan and optional take lanes
  ├─ audio_panels.js           Clip / Envelope / Master / Takes inspectors
  └─ audio_editor.js           workspace controller, undo/redo, save lifecycle
```

## Window behavior

Both editors use the shared shell. Desktop behavior:

- native corner/edge resize
- Maximize / Restore
- remembered non-maximized dimensions in browser local storage
- responsive internal layout as the window narrows
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

The center area contains the selected workspace. The right Section Inspector stays contextual to the selected song section. Finite fields such as section type, vocal mode, key/scale, and meter use selectors; expressive fields such as genre, mood, production and instrument descriptions remain free-form.

Section duration supports direct numeric entry and focused mouse-wheel stepping. Energy keeps a mouse-operated range control.

## Audio Editor interaction model

The waveform/timeline receives most of the available area. The right inspector shows one panel at a time:

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

Playwright smoke coverage is kept separate from runtime dependencies. `package.json` pins `@playwright/test` to the currently adopted development version and tests the shared shell behavior plus numeric wheel interaction.

```bash
npm install
npx playwright install chromium
npm run test:ui
```

These development dependencies are not required to run the ComfyUI custom node.
