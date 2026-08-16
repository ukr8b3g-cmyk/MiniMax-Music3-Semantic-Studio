# Phase 2 / V2 Audio Editing Specification

Status: **design frozen before implementation** (2026-08-16).

This document defines the implementation boundary for Phase 2. V2 adds non-destructive audio editing after MiniMax Music3 generation. It must not patch ComfyUI core, MiniMax Music3 model code, KSampler, or VAE code, and it must not change the public V1 `MiniMaxMusic3SemanticStudio` outputs.

## 1. Architecture

V2 is a **companion node after audio decode**, not an expansion of the V1 conditioning node.

```text
Load CLIP
   |
   v
Music3 Semantic Studio (V1)
   | CONDITIONING                seconds
   |                               |
   v                               v
KSampler <--------------- Empty MiniMax Music3 Latent Audio
   |
   v
VAE Decode Audio
   |
   v
Music3 Semantic Studio Audio Editor (V2)
   | AUDIO
   v
Preview / Save Audio
```

This keeps the ComfyUI graph acyclic and preserves the V1 contract.

### V2 public node contract

- Node ID: `MiniMaxMusic3SemanticStudioAudioEditor`
- Display name: `Music3 Semantic Studio Audio Editor`
- Category: `audio/minimax music`
- Required input: `audio: AUDIO`
- Optional advanced inputs: `take_2: AUDIO`, `take_3: AUDIO`, `take_4: AUDIO`
- Widget: `edit_json` (advanced, multiline; normally edited only through the Studio UI)
- Widget: `bypass` (default `false`)
- Output: `AUDIO`
- Output-node behavior: yes; the node can be used as the final preview or connected to `Save Audio (Advanced)`.

The optional take inputs are explicit graph inputs. V2 does **not** silently retain previous generations on disk as hidden history. This makes comping reproducible from the workflow.

## 2. Core design rules

1. **Source audio is immutable.** Every render starts from the connected input AUDIO values.
2. **Editing is non-destructive.** The node stores a declarative edit state; it does not overwrite source files or upstream tensors.
3. **Backend render is authoritative.** The browser editor may provide immediate Web Audio preview, but saved output is produced by the Python renderer from `edit_json`.
4. **No V2.0 Python dependency is added.** Core rendering uses PyTorch plus ComfyUI's existing audio/UI helpers.
5. **No runtime CDN dependency.** Frontend libraries are vendored/bundled into the custom node and retain their license notices.
6. **V1 remains valid.** `MiniMaxMusic3SemanticStudio` keeps `(CONDITIONING, seconds)` and continues to ignore V2/V3 reserved data.
7. **Unknown edit fields are preserved.** Later V2.1/V3 fields may round-trip through V2.0 without destructive rewriting.

## 3. Frontend foundation

V2.0 will use **WaveSurfer.js 7.12.11** as the waveform/transport base. It is pinned to the stable 7.x release rather than the 8.0 beta line.

Required WaveSurfer capabilities:

- waveform rendering and transport
- Timeline plugin
- Regions plugin for selections/clip bounds
- Envelope plugin for visual gain/fade editing
- optional Minimap when long audio makes navigation difficult

The project will not embed AudioMass as the V2 runtime. AudioMass remains a useful UX reference, but the V2 renderer needs deterministic graph-native non-destructive state rather than a file-editor round trip.

`waveform-playlist` / `dawcore` is a design reference for clip move/trim/split, transaction-style undo/redo, and future take/multitrack UX. V2.0 does not require React or the experimental Web Components runtime.

## 4. V2 edit document

`edit_json` is independent from the V1 conditioning output contract and is the execution source of truth for V2.

```json
{
  "edit_schema_version": 1,
  "project_id": "",
  "view": {
    "zoom": 1.0,
    "scroll_seconds": 0.0
  },
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

### Time semantics

All persisted times are seconds. At render time they are converted to integer sample indexes with the active input sample rate. This keeps projects readable and portable while making the backend render deterministic.

### Clip semantics

A clip is a non-destructive reference to a time range in one connected take:

- `source_in` / `source_out`: range inside the selected source take
- `timeline_start`: position in the rendered output
- split: replace one clip with two clips that reference adjacent source ranges
- trim: change source bounds and/or timeline position
- delete/cut: remove a clip or clip range
- move: change `timeline_start`
- gaps: render as silence
- overlaps: summed; the UI creates fades when the user chooses Crossfade

The renderer does not mutate the input tensor.

## 5. V2.0 feature freeze — core editor

The first implementation must ship these features together before V2.0 is considered complete:

### Transport / view

- Play / Pause / Stop
- seek and current-time display
- waveform zoom
- timeline ruler
- source vs rendered A/B preview
- semantic section overlay from the nearest upstream V1 Studio node when one can be resolved unambiguously

The semantic overlay is visual guidance only. The audio editor remains functional if no V1 node is found.

### Clip editing

- selection / region
- split at playhead
- trim left/right
- delete/cut region
- move clip on timeline
- silence gaps
- crossfade between adjacent/overlapping clips
- duplicate clip
- reverse clip

### Level / stereo editing

- clip gain in dB
- draggable gain envelope
- fade-in / fade-out
- linear and equal-power fade curves
- clip pan `-1.0 ... +1.0`
- master gain
- channel modes: `preserve`, `mono`, `stereo`, `left_only`, `right_only`, `swap_lr`
- optional peak normalization with configurable target, default `-1.0 dBFS`

### Take / comping support

- primary `audio` plus up to three optional connected takes
- Take 1–4 lanes in the editor when connected
- clip `source_id` can point to any connected take
- comping is produced by choosing the source take per clip/region
- connected takes must have compatible sample rate/batch/channel layout in V2.0; otherwise the node raises a clear validation error

### Editing behavior

- undo / redo in the browser
- one user gesture = one undo transaction
- editor state is saved only by **Save to Node**
- Cancel closes the editor without changing `edit_json`
- Reset clears edits back to one full-length primary-source clip

Undo history itself is not persisted; the saved declarative snapshot is persisted.

## 6. Source and rendered preview contract

The first workflow execution supplies the editor with audio. Before a successful execution, **Open Audio Editor** shows a clear `Run the workflow once to load audio` state.

On execution the V2 backend will:

1. validate connected AUDIO inputs and `edit_json`
2. save temporary FLAC preview references for every connected source take
3. render the edited AUDIO deterministically
4. save a temporary FLAC preview reference for the rendered result
5. return the edited AUDIO as the public node output
6. return standard ComfyUI audio preview data plus namespaced V2 UI metadata for source/take/rendered references

This is necessary so reopening the editor always starts from the immutable source take(s), not from the already-edited output. It prevents double-applying edits.

No permanent take files are created by V2.0.

## 7. Backend render order

For every clip:

1. resolve source take
2. convert seconds to sample indices
3. slice source range
4. reverse if requested
5. apply clip gain
6. apply gain envelope
7. apply fade-in / fade-out
8. apply pan/channel transform that is clip-local where applicable
9. place/add the clip into the output timeline

After all clips:

10. apply master channel mode
11. apply master gain
12. apply optional peak normalization
13. finite-value check and clamp only when required for safe output representation
14. return the original sample rate

Rendering applies the same edit graph independently to every batch item. Interactive browser editing is officially supported for batch size 1 in V2.0; batch rendering remains deterministic for compatible batches.

## 8. V2.1 — same Phase 2, after the core renderer is stable

V2.1 extends the same data model and node ID. It does not change V1.

Planned optional DSP:

- pitch shift, semitone control
- time stretch / playback-rate editing
- high-pass / low-pass / 3-band EQ
- compressor / limiter
- delay
- reverb
- spectrogram view

These are intentionally separated from V2.0 because they need more DSP parity testing between browser preview and backend render. Where torchaudio is used, it must be feature-detected; failure of optional DSP support must not prevent the V2.0 editor from loading.

## 9. Not in V2

The following remain outside Phase 2:

- MiniMax latent/audio inpainting
- model-side region regeneration
- conditioning morphs or time-varying MiniMax conditioning
- automatic stem separation
- microphone recording
- hidden automatic take-history persistence

Stem separation may later be added as an explicit upstream/downstream node integration, not silently embedded in the V2 core renderer.

## 10. Proposed file layout

```text
MiniMax-Music3-Semantic-Studio/
├── nodes.py                         # V1 remains stable
├── semantic_project.py              # V1 compiler remains stable
├── audio_editor_node.py             # V2 Comfy node contract + previews
├── audio_edit_project.py            # edit_json validation/normalization/migrations
├── audio_render.py                  # pure deterministic PyTorch render engine
├── web/
│   ├── semantic_studio.js           # existing V1 UI
│   ├── semantic_studio.css
│   ├── audio_editor.js              # V2 editor/controller
│   ├── audio_editor.css
│   └── vendor/
│       └── wavesurfer/               # pinned built assets + license notice
├── tests/
│   ├── test_semantic_project.py
│   ├── test_audio_edit_project.py
│   └── test_audio_render.py
└── docs/
    ├── ARCHITECTURE.md
    └── V2_SPEC.md
```

## 11. Test / acceptance gate

V2.0 is not complete until all of the following pass:

### Pure backend tests

- identity edit is sample-equivalent to input within float tolerance
- trim and split reconstruct the expected source samples
- gap insertion has exact expected duration
- clip move uses correct sample offsets
- gain dB conversion is correct
- envelope interpolation is deterministic
- fade endpoints and curves are correct
- pan and channel modes are correct
- reverse is exact
- normalization hits the requested peak within tolerance
- two-take comping selects the expected source samples
- invalid edit JSON produces a clear validation error
- unknown fields survive normalization

### Static checks

```bash
python -m pytest
python -m compileall -q .
node --check web/semantic_studio.js
node --check web/audio_editor.js
```

### ComfyUI integration checks

- V1 workflow still generates unchanged without the V2 node
- V2 with no edits produces the same audible source
- Open Audio Editor works after one execution
- Source/Rendered A/B does not double-apply edits
- Save to Node changes the next queued render
- Cancel does not change the node
- V2 output connects directly to Preview Audio and Save Audio (Advanced)
- optional take inputs can be left disconnected
- existing V1 workflow JSON remains loadable

## 12. Implementation order

1. `audio_edit_project.py` schema + migrations + tests
2. `audio_render.py` identity/split/trim/gain/fade/pan/channel/normalize + tests
3. V2 Comfy node with source/rendered temp previews
4. WaveSurfer 7.12.11 bundle and basic transport/waveform
5. clip/region editing + undo/redo
6. envelope/fade/pan/master controls
7. optional take lanes + comping
8. upstream semantic-section overlay
9. integration tests and V2.0 workflow fixture
10. only then start V2.1 DSP

This order keeps the authoritative render engine testable before UI complexity is added.