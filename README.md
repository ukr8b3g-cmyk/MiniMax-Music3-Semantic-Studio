# MiniMax Music3 Semantic Studio

**Music3 Semantic Studio** is an external ComfyUI custom node for designing MiniMax Music 3 songs on a semantic timeline.

Current status: **Phase 1 / V1**.

V1 focuses on generation design. It converts structure, per-section lyrics, energy, instrumentation, vocal direction, and arrangement notes into MiniMax Music3 structured caption/lyrics conditioning while leaving ComfyUI's sampler, model, latent, and VAE path untouched.

## V1 node

- Node ID: `MiniMaxMusic3SemanticStudio`
- Display name: `Music3 Semantic Studio`
- Category: `model/conditioning/minimax music`
- Outputs: `CONDITIONING`, `seconds`

The public output contract matches the role of ComfyUI's built-in `MiniMax Music3 Text Encode` node, so the rest of the standard MiniMax Music3 workflow can stay unchanged.

## Installation

Clone this repository into the active ComfyUI `custom_nodes` directory and restart ComfyUI.

```bash
cd ComfyUI/custom_nodes
git clone https://github.com/ukr8b3g-cmyk/MiniMax-Music3-Semantic-Studio.git
```

No additional Python runtime packages are required for V1.

## Basic workflow

Replace the built-in `MiniMax Music3 Text Encode` node with `Music3 Semantic Studio`:

```text
Load CLIP
   |
   v
Music3 Semantic Studio ---------------------> KSampler positive
   |
   +---- seconds ----> Empty MiniMax Music3 Latent Audio ----> KSampler latent_image

Load Diffusion Model -----------------------------------------> KSampler model
Conditioning Zero Out ----------------------------------------> KSampler negative
KSampler ----> VAE Decode Audio ----> Preview / Save Audio
```

On the Studio node, click **Open Semantic Studio**.

### Global tab

Defines semantic song-level intent:

- genre / subgenre influences
- BPM and meter targets
- optional key / scale target
- mood / emotional direction
- production profile
- vocal mode and vocal details

### Timeline tab

Each section stores:

- section type (`Intro`, `Verse`, `Chorus`, `Bridge`, etc.)
- display label
- target duration
- energy 0–100%
- instruments
- section vocal treatment
- lyrics
- arrangement directive

Sections can be added, deleted, and reordered. Saving synchronizes the total timeline duration to the node's `max_duration` value.

### Compiled Preview tab

Shows the Structured Caption and tagged Lyrics that V1 will compile for MiniMax Music3. The backend compiler remains authoritative; the browser preview is provided for authoring feedback.

## What V1 does not claim

V1 is intentionally semantic. BPM, key, exact section boundaries, energy, and instrumentation are generation instructions rather than strict symbolic controls. MiniMax Music3 may deviate from those targets and may end before `max_duration`.

V1 does not provide audio inpainting, stem editing, waveform effects, or time-varying model conditioning.

## V2 / V3 direction

- **V2**: non-destructive waveform editing, envelopes/effects, take management, and comping after generation.
- **V3**: experimental semantic automation / conditioning morph tracks and smart region regeneration strategies.

The V1 project format already reserves `audio_edits`, `takes`, and `conditioning_tracks` so later phases can extend existing projects without replacing the V1 authoring model.

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the implementation boundary and phase plan.

## Development checks

```bash
python -m pytest
python -m compileall -q .
node --check web/semantic_studio.js
```
