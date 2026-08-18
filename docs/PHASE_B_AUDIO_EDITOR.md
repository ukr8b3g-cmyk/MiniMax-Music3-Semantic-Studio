# Phase B.2 — Unified Waveform Audio Editor

Status: implemented in frontend/backend with pure-module tests; V2.1-C Reverb + Stereo Delay is implemented; ComfyUI visual/audio integration verification pending.

Phase B.2 replaces the clip-lane-first interaction with an Audacity-style unified waveform surface while preserving immutable source AUDIO and authoritative Python rendering.

## Mockup-aligned layout

The approved Audio Editor mockup is implemented as four visible areas:

1. a compact metadata toolbar for Preview, Undo/Redo, Fit, Zoom and waveform layout
2. a colored command dock containing Transport, Select/Envelope tools and primary edit commands
3. a unified Main Track surface with Track controls, L/R meters, semantic sections, waveform, clip boundaries and Track Envelope
4. a large bottom dock for Position, Selection and upstream semantic Tempo/Meter/Key references

Transport now includes Go to Start and Go to End around Play/Pause/Stop. `Home` and `End` trigger the same navigation.

The command groups use restrained functional accents:

- green — Transport and playback
- blue — Select / Envelope tools
- purple — Cut / Copy / Paste / Split / Delete / Silence

## Editing surface

The visible standalone Main Comp lane is removed from the normal editor. The main waveform is the edit surface for:

- seek and time selection
- Cut / Copy / Paste
- Split
- Ripple Delete
- Silence / Leave Gap
- Track Gain Envelope
- clip-boundary selection

Non-destructive `tracks[].clips[]` remain the persisted implementation. Thin clip blocks at the top of the waveform show boundaries, source take, selected state, and clip mute state without creating a second competing timeline.

The waveform height follows available editor space through `ResizeObserver`; `view.waveform_height` remains normalized by schema 2 and the mockup UI keeps a larger practical minimum while maximized.

## Tool modes

- `F1` — Select tool
- `F2` — Envelope tool

Select mode owns waveform selection/seek gestures. Envelope mode owns gain-automation point gestures, preventing ambiguous pointer behavior.

## Main Track controls and meters

The left strip controls the Main Track rather than the selected clip:

- Mute
- Solo
- Gain
- Pan

The Preview Peak meter is placed below these controls instead of occupying a separate right column. Stereo L/R meters are always shown side by side, use wider/taller rails, and show fixed-width values such as `-22.2 dBFS` or `-∞ dBFS`. Mono preview uses one centered meter.

Advanced clip-specific source ranges, gain, pan, mute, reverse, and fades remain available in the Clip inspector.

## Track Gain Envelope

Schema 2 adds `tracks[].gain_envelope` as full-timeline gain automation.

- click the waveform in Envelope mode to add a point
- drag to change time and dB
- right-click or double-click to delete
- hover displays time and dB
- no selected clip is required
- the curve spans clip boundaries
- before the first point and after the last point, the nearest user value is held
- an empty envelope is neutral 0 dB

The approved UI presents automation as a visually separated lower lane inside the same waveform surface. Schema-1 clip envelopes remain supported for compatibility but are not the primary authoring surface.

## Browser Draft Preview

The editor decodes Take 1–4 temporary source previews, applies current declarative edits in JavaScript, creates a temporary PCM WAV Object URL, and loads it into the existing waveform/transport.

Draft render order mirrors Python:

1. source slice
2. reverse
3. clip gain
4. legacy clip envelope
5. fades
6. clip pan
7. place/sum into track
8. track envelope
9. track gain
10. track pan
11. track mute/solo
12. track effects in rack order
13. mix tracks
14. master effects in rack order
15. master channel mode
16. master gain
17. peak normalization

Draft Preview updates after editing commands and after an envelope gesture is committed. Mute, envelope, Cut, Paste, Split, track controls, and supported V2.1-C effects can therefore be auditioned without Queue.

The browser preview is not authoritative. PCM16 browser playback may differ at clipping/extreme gain boundaries. **Save Edits -> Queue** always rerenders from original connected AUDIO tensors in Python/PyTorch.

## Position, Selection and semantic reference

The bottom dock uses large fixed-width `HH:MM:SS.mmm` fields:

- Position — current playhead location
- Selection Start
- Selection End
- Selection Length

Start and End accept either seconds or `MM:SS.mmm` / `HH:MM:SS.mmm` input.

When exactly one upstream Semantic Studio can be resolved, the dock also shows its semantic target values:

- Tempo / BPM
- Meter
- Key / Scale wording

These values are references to generation targets, not measured guarantees of the rendered waveform.

Optional selection/split/paste snap supports Off, 1/4, 1/8 and 1/16 using the upstream semantic BPM. Snap defaults to Off because generated audio may not land exactly on the requested beat grid.

## Editing commands

- Cut / Copy / Paste at playhead
- Split
- Duplicate
- Reverse
- Delete / Ripple
- Silence / Leave Gap
- Cut & Leave Gap
- Mute track / Mute selected clip
- Crossfade Next
- Selection Loop audition

The internal clipboard stores declarative clip slices, immutable source references, and copied track-envelope automation. It does not place PCM audio on the operating-system clipboard.

## Schema and migration

`edit_schema_version=2` adds:

```json
{
  "tracks": [{
    "muted": false,
    "solo": false,
    "gain_db": 0.0,
    "pan": 0.0,
    "gain_envelope": [],
    "effects": [],
    "clips": []
  }],
  "master": {
    "effects": []
  }
}
```

Schema 1 is accepted and migrated automatically with neutral track controls. Existing clip fields and unknown data are preserved.

## V2.1-C DSP

Track and Master `effects[]` execute in rack order in both Browser Draft and the authoritative Python/PyTorch renderer.

Implemented effects:

- Gain / Amplify
- High-Pass Filter
- Low-Pass Filter
- EQ (3-Band)
- Compressor
- Limiter, including Auto Level authoring assistance
- Stereo Width
- Reverb
- Stereo Delay, including Ping-Pong

Reverb and Delay report bounded effect tails so Track and Master spatial effects are not truncated at the semantic timeline boundary. Reverb uses deterministic room-response processing inspired by established FreeVerb/Schroeder practice; Delay uses deterministic bounded feedback processing. No new mandatory Python runtime dependency is required.

Enabled unknown future effect types still fail explicitly rather than being silently ignored. Pitch Shift / Time Stretch remain future work and are not part of V2.1-C.

## Remaining ComfyUI verification

Still required on a real ComfyUI workflow:

- source decode -> editor open / empty editor -> queued source transition
- Draft playback after Mute/Envelope/Cut and supported effects
- Save Edits -> Queue -> Rendered A comparison for each V2.1-C effect
- rack-order comparison with multiple effects
- Limiter Auto Level on representative generated songs
- Selection Loop start/end behavior during long playback
- Take 2 comping
- long-duration performance and memory observation
