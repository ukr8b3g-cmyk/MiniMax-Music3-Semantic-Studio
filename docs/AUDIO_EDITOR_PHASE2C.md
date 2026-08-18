# Audio Editor Phase 2C — Interface Consolidation

Phase 2C treats the Audio Editor as one application rather than a collection of independently styled features.

## Top-level workspace

Stable order:

```text
Edit | Mixer | Effects | VST3
```

`Edit` is the default workspace. `Sources` remains conditional for multi-take compatibility and is placed after VST3 when present.

Top-level tabs share the same hover, selected, disabled, border and font-weight behavior. Color is primarily state-driven rather than feature-driven.

## Shared UI state language

- Selected / active control: common purple accent and stronger label weight.
- Enabled audio processing: green state where appropriate.
- Bypass / off: visually muted without disappearing.
- Disabled: common reduced-opacity state.
- Error: common warning treatment.
- Delete: common danger treatment.
- Busy: temporary status only; no permanent explanatory panel.

Transport playback and Mute/Solo keep their semantic colors because they communicate different operational states rather than navigation selection.

## Edit

The existing waveform, transport, clip editing, timeline layout and inspector architecture remain intact.

Persistent beginner-oriented helper text is removed from the normal working surface. Tooltips, labels and explicit error states remain available.

## Mixer

Track and Master remain together in the Mixer workspace. Mixer does not duplicate Effects or VST3 browser controls.

## Effects

Built-in effects remain in their existing rack. Track/Master selection uses the same selected-state language as the rest of the editor.

Development-phase labels and warnings remain excluded from the production working surface.

## VST3

VST3 uses two secondary views:

```text
Plugins | Rack
```

`Plugins` is the default and receives the primary scroll area.

Plugins view contains only the high-value workflow:

```text
Plugins | Rack      Ready · N plugins   Rescan
Search VST3...

Plugin Name                    + Track  + Master
```

The normal surface does not show Phase numbers, scan-folder paths, long host descriptions, native-UI implementation explanations or large empty rack boxes.

Plugin path/vendor information remains available as compact metadata/tooltips and for search matching.

Rack view contains only added Track/Master VST3 instances and their operational controls:

```text
Plugin       ON/Saved     Open UI  Bypass  ↑  ↓  ×
```

Native Plugin UI behavior:

- `Open UI` opens the original VST3 editor window.
- While open, the same control becomes `Close UI`.
- Close uses the Phase 2B `show_editor(close_event)` control path.
- If a plugin ignores close, only the isolated helper process is force-stopped.
- A failed close request becomes retryable.
- Forced close is reported as forced close rather than a generic plugin failure.
- Save Edits remains blocked while native UI is open so plugin state cannot be saved mid-edit.

## Compatibility boundaries

Phase 2C does not change:

- Audio Editor node ID.
- AUDIO input/output contract.
- `edit_schema_version=2`.
- Python Queue renderer authority.
- VST3 state storage format introduced in Phase 2B.
- Browser Draft boundary for VST3.

The phase is intentionally an interface consolidation, not a schema or DSP redesign.
