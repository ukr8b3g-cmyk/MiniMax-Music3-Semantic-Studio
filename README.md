# MiniMax Music3 Semantic Studio

**Music3 Semantic Studio** is an external ComfyUI custom-node package for MiniMax Music 3 generation design and non-destructive post-generation audio editing.

Current status: **Phase 2 / V2.0 implemented; ComfyUI V2 integration test pending**.

- **V1 — Music3 Semantic Studio:** semantic structure / lyrics / arrangement -> MiniMax Music3 conditioning.
- **V2 — Music3 Semantic Studio Audio Editor:** decoded AUDIO -> non-destructive edited AUDIO.
- **V3 — planned/experimental:** semantic conditioning automation and smart regeneration strategies.

Neither V1 nor V2 patches ComfyUI core, MiniMax Music3 model code, KSampler, or VAE code.

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ukr8b3g-cmyk/MiniMax-Music3-Semantic-Studio.git
```

Restart ComfyUI after install/update. V1 and V2.0 add no extra Python runtime dependencies.

## V1 — semantic generation design

- Node ID: `MiniMaxMusic3SemanticStudio`
- Display name: `Music3 Semantic Studio`
- Category: `model/conditioning/minimax music`
- Outputs: `CONDITIONING`, `seconds`

```text
Load CLIP
   |
   v
Music3 Semantic Studio ---------------------> KSampler positive
   |
   +---- seconds ----> Empty MiniMax Music3 Latent Audio ----> KSampler latent_image

Load Diffusion Model -----------------------------------------> KSampler model
Conditioning Zero Out ----------------------------------------> KSampler negative
```

Click **Open Semantic Studio** to edit Global settings, the section Timeline, and the compiled Caption/Lyrics preview.

V1 is semantic: BPM, key, exact section timing, energy, and instrumentation are generation targets rather than strict symbolic guarantees.

## V2 — non-destructive audio editor

- Node ID: `MiniMaxMusic3SemanticStudioAudioEditor`
- Display name: `Music3 Semantic Studio Audio Editor`
- Category: `audio/minimax music`
- Input: `audio: AUDIO`
- Optional inputs: `take_2`, `take_3`, `take_4`
- Output: `AUDIO`

Place V2 after audio decode:

```text
KSampler
   |
   v
VAE Decode Audio
   |
   v
Music3 Semantic Studio Audio Editor
   |
   v
Preview Audio / Save Audio (Advanced)
```

### First use

1. Connect the decoded AUDIO to V2.
2. Queue the workflow once. This loads immutable source preview metadata.
3. Click **Open Audio Editor**.
4. Edit the clip plan.
5. Click **Save to Node**.
6. Queue again to produce the authoritative edited AUDIO.

The browser editor previews source takes and the **last queued rendered result**. Unsaved edits are intentionally not treated as final audio; the Python renderer computes the output from source AUDIO plus `edit_json`.

### V2.0 editing features

- Play / Pause / Stop, seek, waveform zoom and time ruler
- drag selection
- V1 semantic-section overlay when one upstream V1 node can be identified
- clip split, trim, move, duplicate, reverse
- non-ripple region delete / silence gaps
- overlapping clip mix and equal-power crossfade helper
- clip gain, pan, fade-in/out
- draggable gain envelope
- master gain
- `preserve`, `mono`, `stereo`, `left_only`, `right_only`, `swap_lr` channel modes
- optional peak normalization
- Undo / Redo during the editor session
- explicit Take 1–4 comping from connected AUDIO inputs
- Source / Rendered A/B preview

Connected takes must have compatible sample rate, batch size, and channel layout in V2.0.

### V2 data model

V2 persists a versioned, declarative `edit_json` document containing connected take metadata, tracks/clips, source ranges, timeline positions, gain/fade/envelope/pan state, and master settings. Source tensors are never overwritten.

See [`docs/V2_SPEC.md`](docs/V2_SPEC.md) for the complete V2 contract and render order.

## V2.1 boundary

Planned after V2.0 integration validation:

- pitch shift / time stretch
- EQ / filters
- compressor / limiter
- delay / reverb
- spectrogram

These are intentionally outside the V2.0 core renderer.

## V3 direction

V3 remains experimental and may add time-varying semantic conditioning, conditioning morph tracks, and smart region regeneration/comping. Any model-side behavior must remain opt-in and separate from the stable V1/V2 contracts.

## Development checks

```bash
python -m pytest
python -m compileall -q .
node --check web/semantic_studio.js
node --check web/audio_editor.js
node --check web/audio_editor_core.js
node --check web/audio_waveform.js
node --check web/audio_timeline.js
node --check web/audio_panels.js
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the stable phase boundaries.
