# Repository instructions

- Keep this custom node external to ComfyUI core. Do not require patches to `ComfyUI/comfy`, built-in MiniMax Music3 nodes, KSampler, or VAE code.
- Preserve the public node ID `MiniMaxMusic3SemanticStudio`, display name `Music3 Semantic Studio`, and V1 outputs `(CONDITIONING, seconds)` unless a versioned migration is explicitly planned.
- Treat `project_json.schema_version` as a persistent public format. Add migrations for incompatible changes; preserve unknown fields so V2/V3 data can round-trip through older V1-compatible code.
- V1 is semantic conditioning only. BPM, key, section timing, energy, vocal treatment, and instruments are prompt targets, not strict symbolic controls. Do not present them as guaranteed model behavior.
- Reserve `audio_edits`, `takes`, and `conditioning_tracks` for later phases. V1 must not execute or reinterpret them.
- Prefer deterministic, dependency-free project compilation. Add runtime dependencies only when a phase needs them.
- Before committing Python changes, run `python -m pytest` and `python -m compileall -q .`. Before committing frontend changes, run `node --check web/semantic_studio.js` when Node.js is available.
