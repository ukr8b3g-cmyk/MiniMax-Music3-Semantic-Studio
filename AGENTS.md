# Repository instructions

- Keep this custom node external to ComfyUI core. Do not require patches to `ComfyUI/comfy`, built-in MiniMax Music3 nodes, KSampler, or VAE code.
- Preserve the public node ID `MiniMaxMusic3SemanticStudio`, display name `Music3 Semantic Studio`, and V1 outputs `(CONDITIONING, seconds)` unless a versioned migration is explicitly planned.
- Treat `project_json.schema_version` as a persistent public format. Add migrations for incompatible changes; preserve unknown fields so V2/V3 data can round-trip through older V1-compatible code.
- V1 is semantic conditioning only. BPM, key, section timing, energy, vocal treatment, and instruments are prompt targets, not strict symbolic controls. Do not present them as guaranteed model behavior.
- Reserve `audio_edits`, `takes`, and `conditioning_tracks` for later phases. V1 must not execute or reinterpret them.
- Prefer deterministic, dependency-free project compilation. Add runtime dependencies only when a phase needs them.
- V2 must be a separate downstream AUDIO companion node; do not add AUDIO inputs/outputs to the V1 conditioning node.
- V2 source AUDIO is immutable. The backend renderer must derive output only from connected AUDIO input(s) plus versioned `edit_json`; browser preview must not be authoritative.
- V2.0 must not add Python runtime dependencies. Use PyTorch and ComfyUI audio/UI helpers for the core renderer. Optional V2.1 DSP dependencies must be feature-detected and must not prevent V2.0 from loading.
- Do not use runtime CDN assets in V2. Vendor/bundle the pinned frontend dependency and include its license notice. V2.0 is specified against stable WaveSurfer.js 7.12.11.
- V2 takes must be explicit graph inputs in the core design; do not silently persist automatic generation history as hidden files.
- Follow `docs/V2_SPEC.md` for V2 node IDs, edit schema semantics, render order, feature boundaries, and acceptance criteria.
- Before committing Python changes, run `python -m pytest` and `python -m compileall -q .`. Before committing frontend changes, run `node --check web/semantic_studio.js` and `node --check web/audio_editor.js` when the latter exists and Node.js is available.
