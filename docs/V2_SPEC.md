# Phase 2 / V2 Audio Editing Specification

Status: **V2.0 implemented; ComfyUI integration test pending** (2026-08-16).

V2 adds deterministic non-destructive audio editing after MiniMax Music3 generation. It remains external to ComfyUI core and does not modify MiniMax Music3, KSampler, latent, or VAE code. The public V1 `MiniMaxMusic3SemanticStudio` contract remains unchanged.

## 1. Architecture

V2 is a companion node after audio decode:

```text
Music3 Semantic Studio (V1)
   |
   v
KSampler -> VAE Decode Audio
                 |
                 v
Music3 Semantic Studio Audio Editor (V2)
                 | AUDIO
                 v
          Preview / Save Audio
```

### Public node contract

- Node ID: `MiniMaxMusic3SemanticStudioAudioEditor`
- Display name: `Music3 Semantic Studio Audio Editor`
- Category: `audio/minimax music`
- Required input: `audio: AUDIO`
- Optional advanced inputs: `take_2`, `take_3`, `take_4` (`AUDIO`)
- Widget: `edit_json`
- Widget: `bypass`
- Output: `AUDIO`
- Output node: yes

Take history is explicit in the graph. V2 does not silently retain earlier generations as hidden permanent files.

## 2. Core rules

1. Source AUDIO is immutable; every render starts from connected input tensors.
2. Editing is non-destructive and stored as versioned `edit_json`.
3. The Python backend renderer is authoritative. Browser playback is preview only.
4. V2.0 adds no Python dependency beyond PyTorch/ComfyUI facilities already present in ComfyUI.
5. V2.0 adds no runtime CDN or frontend package dependency.
6. V1 retains `(CONDITIONING, seconds)` and does not execute V2 state.
7. Unknown edit fields are preserved where possible for future V2.1/V3 evolution.

## 3. Frontend implementation

The implemented V2.0 frontend uses native browser primitives instead of bundling WaveSurfer:

- Canvas waveform renderer
- `HTMLAudioElement` transport
- Web Audio API decoding for waveform display
- pointer-based selection, clip move/trim, and gain-envelope editing
- native DOM controls for clip/master/take editing

This keeps installation dependency-free and avoids a frontend build/runtime dependency. WaveSurfer.js, AudioMass, and waveform-playlist/dawcore remain design references only.

Frontend modules:

```text
web/audio_editor.js          controller / ComfyUI integration
web/audio_editor_core.js     project helpers / operations / semantic overlay
web/audio_waveform.js        waveform, transport, selection, zoom
web/audio_timeline.js        clip timeline and Take lanes
web/audio_panels.js          clip, envelope, master controls
web/audio_editor.css         V2 UI styling
```

## 4. Edit document

`edit_json` is the V2 execution source of truth.

```json
{
  "edit_schema_version": 1,
  "project_id": "",
  "view": {"zoom": 1.0, "scroll_seconds": 0.0},
  "takes": [
    {"id": "take-1", "input": "audio", "name": "Take 1", "enabled": true}
  ],
  "tracks": [
    {
      "id": "main",
      "name": "Main Comp",
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
    "normalize": {"enabled": false, "target_peak_dbfs": -1.0}
  },
  "reserved": {}
}
```

Persisted time values use seconds. The backend converts them to integer sample offsets using the active sample rate.

## 5. Implemented V2.0 features

### Transport / view

- Play / Pause / Stop
- seek via waveform click
- current-time display
- waveform zoom
- time ruler
- drag selection
- Source Take 1–4 / last Rendered A/B preview
- semantic section overlay when exactly one upstream V1 Studio node is resolvable

The rendered preview is the **last queued backend render**. Unsaved edits are marked as not rendered; `Save to Node` followed by Queue produces the authoritative new render.

### Clip editing

- split at playhead
- trim left/right
- delete selected rendered region as a non-ripple edit (silence gap)
- drag clip on timeline
- overlaps sum in backend
- duplicate clip
- reverse clip
- equal-power crossfade helper for adjacent clips

### Level / stereo

- clip gain in dB
- draggable gain envelope
- fade-in / fade-out
- linear / equal-power fade curves
- clip pan `-1..+1`
- master gain
- channel modes: `preserve`, `mono`, `stereo`, `left_only`, `right_only`, `swap_lr`
- optional peak normalization with configurable target (`-1 dBFS` default)

### Takes / comping

- primary Take 1 plus optional Take 2–4 graph inputs
- connected Take lanes displayed in editor
- each clip can select a connected `source_id`
- `Use Preview Take` switches the selected clip to the currently previewed take
- backend rejects incompatible sample rate, batch size, or channel layout with a clear error

### Editing behavior

- Undo / Redo (browser session)
- drag/trim/envelope gesture grouping
- `Save to Node` writes `edit_json`
- Cancel does not write node state
- Reset creates one full-length Take 1 clip
- source tensors are never overwritten

## 6. Source / rendered preview contract

Before a successful V2 execution, the editor shows `Run the workflow once to load source audio`.

On execution the backend:

1. validates source AUDIO objects and edit state
2. writes temporary FLAC previews for each connected source take
3. renders edited AUDIO from the immutable source(s) and `edit_json`
4. writes a temporary rendered FLAC preview
5. returns the rendered AUDIO
6. returns normal ComfyUI audio UI data plus namespaced `m3ss_v2` metadata

Temporary previews are for UI inspection only and are not permanent hidden take history.

## 7. Backend render order

Per clip:

1. resolve source take
2. seconds -> sample indexes
3. source slice
4. reverse
5. clip gain
6. gain envelope
7. fade-in / fade-out
8. clip pan
9. place/add on output timeline

After clips:

10. master channel mode
11. master gain
12. optional peak normalization
13. finite-value sanitation
14. return original sample rate

Overlapping clips are summed. Gaps are silence. The same edit graph is applied to every compatible batch item; interactive browser preview is intended primarily for batch size 1.

## 8. V2.1 boundary

Not implemented in V2.0; planned after integration/renderer stability:

- pitch shift
- time stretch / playback rate
- HP/LP/3-band EQ
- compressor / limiter
- delay / reverb
- spectrogram

Optional DSP dependencies must be feature-detected and must not prevent V2.0 from loading.

## 9. Outside V2

- MiniMax latent/audio inpainting
- model-side region regeneration
- conditioning morphs / time-varying MiniMax conditioning
- automatic stem separation
- microphone recording
- hidden automatic take-history persistence

## 10. Files

```text
MiniMax-Music3-Semantic-Studio/
├── nodes.py
├── semantic_project.py
├── audio_editor_node.py
├── audio_edit_project.py
├── audio_render.py
├── web/
│   ├── semantic_studio.js
│   ├── semantic_studio.css
│   ├── audio_editor.js
│   ├── audio_editor_core.js
│   ├── audio_waveform.js
│   ├── audio_timeline.js
│   ├── audio_panels.js
│   └── audio_editor.css
└── tests/
    ├── test_semantic_project.py
    ├── test_audio_edit_project.py
    └── test_audio_render.py
```

## 11. Verification state

Implemented V2 pure-backend tests cover:

- identity render
- gaps / clip placement
- gain and reverse
- linear/equal-power fade endpoints
- gain-envelope interpolation
- explicit two-take comping
- incompatible-take validation
- pan/channel modes
- peak normalization
- overlap summing
- muted timeline behavior
- edit JSON validation/normalization
- unknown-field preservation

Local implementation check at implementation time: **18 V2 backend tests passed**, Python compile checks passed, and all V2 frontend JS modules passed `node --check`.

Still required before declaring V2.0 fully validated:

- actual ComfyUI node registration
- one-source identity render in ComfyUI
- Open Audio Editor after queue
- Save/Queue/reopen round trip
- A/B source/render preview
- optional Take 2 comping
- direct connection to Preview Audio / Save Audio (Advanced)
- confirmation that the existing V1 workflow still behaves unchanged
