# Music3 Semantic Studio architecture

## Stable external boundary

The project is a ComfyUI custom-node package. It does not patch MiniMax Music3 model code or the sampler path.

```text
Load CLIP
   |
   v
Music3 Semantic Studio (V1)
   | CONDITIONING                 seconds
   |                                |
   v                                v
KSampler <---------------- Empty MiniMax Music3 Latent Audio
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

V1 owns generation authoring/conditioning. V2 owns decoded-audio editing.

## V1: semantic generation design

The frontend edits versioned `project_json`. The backend deterministically compiles Global Metadata, Vocal Details, section-aware Arrangement, and tagged Lyrics into MiniMax Music3 conditioning. Timing, BPM, key, energy, vocal treatment, and instruments remain semantic generation targets.

## V2: schema 2 unified audio editing

V2 uses immutable connected AUDIO tensors plus versioned `edit_json`. Schema 1 is migrated to schema 2 with neutral track controls while preserving clips and unknown fields.

```text
edit_json schema 2
   |
   +--> Takes
   +--> Tracks
   |      +--> clips[]
   |      +--> mute / solo / gain / pan
   |      +--> full-track gain envelope
   |      +--> effects[] boundary
   +--> Master
   |      +--> channel mode / gain / normalize
   |      +--> effects[] boundary
   |
   +--> Browser Draft renderer (preview)
   +--> Python/PyTorch renderer (authoritative)
```

The unified waveform is the normal editing surface. Clip boundaries are a thin overlay rather than a separate Main Comp lane. Select and Envelope tools own separate pointer modes. Draft Preview rerenders current declarative edits from decoded source-take previews; final AUDIO is always regenerated from original connected tensors after Save Edits -> Queue.

Backend order is clip processing, track automation/controls, track mix, then master processing. Effects arrays are reserved but enabled effects fail explicitly until V2.1 DSP is implemented.

See [`V2_SPEC.md`](V2_SPEC.md).

## V3: semantic/conditioning automation — experimental

V3 may add time-varying semantic conditioning, conditioning morph tracks, and smart region regeneration/comping. These features must remain opt-in and separate from stable V1/V2 workflows.
