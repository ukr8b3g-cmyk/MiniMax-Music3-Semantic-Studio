# MiniMax Music3 Semantic Studio

**Music3 Semantic Studio** is an external ComfyUI custom-node package for MiniMax Music 3 generation design and non-destructive post-generation audio editing.

Current status:

- **V1 / Semantic Studio — two-view Timeline / Lyrics UI implemented**
- **V2 / Phase B.2 — unified waveform editor, schema 2 track automation, and browser Draft Preview implemented; ComfyUI integration verification pending**
- **V2.1 — Effects planned; not implemented yet**

Neither V1 nor V2 patches ComfyUI core, MiniMax Music3 model code, KSampler, or VAE code.

## Installation

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ukr8b3g-cmyk/MiniMax-Music3-Semantic-Studio.git
```

Restart ComfyUI after install/update. V1 and the current V2 core add no extra Python runtime dependencies.

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

### Semantic Studio — Timeline / Lyrics

![Phase A Semantic Studio](docs/images/semantic-studio-phase-a.webp)

The normal navigation is reduced to two horizontal tabs:

- **Timeline** — primary song-design workspace
- **Lyrics** — Caption, complete tagged Lyrics, and per-section Lyrics editing

The Timeline header exposes Genre, BPM, Key, Scale / Mode, Meter, and Vocal / Instrumental mode. `Main Vocal` contains the song-wide lead/voice type, timbre, delivery, harmony, and vocal-effects wording. `More Settings` contains title, subgenres/influences, mood/direction, and production profile.

Preset-backed expressive fields remain editable and searchable. Imported/custom wording is never locked to the local preset catalog.

Timeline order:

1. Structure
2. Energy
3. Lyrics summary
4. Vocal Style
5. Instruments

Section duration uses 0.1-second semantic snapping. Section edges can be dragged; Shift+drag shares time with the following section. Energy points are vertically draggable. Instruments are semantic arrangement lanes derived from `section.instruments[]`, not audio stems.

The Lyrics workspace contains:

1. **Caption** — authoritative compiler Caption in read-only mode; `Edit` creates a temporary Draft that must pass Analyze -> Import Preview -> Apply.
2. **Full Lyrics** — editable tagged Lyrics; `Apply to Sections` updates matching section Lyrics while preserving timing, energy, instruments, and vocal style.
3. **Section Lyrics** — compact per-section accordion.

See [`docs/PHASE_A_SEMANTIC_UI.md`](docs/PHASE_A_SEMANTIC_UI.md).

## Prompt Import

External LLM output can be pasted into **Import Prompt** and processed locally:

```text
Import Prompt
   -> Analyze
   -> Import Preview
   -> Replace / Merge
   -> Semantic Studio fields
```

The normal external-import default is **Replace section structure**. **Merge detected fields** remains available for incremental edits. Prompt Import is deterministic and does not require an LLM connection at runtime.

## V2 — unified non-destructive audio editor

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

1. Connect decoded AUDIO to V2.
2. Queue once to create immutable source-take previews and the last queued Rendered A reference.
3. Click **Open Audio Editor**.
4. Edit on **Draft · Current Edits**.
5. Click **Save Edits**.
6. Queue again to produce the authoritative edited AUDIO.

The browser Draft Preview is immediate authoring feedback. The Python/PyTorch renderer remains the final source of truth.

### Unified waveform surface

The separate visible Main Comp lane has been removed from the normal UI. One waveform is the primary editing surface:

- drag to select a range
- click to seek
- Cut / Copy / Paste / Split / Delete / Silence operate on the waveform selection and playhead
- thin clip blocks at the top expose non-destructive clip boundaries and source assignments
- the waveform grows vertically with the editor window instead of staying fixed at 220 px
- Selection Start / End / Length can be edited numerically

Tool modes:

```text
F1  Select
F2  Envelope
```

### Draft Preview

`Draft · Current Edits` renders the current `edit_json` in the browser from decoded Take 1–4 source previews. It reflects current edits without a Queue round trip:

- Cut / Paste / Split and gaps
- clip reverse, gain, pan, mute, fades, and legacy clip envelopes
- Main Track Mute / Solo / Gain / Pan
- Main Track Gain Envelope
- master channel mode, gain, and peak normalization

`Rendered A · Last Queue` remains available for A/B comparison. Draft Preview is encoded for browser playback and is not the authoritative output; **Save Edits -> Queue** runs the Python renderer against the original connected AUDIO tensors.

### Main Track controls and envelope

The left track strip is now track-level rather than selected-clip-level:

- Mute
- Solo
- Track Gain
- Track Pan

The orange Gain Envelope spans the complete track timeline. It is not constrained to one clip.

- choose **Envelope / F2**
- click the waveform to add a point
- drag a point to change time/gain
- right-click or double-click a point to delete it
- hover shows time and dB
- Select / F1 prevents selection and envelope gestures from conflicting

Legacy schema-1 clip envelopes remain render-compatible but new automation is authored at track level.

### Editing commands

- Cut / Copy / Paste at playhead
- Split / Duplicate / Reverse
- Delete / Ripple
- Silence / Leave Gap
- Cut & Leave Gap
- clip Mute and track Mute
- equal-power Crossfade Next helper
- Undo / Redo
- explicit Take 1–4 comping
- stereo L/R split, overlay, and mono-mix display
- Preview Peak meter

Keyboard shortcuts:

```text
F1               Select tool
F2               Envelope tool
Ctrl/Cmd+X       Cut
Ctrl/Cmd+C       Copy
Ctrl/Cmd+V       Paste at playhead
Ctrl/Cmd+I       Split
Ctrl/Cmd+D       Duplicate
Delete/Backspace Delete / Ripple
Ctrl/Cmd+L       Silence / Leave Gap
Ctrl/Cmd+Alt+X   Cut & Leave Gap
M                Mute / Unmute track
Shift+M          Mute / Unmute selected clip
Ctrl/Cmd+Z       Undo
Ctrl/Cmd+Shift+Z Redo
Ctrl/Cmd+Y       Redo
Ctrl/Cmd+S       Save Edits
Ctrl/Cmd+0       Fit
Space            Play / Pause
```

### V2 schema 2

`edit_json.edit_schema_version` is now **2**. Existing schema-1 projects are migrated automatically and retain their clip ranges, gain, pan, mute, reverse, fades, and clip-envelope data.

Schema 2 adds neutral-by-default track state:

```json
{
  "muted": false,
  "solo": false,
  "gain_db": 0.0,
  "pan": 0.0,
  "gain_envelope": [],
  "effects": [],
  "clips": []
}
```

The backend render order is clip processing -> track automation/controls -> track mix -> master processing. Source AUDIO remains immutable.

See [`docs/PHASE_B_AUDIO_EDITOR.md`](docs/PHASE_B_AUDIO_EDITOR.md) and [`docs/V2_SPEC.md`](docs/V2_SPEC.md).

## V2.1 boundary

The schema reserves track/master `effects[]`, but DSP effects are not enabled in this build. An enabled unsupported effect fails explicitly rather than being silently ignored.

Planned V2.1 work:

- pitch shift / time stretch
- EQ / filters
- compressor / limiter
- delay / reverb
- stereo width
- spectrogram / advanced analysis

## V3 direction

V3 remains experimental and may add time-varying semantic conditioning, conditioning morph tracks, and smart region regeneration/comping. Any model-side behavior must remain opt-in and separate from stable V1/V2 contracts.

## Development checks

```bash
python -m pytest
python -m compileall -q .
node --check web/semantic_studio.js
node --check web/semantic_timeline.js
node --check web/semantic_controls.js
node --check web/prompt_import.js
node --check web/audio_editor.js
node --check web/audio_editor_core.js
node --check web/audio_edit_commands.js
node --check web/audio_draft_core.js
node --check web/audio_draft_preview.js
node --check web/audio_waveform.js
node --check web/audio_panels.js
npm run test:semantic
npm run test:audio
```

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).
