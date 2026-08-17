# MiniMax Music3 Semantic Studio

**Music3 Semantic Studio** is an external ComfyUI custom-node package for MiniMax Music 3 generation design and non-destructive post-generation audio editing.

Current status:

- **V1 / Semantic Studio — Timeline / Lyrics / Generation UI implemented**
- **English / Japanese UI — ComfyUI locale-aware labels implemented; other locales fall back to English**
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

Click **Open Semantic Studio** to open the Timeline-first authoring UI. Semantic Studio and the Audio Editor open maximized by default and can be restored to the remembered normal size.

V1 is semantic: BPM, key, exact section timing, energy, vocal treatment, and instrumentation are generation targets rather than strict symbolic guarantees.

### Semantic Studio — Timeline / Lyrics / Generation

The main views are explicit horizontal tabs:

- **Timeline** — song design, structure, energy, vocal style and instrument guidance
- **Lyrics** — Caption, complete tagged Lyrics, and per-section Lyrics editing
- **Generation** — the existing MiniMax Music3 autoregressive generation controls

The Timeline header exposes Genre, BPM, Key, Scale / Mode, **Effective Key** (for example `D minor`), Meter, and Vocal / Instrumental mode. Key and Scale remain stored separately; Effective Key is display-only.

`Main Vocal` contains the song-wide lead/voice type, timbre, delivery, harmony, and vocal-effects wording. `More Settings` contains title, subgenres/influences, mood/direction, and production profile. Preset-backed expressive fields remain editable and searchable; imported/custom wording is not locked to the local catalog.

The complete Song Timeline is an accordion that defaults open. Timeline order remains:

1. Structure
2. Energy
3. Lyrics summary
4. Vocal Style
5. Instruments

Structure sections can be added after the current selection, resized, and reordered by drag/drop or Inspector arrows. Instrument lanes are semantic `section.instruments[]` guidance rather than stems; active lanes use a thicker rounded colored indicator for visibility.

Undo / Redo is available for structured project editing:

```text
Ctrl/Cmd+Z             Undo
Ctrl/Cmd+Shift+Z       Redo
Ctrl/Cmd+Y             Redo
```

The Lyrics workspace contains:

1. **Caption** — authoritative compiler Caption; `Edit` creates a temporary Draft that must pass Analyze -> Import Preview -> Apply.
2. **Full Lyrics** — editable tagged Lyrics; `Apply to Sections` updates matching section Lyrics while preserving semantic fields.
3. **Section Lyrics** — compact per-section accordion.

### Generation tab

Generation edits the **same existing ComfyUI node widgets**; it does not duplicate these values into `project_json`:

- `seed` -> **Music Seed (AR)**
- `max_duration` -> **Duration Limit**
- `cfg_scale` -> **Music CFG (AR)**
- `top_k` -> **Music Top-K**

These are MiniMax Music3 autoregressive-stage controls and are separate from KSampler controls later in the graph:

```text
Music Seed (AR)  -> autoregressive music/token randomness
KSampler Seed    -> diffusion latent noise

Music CFG (AR)   -> autoregressive token guidance
KSampler CFG     -> diffusion guidance
```

Neither pair overrides the other; the stages are separate and both are used.

Generation shows **Timeline Total** beside **Duration Limit**. `Auto Sync with Timeline` defaults on and keeps the AR duration ceiling synchronized with the semantic section total. It can be disabled for an independent manual ceiling. MiniMax Music3 may end the song earlier than the ceiling.

The routine AR widgets are hidden on the compact graph node while remaining the actual serialized ComfyUI widgets used by execution.

See [`docs/PHASE_A_SEMANTIC_UI.md`](docs/PHASE_A_SEMANTIC_UI.md).

## English / Japanese UI

The extension follows ComfyUI's locale setting for its user-interface chrome:

- Japanese (`ja...`) -> Japanese node/Studio/Audio Editor labels
- English and all other locales -> English fallback

Node-definition translation files are under `locales/en` and `locales/ja`. Custom Studio/Audio Editor windows read the current ComfyUI locale as well.

**Prompt values, preset values, `project_json`, and text sent to MiniMax are not translated.** Localization changes UI presentation only.

## Prompt Import

External LLM output can be pasted into **Import Prompt** inside Semantic Studio and processed locally:

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

One waveform is the primary editing surface:

- drag to select a range
- click to seek
- Cut / Copy / Paste / Split / Delete / Silence operate on the waveform selection/playhead
- thin clip blocks expose non-destructive clip boundaries/source assignments
- waveform height follows the editor window
- Position and Selection time readouts support precise editing
- semantic Tempo / Meter / Key reference and optional Snap are available when one upstream Semantic Studio is resolvable

Tool modes:

```text
F1  Select
F2  Envelope
```

The final visual separation uses different roles/colors: thin cyan playhead, violet selected clip, blue/cyan selection, and orange/amber gain envelope.

### Draft Preview

`Draft · Current Edits` renders current `edit_json` locally from decoded Take previews and reflects edits without a Queue round trip, including clip edits, Track Mute/Solo/Gain/Pan, Track Gain Envelope, and supported Master processing.

`Rendered A · Last Queue` remains available for A/B comparison. Draft Preview is not authoritative; **Save Edits -> Queue** runs the Python renderer against the original connected AUDIO tensors.

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
Home             Go to start
End              Go to end
```

### V2 schema 2

`edit_json.edit_schema_version` is **2**. Existing schema-1 projects migrate automatically and retain clip ranges, gain, pan, mute, reverse, fades, and legacy clip-envelope data.

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

## Development checks

```bash
python -m pytest
python -m compileall -q .
node --check web/semantic_studio.js
node --check web/semantic_timeline.js
node --check web/semantic_controls.js
node --check web/prompt_import.js
node --check web/ui_i18n.js
node --check web/studio_shell.js
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
