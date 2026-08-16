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

V1 owns generation authoring/conditioning. V2 owns decoded-audio editing. The diffusion model, negative conditioning flow, sampler, latent node, and VAE decode remain standard ComfyUI components.

## V1: semantic generation design

The frontend edits versioned `project_json`. The backend deterministically compiles:

```text
project_json
   |
   +--> validate + normalize (schema_version=1)
   +--> Global Metadata
   +--> Vocal Details
   +--> section-aware Arrangement
   +--> tagged Lyrics
   |
   v
MiniMax Music3 clip.tokenize(...)
   |
   v
encode_from_tokens_scheduled(...)
   |
   v
CONDITIONING + seconds
```

Section type, target duration, energy, lyrics, instruments, vocal treatment, and arrangement directives become structured natural-language guidance. They do not alter MiniMax model internals.

Real MiniMax parameters retained by V1:

- `seed`
- `max_duration`
- `cfg_scale`
- `top_k`

Top-level V1 project fields remain `schema_version`, `project_id`, `global`, `timeline.sections`, plus reserved `audio_edits`, `takes`, and `conditioning_tracks`. Unknown fields are preserved so later phases do not require destructive V1 conversion.

## V2: non-destructive audio editing — implemented

V2 is a separate companion node after `VAE Decode Audio`. It does not add AUDIO sockets to V1 and does not change the V1 node ID/output contract.

```text
VAE Decode Audio
   |
   v
Music3 Semantic Studio Audio Editor
   | AUDIO
   v
Preview / Save Audio
```

V2 uses immutable connected AUDIO inputs plus versioned `edit_json`. The Python renderer is authoritative. The frontend uses native Canvas + HTMLAudioElement + Web Audio APIs for transport/waveform authoring and stores only declarative edit state.

V2 source and rendered previews are separate temporary FLAC references. Reopening the editor therefore starts from the immutable source take(s), preventing double application of saved edits.

The V2.0 renderer implements source slicing, reverse, clip gain, gain envelope, fades, pan, timeline placement/mixing, master channel conversion, master gain, normalization, and explicit Take 1–4 comping. Browser authoring adds selection, split/trim/move, duplicate, silence gaps, crossfade helper, Undo/Redo, Source/Rendered A/B, and a visual V1 section overlay.

Complex DSP such as pitch/time stretch/EQ/compression/reverb remains V2.1 work after V2.0 ComfyUI integration validation.

See [`V2_SPEC.md`](V2_SPEC.md) for the stable V2 node/data/render contract.

## V3: semantic/conditioning automation — experimental, planned

V3 may add time-varying semantic conditioning, conditioning morph tracks, and smart region regeneration/comping. These features must remain opt-in and must not silently patch built-in MiniMax Music3 behavior.

The reserved `conditioning_tracks` namespace is the persistence boundary for these experiments. Real model-side conditioning changes require separate nodes or explicit adapters so V1/V2 workflows remain reproducible.
