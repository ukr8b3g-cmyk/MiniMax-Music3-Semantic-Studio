# Phase B.2 — Unified Waveform Audio Editor

Status: implemented in frontend/backend with pure-module tests; ComfyUI visual/audio integration verification pending.

Phase B.2 replaces the clip-lane-first interaction with an Audacity-style unified waveform surface while preserving immutable source AUDIO and authoritative Python rendering.

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

The waveform height follows available editor space through `ResizeObserver`; `view.waveform_height` is normalized to 220–900 px.

## Tool modes

- `F1` — Select tool
- `F2` — Envelope tool

Select mode owns waveform selection/seek gestures. Envelope mode owns gain-automation point gestures, preventing ambiguous pointer behavior.

## Main Track controls

The left strip controls the Main Track rather than the selected clip:

- Mute
- Solo
- Gain
- Pan

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

Schema-1 clip envelopes remain supported for compatibility but are not the primary authoring surface.

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
12. track effects boundary
13. mix tracks
14. master effects boundary
15. master channel mode
16. master gain
17. peak normalization

Draft Preview updates after editing commands and while envelope gestures pause briefly. Mute, envelope, Cut, Paste, Split, and track controls can therefore be auditioned without Queue.

The browser preview is not authoritative. PCM16 browser playback may differ at clipping/extreme gain boundaries. **Save Edits -> Queue** always rerenders from original connected AUDIO tensors in Python/PyTorch.

## Selection

The bottom Selection bar exposes fixed-width numeric fields:

- Start
- End
- Length

Selection values use seconds with millisecond steps. The transport and peak values use tabular numerals to avoid UI jitter.

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

## V2.1 boundary

Effects arrays are normalized and persisted, but enabled effects fail explicitly until the V2.1 DSP renderer is implemented. No EQ, compressor, limiter, delay, reverb, pitch shift, or time stretch is silently simulated.
