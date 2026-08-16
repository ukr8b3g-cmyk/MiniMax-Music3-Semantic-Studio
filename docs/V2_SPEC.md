# Phase 2 / V2 Audio Editing Specification

Status: **schema 2 unified waveform editor implemented; ComfyUI integration verification pending**.

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
6. No runtime CDN or extra Python dependency is required by the current core.
7. Unknown fields are preserved where possible.

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
web/audio_panels.js          Track / Clip / Envelope / Master / Takes panels
web/audio_unified.css        unified waveform presentation
```

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
- thin clip blocks expose boundaries and source assignment
- Select tool owns selection/seek
- Envelope tool owns full-track automation
- waveform height follows available window space
- Start/End/Length support numeric editing

Advanced clip fields remain in the Clip inspector.

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
13. track effects

After tracks:

14. mix tracks
15. master effects
16. master channel mode
17. master gain
18. optional peak normalization
19. finite-value sanitation

Current Python and Draft implementations match this order for implemented features.

## 8. Effects boundary

Schema 2 reserves `tracks[].effects[]` and `master.effects[]`:

```json
{"id": "fx-1", "type": "compressor", "enabled": true, "params": {}}
```

The current build does not execute V2.1 effects. Enabled effects raise a clear error rather than being silently ignored. Disabled/empty effects remain round-trippable.

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
- browser Draft renderer parity for track controls, clips, fades, and envelope

Still required in ComfyUI:

- node registration and schema-1 workflow migration
- source decode -> editor open
- Draft playback after Mute/Envelope/Cut
- Save Edits -> Queue -> Rendered A comparison
- Take 2 comping
- long-duration performance and memory observation
