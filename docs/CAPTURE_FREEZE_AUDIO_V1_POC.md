# Capture / Freeze Audio V1 PoC

Status: proof of concept. Do not treat this as a finalized public workflow until the runtime acceptance test below passes in ComfyUI.

## Goal

Allow this graph to stay connected:

`Music3 Generation -> Capture / Freeze Audio -> Music3 Semantic Studio Audio Editor -> Save Audio`

After a take is captured, Audio Editor edits must be queueable without requiring Music3/KSampler to run again.

## Public PoC contract

- Node ID: `MiniMaxMusic3AudioFreeze`
- Display name: `Capture / Freeze Audio`
- Category: `audio/minimax music`
- Input: `audio: AUDIO`, lazy
- Widget: `mode = Capture | Frozen`
- Output: `AUDIO`
- Storage: process-local CPU RAM only
- Persistence: none across ComfyUI restart
- External dependencies: none

No changes are made to the Semantic Studio node ID/outputs or Audio Editor `AUDIO -> AUDIO` contract.

## State machine

### Capture

1. `check_lazy_status()` requests `audio`.
2. Upstream Music3 generation is allowed to execute.
3. The AUDIO waveform is detached, moved to CPU, made contiguous, and cloned.
4. The snapshot replaces the previous snapshot for this node ID.
5. A clone of the snapshot is returned as AUDIO.

### Frozen

1. `check_lazy_status()` returns no requested inputs.
2. The lazy `audio` input must not be evaluated.
3. The CPU snapshot for this node ID is cloned and returned.
4. If no snapshot exists, execution fails explicitly. It must never silently request upstream generation as fallback.

## Cache identity

The hidden ComfyUI `unique_id` is the cache key. Each graph node therefore owns one session-local frozen take. Re-capture replaces only that node's previous take.

## Immutability and VRAM rules

Stored snapshots use an owned CPU tensor equivalent to:

`waveform.detach().to("cpu").contiguous().clone()`

Retrieval returns another clone so downstream in-place work cannot corrupt the stored take. The cache must not retain GPU tensors or autograd history.

## Deliberate V1 exclusions

- No disk persistence.
- No automatic restore after ComfyUI restart.
- No hidden generation history or take library.
- No model-name detection or compatibility gating.
- No changes to KSampler, MiniMax Music3 core nodes, ComfyUI core, or Audio Editor edit schema.
- No automatic recapture when Frozen data is missing.

## Runtime acceptance test

Use a real MiniMax Music3 workflow and watch the ComfyUI console/log.

1. Put the node in `Capture`.
2. Queue once and confirm Music3/KSampler runs.
3. Confirm Audio Editor receives the captured AUDIO.
4. Switch to `Frozen`.
5. Change only Audio Editor edits, Save Edits, and queue again.
6. PASS only if Audio Editor/render/save executes while Music3/KSampler does not execute.
7. Repeat several Audio Editor edits while Frozen.
8. Switch to Capture and confirm a new generation can replace the frozen take.
9. Restart ComfyUI, leave the node Frozen, and confirm it errors clearly instead of regenerating.

## Promotion criteria

Promote the PoC to the V1 workflow only after the runtime acceptance test proves that ComfyUI's lazy-input scheduling does not evaluate the upstream AUDIO branch in Frozen mode. Unit tests cover snapshot ownership, per-node replacement, isolation from downstream mutation, metadata, and missing-cache failure; they do not substitute for the scheduler-level runtime test.
