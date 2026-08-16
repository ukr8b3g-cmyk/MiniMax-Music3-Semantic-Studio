# V2.0 UX Final

Status: implemented in frontend; ComfyUI integration / visual verification remains required.

This pass finishes the V2.0 authoring UX without adding V2.1 DSP effects or changing the public V1/V2 node contracts.

## Audio Editor

### Waveform channel display

The waveform now reports the decoded source layout and defaults to an Audacity-style channel view:

- stereo: separate Left and Right waveform lanes
- mono: one waveform lane
- optional preview-only modes: Stereo Split, Stereo Overlay, Mono Mix Preview

Waveform display mode never changes queued AUDIO. Backend output channel layout remains controlled by the existing Master `channel_mode` setting.

### Direct Gain Envelope editing

The selected clip Gain Envelope can be edited directly over the Rendered waveform:

- click inside the selected clip range to add a point
- drag a user point to change clip-relative time / gain
- right-click or double-click a user point to remove it
- boundary anchors remain backend-compatible 0 dB anchors at clip start/end
- Undo/Redo groups each direct manipulation as one edit gesture

The Envelope Inspector remains available as a detailed editor and now includes clip-relative time-grid labels.

### Fade and mute interaction

Main Comp clips expose direct fade-in / fade-out handles. Dragging a fade handle changes the existing versioned `fade_in` / `fade_out` data; the Python renderer remains authoritative.

The context bar also exposes Mute / Unmute for the selected clip using the existing `muted` field.

### Shared scale

Waveform and Main Comp continue to share zoom and horizontal scroll coordinates. Fade/trim/clip gestures operate on the same timeline scale.

## Semantic Studio Timeline view

Semantic Studio adds a `Timeline` navigation view over the existing `project_json` fields. It does not introduce a second timeline data model.

Rows:

- Structure
- Energy
- Lyrics summary
- Arrangement summary
- Vocal summary

Interaction:

- section width represents `duration`
- drag a section right edge to change duration
- Shift + drag the edge to trade duration with the next section while preserving their combined length
- drag Energy points vertically to update the existing section `energy`
- click any section block to select it in the existing Section Inspector
- Timeline scale is a local UI preference and does not alter `project_json`

All duration and energy values remain semantic generation targets for MiniMax Music3, not strict symbolic guarantees.

## V2.1 boundary unchanged

The following remain V2.1+ work and are intentionally not part of this V2.0 UX Final pass:

- pitch shift / time stretch
- EQ / filters
- compressor / limiter
- delay / reverb
- spectrogram
- effect racks / effect automation

No new Python runtime dependency or frontend runtime package is introduced by this UX pass.
