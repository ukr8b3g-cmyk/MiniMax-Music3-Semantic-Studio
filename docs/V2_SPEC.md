# Phase 2 / V2 Audio Editing Specification

Status: **schema 2 unified waveform editor, V2.1-B basic DSP, Effects Rack, and selection-loop audition implemented; ComfyUI integration verification pending**.

V2 is a deterministic non-destructive AUDIO companion node after MiniMax Music3 decode. It remains external to ComfyUI core and does not modify MiniMax Music3, KSampler, latent, or VAE code.

## 1. Public node contract

- Node ID: `MiniMaxMusic3SemanticStudioAudioEditor`
- Display name: `Music3 Semantic Studio Audio Editor`
- Category: `audio/minimax music`
- Required input: `audio: AUDIO`
- Optional advanced inputs: `take_2`, `take_3`, `take_4`
- Widgets: `edit_json`, `bypass`
- Output: `AUDIO`
- Output node: yes

V1 remains a separate conditioning node with `(CONDITIONING, seconds)` outputs.

## 2. Core rules

1. Connected source AUDIO tensors are immutable.
2. Editing is declarative and persisted in versioned `edit_json`.
3. Python/PyTorch rendering is authoritative.
4. Browser Draft Preview is immediate authoring feedback, not the final render.
5. Take history is explicit through graph inputs; no hidden permanent take files.
6. No runtime CDN or extra custom-node Python dependency is required by the current core.
7. Unknown fields are preserved where possible.
8. Supported effects must keep Browser Draft and Python render order/behavior aligned closely enough for reliable authoring preview.
9. Enabled unsupported effects fail explicitly rather than being silently ignored.

## 3. Architecture

```text
Take 1–4 AUDIO tensors
        |
        +--------------------------+
        |                          |
        v                          v
Temporary source previews      Python renderer
        |                          |
        v                          v
Browser Draft renderer        Authoritative AUDIO
        |                          |
        v                          v
Unified waveform             Preview / Save Audio
```

Frontend modules:

```text
web/audio_editor.js          controller / ComfyUI integration
web/audio_editor_core.js     schema migration and project helpers
web/audio_edit_commands.js   Cut/Copy/Paste/ripple + automation transforms
web/audio_draft_core.js      deterministic Float32 Draft renderer
web/audio_draft_preview.js   source decode, AudioBuffer and WAV adapter
web/audio_waveform.js        waveform, tools, selection, clips, track envelope
web/audio_panels.js          legacy panel renderers used by simplified inspector
web/audio_effects_core.js    effect catalog, defaults and rack mutations
web/audio_effects_dsp.js     Browser Draft basic DSP implementation
web/audio_effects.js         compact Track/Master Effects Rack UI
web/audio_playback_loop.js   session-only selection-loop helpers
web/audio_unified.css        unified waveform presentation
```

Authoritative DSP lives in `audio_effects_dsp.py` and is called by `audio_render.py`.

## 4. Edit schema 2

```json
{
  "edit_schema_version": 2,
  "project_id": "",
  "view": {
    "zoom": 1.0,
    "scroll_seconds": 0.0,
    "waveform_height": 360.0
  },
  "takes": [
    {"id": "take-1", "input": "audio", "name": "Take 1", "enabled": true}
  ],
  "tracks": [
    {
      "id": "main",
      "name": "Main Track",
      "muted": false,
      "solo": false,
      "gain_db": 0.0,
      "pan": 0.0,
      "gain_envelope": [],
      "effects": [],
      "clips": [
        {
          "id": "clip-1",
          "source_id": "take-1",
          "source_in": 0.0,
          "source_out": 60.0,
          "timeline_start": 0.0,
          "gain_db": 0.0,
          "pan": 0.0,
          "muted": false,
          "reverse": false,
          "fade_in": {"duration": 0.0, "curve": "linear"},
          "fade_out": {"duration": 0.0, "curve": "linear"},
          "gain_envelope": []
        }
      ]
    }
  ],
  "master": {
    "gain_db": 0.0,
    "channel_mode": "preserve",
    "normalize": {"enabled": false, "target_peak_dbfs": -1.0},
    "effects": []
  },
  "reserved": {}
}
```

All persisted time values use seconds. Backend and Draft renderers convert to integer sample offsets using the active sample rate.

Selection-loop audition is session UI state and is intentionally **not** persisted in `edit_json`.

### Schema 1 migration

Schema 1 is accepted. Migration:

- retains all clips and clip properties
- retains legacy clip gain envelopes
- adds neutral track Mute/Solo/Gain/Pan/Envelope/Effects
- adds neutral master Effects
- adds default waveform height
- sets `edit_schema_version=2`
- preserves unknown fields

## 5. Unified waveform UI

The waveform is the primary editing surface. The old visible Main Comp lane is not rendered.

- semantic sections appear as a header overlay when one upstream V1 node is resolvable
- thin clip boundaries expose non-destructive clip/source assignment
- Select tool owns selection/seek
- Envelope tool owns full-track automation
- waveform track height can be resized vertically and reset
- Start/End/Length support numeric editing
- the simplified inspector exposes `Effects / Edit / Mixer`, plus `Sources` only when multiple Takes are connected
- Audio Editor can open as an Audacity-style empty workspace before source AUDIO has been queued
- long semantic Key text is compacted in the reference strip while the full value remains available as a tooltip

### Selection loop

A valid waveform selection enables **Loop / リピート**.

- enabling Loop starts audition from the selection start
- playback jumps back at the selection end
- changing the selection updates the active loop range
- clearing the selection disables Loop
- `Shift+Space` toggles selection Loop
- Loop changes playback only; it does not modify audio or `edit_json`

## 6. Browser Draft Preview contract

Draft Preview decodes source Take previews and renders current project state locally. It supports batch item 1 for interactive browser use.

Draft Preview is regenerated after edit commits and after envelope gestures commit. Source/Rendered A/B audition remains available.

Draft Preview must never overwrite source AUDIO or be serialized as authoritative audio. Object URLs and decoded buffers are session state only.

## 7. Render order

Per clip:

1. resolve source take
2. source slice
3. reverse
4. clip gain
5. legacy clip gain envelope
6. fade-in / fade-out
7. clip pan
8. timeline placement / overlap sum into track

Per track:

9. track gain envelope
10. track gain
11. track pan
12. track mute / solo routing
13. track effects in rack order

After tracks:

14. mix tracks
15. master effects in rack order
16. master channel mode
17. master gain
18. optional peak normalization
19. finite-value sanitation

Current Python and Draft implementations match this order for implemented features.

## 8. V2.1 Effects

Schema 2 stores track/master effects as:

```json
{"id": "fx-1", "type": "compressor", "enabled": true, "params": {}}
```

The Effects Rack provides:

- separate Main Track and Master racks
- `+ Add Effect` grouped by category
- effect ON/OFF state
- compact collapsed cards with one expanded editor at a time
- numeric input plus slider for continuous parameters
- reset, delete, move up/down and drag reorder
- unknown effect objects remain round-trippable

### V2.1-B supported DSP

The following enabled effects execute in both Browser Draft and authoritative Python/PyTorch rendering:

- **Gain / Amplify** — linear dB gain
- **High-Pass Filter** — cascaded biquad stages according to slope
- **Low-Pass Filter** — cascaded biquad stages according to slope
- **EQ (3-Band)** — low shelf, mid peaking band, high shelf
- **Compressor** — channel-linked peak detection with attack/release and makeup gain
- **Limiter** — input gain, ceiling, release, short lookahead peak anticipation
- **Stereo Width** — mid/side width control for stereo material

Python filtering uses `torchaudio.functional.lfilter` when available and retains a PyTorch fallback so importing the custom node does not depend on an optional DSP package import succeeding.

### Limiter Auto Level

The expanded Limiter card provides **Auto Level / オートレベル**.

- Limiter must be OFF while measuring to avoid measuring its own processed output
- Auto Level measures the current Draft/preview peak
- it sets `input_gain_db` so the measured peak approaches the current Limiter ceiling
- the value is only a starting point; users may edit Input Gain/Ceiling manually afterward
- it does not change source AUDIO

### Future effects

Reverb remains present in the authoring catalog for the next phase but is not executed by V2.1-B. An enabled Reverb or any unknown future effect raises a clear unsupported-effect error in both Draft and authoritative rendering.

## 9. Verification

Pure-module validation covers:

- schema-1 migration and unknown-field preservation
- clip normalization
- track controls and envelope normalization
- identity, gaps, reverse, gain, fades, clip envelope
- track envelope, gain, pan, mute, solo
- explicit Take comping and layout validation
- overlap summing, channel modes, normalization
- internal clipboard and ripple automation transforms
- V2.1 effect defaults, parameter clamping, reset, owner separation and rack ordering
- supported basic DSP behavior for Gain, Filters, EQ, Compressor, Limiter and Stereo Width
- disabled-effect neutrality and explicit unsupported-effect failure
- Browser Draft support for enabled V2.1-B effects
- selection-loop range clamping and end-of-range jump behavior

Still required in ComfyUI:

- source decode -> editor open / empty editor -> queued source transition
- Draft playback after Mute/Envelope/Cut and supported effects
- Save Edits -> Queue -> Rendered A comparison for each V2.1-B effect
- rack-order comparison with multiple effects
- Limiter Auto Level on representative generated songs
- Selection Loop start/end behavior during long playback
- Take 2 comping
- long-duration performance and memory observation
