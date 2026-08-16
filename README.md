# MiniMax Music3 Semantic Studio

**Music3 Semantic Studio** is an external ComfyUI custom-node package for MiniMax Music 3 generation design and non-destructive post-generation audio editing.

Current status:

- **V1 / Phase A — Semantic Studio Timeline UI implemented**
- **V2.0 / Phase B — Audio Editor Basics implemented; ComfyUI interaction verification pending**
- **V2.1 — Effects planned; not implemented yet**

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

Click **Open Semantic Studio** to open the Timeline-first authoring UI.

V1 is semantic: BPM, key, exact section timing, energy, vocal treatment, and instrumentation are generation targets rather than strict symbolic guarantees.

### Phase A — Timeline-first Semantic Studio

![Phase A Semantic Studio](docs/images/semantic-studio-phase-a.webp)

The normal navigation is intentionally reduced to:

- **Timeline** — primary workspace
- **Lyrics** — section-by-section lyric editing
- **Vocal** — Main Vocal and per-section vocal style
- **Prompt** — authoritative Caption/Lyrics preview and Prompt Import entry point

The Timeline header exposes the high-frequency song settings directly:

- Genre
- BPM
- Key
- Scale / Mode
- Meter
- Vocal / Instrumental mode

`More Settings` expands title, subgenres/influences, mood/direction, and production profile.

#### Editable preset controls

Genre, Key, Scale / Mode, Main Vocal, timbre, delivery, and other expressive preset-backed controls remain free-form.

- Click the **▼** button to show the full preset list.
- Type in the text field to filter presets.
- Imported/custom values are never locked by the preset catalog.
- Prompt Import provides initial project values; later manual edits override them normally.

#### Timeline rows

The Timeline is organized as:

1. Structure
2. Energy
3. Lyrics summary
4. Instruments
5. Vocal Style

Section type determines UI color only; color is not stored in `project_json`.

Section duration uses 0.1-second semantic snapping. Section edges can be dragged to change duration; Shift+drag shares time with the following section. Energy points are vertically draggable.

#### Instrument lanes

Instrument lanes are derived from existing `section.instruments[]` values. They are **semantic arrangement lanes, not audio stems**.

- Expand **Instruments** to show lanes such as Piano, Rhodes piano, Bass, Drums, Guitar, Strings, etc., depending on the project.
- Click a section/instrument cell to toggle that instrument for the section.
- Collapse the group to show compact per-section instrument counts.
- Custom instruments added in the Section Inspector automatically appear as lanes.

#### Lyrics accordion

Lyrics uses a compact accordion. Empty or instrumental sections stay short and show `No lyrics`; textareas start small and grow with content up to a bounded internal scroll height.

#### Main Vocal vs Section Vocal Style

Main Vocal is song-wide voice character: voice type, timbre, delivery, harmony, and effects description.

Section Vocal Style is the per-section performance direction, for example `Soft`, `Breathy`, `Whispered`, `Powerful`, `Belting`, `Soulful`, `Husky / Rough`, `Ethereal`, or custom text. These are authoring suggestions, not model-side enums.

See [`docs/PHASE_A_SEMANTIC_UI.md`](docs/PHASE_A_SEMANTIC_UI.md) for the Phase A UI contract.

## Prompt Import

External LLM output can be pasted into **Import Prompt** and processed locally:

```text
Import Prompt
   -> Analyze
   -> Import Preview
   -> Merge / Replace
   -> Semantic Studio fields
```

Prompt Import is deterministic and does not require an LLM connection at runtime. **Prompt Preview** remains the authoritative read-only view of the Caption/Lyrics sent to MiniMax Music3.

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
5. Click **Save Edits**.
6. Queue again to produce the authoritative edited AUDIO.

The browser editor previews source takes and the **last queued rendered result**. Unsaved edits are intentionally not treated as final audio; the Python renderer computes the output from source AUDIO plus `edit_json`.

### V2.0 editing features

- Play / Pause / Stop, seek, waveform zoom and time ruler
- stereo L/R split display, overlay preview, and mono-mix preview
- drag selection
- V1 semantic-section overlay when one upstream V1 node can be identified
- clip split, trim, move, duplicate, reverse
- overlapping clip mix and equal-power crossfade helper
- clip gain, pan, fade-in/out
- draggable gain envelope with amber/orange UI; overlay defaults Off
- master gain
- `preserve`, `mono`, `stereo`, `left_only`, `right_only`, `swap_lr` channel modes
- optional peak normalization
- Undo / Redo during the editor session
- explicit Take 1–4 comping from connected AUDIO inputs
- Source / Rendered A/B preview

Connected takes must have compatible sample rate, batch size, and channel layout in V2.0.

### Phase B — Audio Editor Basics

Phase B adds conventional waveform-editor operations without changing the immutable-source architecture:

- **Cut / Copy / Paste at playhead** using an internal editor clipboard
- **Split / Duplicate / Reverse / Mute**
- **Delete / Ripple** — removes the range and closes the gap
- **Silence / Leave Gap** — removes the range without shifting later material
- **Cut & Leave Gap**
- right-click context menu with shortcut hints
- compact selected-clip track strip for Mute / Gain / Pan
- L/R or mono **Preview Peak** meter
- existing Fade and Gain Envelope editing retained

The internal clipboard stores declarative clip slices and immutable source references; it does not put PCM audio on the OS clipboard.

Keyboard shortcuts:

```text
Ctrl/Cmd+X       Cut
Ctrl/Cmd+C       Copy
Ctrl/Cmd+V       Paste at playhead
Ctrl/Cmd+I       Split
Ctrl/Cmd+D       Duplicate
Delete/Backspace Delete / Ripple
Ctrl/Cmd+L       Silence / Leave Gap
Ctrl/Cmd+Alt+X   Cut & Leave Gap
M                Mute / Unmute clip
Ctrl/Cmd+Z       Undo
Ctrl/Cmd+Shift+Z Redo
Ctrl/Cmd+Y       Redo
Ctrl/Cmd+S       Save Edits
Ctrl/Cmd+0       Fit
Space            Play / Pause
```

The Preview Peak meter describes the currently playing Source/Rendered browser preview. Unsaved edits are not authoritative audio until **Save Edits -> Queue**.

See [`docs/PHASE_B_AUDIO_EDITOR.md`](docs/PHASE_B_AUDIO_EDITOR.md) for the Phase B interaction and compatibility contract.

### V2 data model

V2 persists a versioned, declarative `edit_json` document containing connected take metadata, tracks/clips, source ranges, timeline positions, gain/fade/envelope/pan state, and master settings. Source tensors are never overwritten.

See [`docs/V2_SPEC.md`](docs/V2_SPEC.md) for the complete V2 contract and render order.

## V2.1 boundary

Planned after Phase B editor validation:

- pitch shift / time stretch
- EQ / filters
- compressor / limiter
- delay / reverb
- stereo width
- spectrogram / advanced analysis

These are intentionally outside the V2.0 core renderer.

## V3 direction

V3 remains experimental and may add time-varying semantic conditioning, conditioning morph tracks, and smart region regeneration/comping. Any model-side behavior must remain opt-in and separate from the stable V1/V2 contracts.

## Development checks

```bash
python -m pytest
python -m compileall -q .
node --check web/semantic_studio.js
node --check web/semantic_timeline.js
node --check web/semantic_controls.js
node --check web/audio_editor.js
node --check web/audio_editor_core.js
node --check web/audio_edit_commands.js
node --check web/audio_waveform.js
node --check web/audio_timeline.js
node --check web/audio_panels.js
npm run test:semantic
npm run test:audio
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the stable phase boundaries.
