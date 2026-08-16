# Music3 Semantic Studio architecture

## Stable external boundary

The project is a ComfyUI custom node. It does not patch MiniMax Music3 model code or the sampler path.

```text
Load CLIP
   |
   v
Music3 Semantic Studio
   | CONDITIONING                 seconds
   |                                |
   v                                v
KSampler <---------------- Empty MiniMax Music3 Latent Audio
   |
   v
VAE Decode Audio
```

V1 replaces only the authoring/conditioning role of the built-in `MiniMax Music3 Text Encode` node. The diffusion model, negative conditioning flow, sampler, latent node, and VAE decode remain standard ComfyUI components.

## V1: semantic generation design

The frontend edits a versioned `project_json` document. The backend performs this deterministic pipeline:

```text
project_json
   |
   +--> validate + normalize (schema_version=1)
   |
   +--> compile Global Metadata
   +--> compile Vocal Details
   +--> compile section-aware Arrangement
   +--> compile tagged Lyrics
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

The UI exposes section type, target duration, energy, lyrics, instruments, vocal treatment, and arrangement directives. These become structured natural-language guidance. They do not alter MiniMax model internals.

### Real model parameters retained

- `seed`
- `max_duration`
- `cfg_scale`
- `top_k`

Saving the semantic timeline synchronizes the sum of section target durations to `max_duration`, clamped to the active ComfyUI node limit. MiniMax may still end earlier.

### Project format

Top-level V1 fields:

- `schema_version`
- `project_id`
- `global`
- `timeline.sections`
- `audio_edits` (reserved)
- `takes` (reserved)
- `conditioning_tracks` (reserved)

Unknown fields are preserved on load. This is intentional so later phases can extend the document without forcing V1-era projects through destructive conversion.

## V2: non-destructive audio editing (planned)

V2 will consume generated `AUDIO` after decode and add waveform editing, gain/fade envelopes, effects, take management, and comping. Editing operations should be stored as project operations rather than destructively replacing the source waveform during authoring.

The V1 node ID and conditioning outputs should remain stable.

## V3: semantic/conditioning automation (experimental, planned)

V3 may add time-varying semantic conditioning, conditioning morph tracks, and smart region regeneration/comping. These features must remain opt-in and must not silently patch built-in MiniMax Music3 model behavior.

The reserved `conditioning_tracks` namespace is the persistence boundary for these experiments. Any real model-side conditioning changes require separate nodes or explicit adapters so V1 workflows remain reproducible.
