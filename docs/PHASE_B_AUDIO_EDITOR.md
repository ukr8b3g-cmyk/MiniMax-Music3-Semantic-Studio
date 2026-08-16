# Phase B — Audio Editor Basics

Status: implemented in frontend; ComfyUI visual/integration verification pending.

Phase B completes the conventional audio-editing surface of the existing V2.0 non-destructive Audio Editor. It does **not** add V2.1 DSP effects.

## Editing commands

The Audio Editor now exposes the normal selection/clip operations expected from a waveform editor:

- Cut
- Copy
- Paste at playhead
- Split at playhead
- Ripple Delete
- Silence / Leave Gap
- Cut & Leave Gap
- Duplicate
- Reverse
- Mute / Unmute selected clip
- Crossfade Next

Copy/Cut use an internal editor clipboard. Audio PCM is never written to the operating-system clipboard. Clipboard entries retain immutable source references plus the sliced source range, clip gain/pan/mute/reverse state, applicable edge fades, and gain-envelope points remapped to the copied clip-local time.

### Delete semantics

Phase B intentionally separates two common operations:

- **Delete / Ripple** removes the selected timeline range and shifts later material left by the removed duration.
- **Silence / Leave Gap** removes material inside the selected range without shifting later material.

When no time selection exists, Cut/Copy/Delete operate on the selected clip rather than implicitly affecting overlapping clips.

## Keyboard shortcuts

Shortcuts are only captured when the user is not typing in an input/textarea/select control, except `Ctrl/Cmd+S`.

- `Ctrl/Cmd+X` — Cut
- `Ctrl/Cmd+C` — Copy
- `Ctrl/Cmd+V` — Paste at playhead
- `Ctrl/Cmd+I` — Split
- `Ctrl/Cmd+D` — Duplicate
- `Delete` / `Backspace` — Delete / Ripple
- `Ctrl/Cmd+L` — Silence / Leave Gap
- `Ctrl/Cmd+Alt+X` — Cut & Leave Gap
- `M` — Mute / Unmute selected clip
- `Ctrl/Cmd+Z` — Undo
- `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` — Redo
- `Ctrl/Cmd+S` — Save Edits
- `Ctrl/Cmd+0` — Fit waveform
- `Space` — Play / Pause

## Context menu

Right-clicking the Audio Editor main area opens a local context menu containing the same edit commands and shortcut hints. `Pitch & Speed…` is shown disabled as a V2.1 boundary marker; no pitch/time DSP is executed in Phase B.

## Track strip

A compact track strip is displayed to the left of the waveform. It operates on the currently selected clip using fields already supported by V2.0:

- Mute
- Gain
- Pan
- source layout badge (Stereo / Mono)

No fake track-level solo state is introduced because the current authoritative edit model has one Main Comp track and explicit source takes rather than a full mixer track graph.

## Preview peak meter

A lightweight L/R (or mono) **Preview Peak** meter is shown next to the waveform. It samples the decoded browser preview around the current playhead position and reports approximate dBFS peaks.

Important: this meter describes the currently playing Source/Rendered preview. Unsaved browser edits are not authoritative audio; queued backend rendering remains the source of truth.

## Envelope / fades

- Gain Envelope remains optional and defaults Off for new local UI state.
- Envelope line and control points use amber/orange styling to remain visually distinct from the waveform.
- Existing direct envelope-point editing and fade handles remain synchronized with `edit_json`.

## Data / compatibility

- public V2 node ID and `AUDIO -> AUDIO` contract are unchanged
- `edit_schema_version` remains 1
- source AUDIO remains immutable
- no Python runtime dependency is added
- no V2.1 effects fields are added
- browser clipboard and peak-meter state are session/UI state only and are not serialized
- all authoritative edits remain declarative clips inside `edit_json`

## V2.1 boundary

The following are intentionally not implemented in Phase B:

- Pitch shift / time stretch
- EQ / high-pass / low-pass
- Compressor / limiter
- Delay / reverb
- Stereo Width DSP
- Spectrogram / LUFS analysis

Those require the V2.1 effects/DSP phase and a separate schema/render-order review.
