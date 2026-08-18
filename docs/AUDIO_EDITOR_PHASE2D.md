# Audio Editor Phase 2D — Single Audio Release Finish

Phase 2D is the final feature implementation phase before the Version 1.0 feature freeze.

## User-facing model

The Audio Editor exposes one audio pipeline and exactly four top-level workspaces:

```text
Edit | Mixer | Effects | VST3
```

There is no user-facing Track/Master concept and no multi-track workflow in Version 1.0. Multiple Take compatibility may remain internally and through existing preview/clip assignment paths, but it does not create another top-level workspace.

Internal `tracks[0]` and `master` fields remain in `edit_schema_version=2` for compatibility. Existing input-stage effects followed by existing output-stage effects are displayed as one ordered pipeline, but ordinary parameter/state edits keep each effect in its historical internal stage. New release effects append to the pipeline end. Only an explicit reorder may move an effect across the hidden internal boundary.

## Mixer

The release Mixer is one panel:

- Input Gain — before Effects/VST3
- Pan
- Output Gain — after Effects/VST3
- Channel mode
- Normalize
- Target Peak

The old Track/Master section headings, Track name and Solo control are not part of the release UI.

## Built-in Effects

One rack only:

- Add Effect
- On / Bypass
- Reorder
- Parameters
- Reset
- Delete

The old Track/Master owner switch is not shown.

## VST3

VST3 is also one rack. There is no secondary `Plugins | Rack` navigation.

Normal VST3 view:

- `+ Add VST3`
- added VST3 effects immediately visible in the rack
- the same power-state grammar as built-in Effects (`ON` / `BYPASS`)
- Open UI / Close UI
- Reorder
- Remove
- Native state capture and restore
- Named VST3 preset library stored in browser IndexedDB
- Preset Load is an Audio Editor Undo/Redo operation

`+ Add VST3` temporarily opens a compact installed-effect chooser containing only Search, the installed VST3 list, and Add. Adding an effect closes the chooser and returns directly to the rack with the new effect selected. Favorites, Recent, Vendor and Category filter controls are not part of the Version 1.0 UI.

The VST3 scanner still records vendor/category metadata internally and exposes the detected effect count for status and future compatibility.

### Draft vs Queue

Browser Draft previews built-in DSP only. Enabled VST3 entries are deliberately bypassed in Browser Draft rather than treated as unsupported effects. The queued Python/Pedalboard renderer remains authoritative for VST3 processing. Unknown non-VST effects still fail explicitly in Draft instead of being silently ignored.

## Undo / Redo

The Audio Editor project commit history is authoritative for:

- edit commands and clip operations
- Mixer changes
- built-in Effect add/remove/reorder/parameter/On-Bypass changes
- VST3 add/remove/reorder/On-Bypass changes
- VST3 preset loads
- one complete Native UI state capture when the plugin window closes

Undo/Redo is temporarily blocked while a Native VST3 editor is open so the effect target cannot disappear while state capture is pending.

Preset-library creation/deletion is a library operation rather than an audio-project edit. Loading a preset changes the audio project and is undoable.

## Explicitly out of scope for Version 1.0

- multiple tracks
- Send / Bus routing
- A/B snapshot system
- genre-driven BPM/key/section replacement
- automatic prompt generation
- DAW-style routing expansion

## Compatibility

Phase 2D does not change:

- node IDs
- AUDIO input/output contract
- `edit_schema_version=2`
- Queue render authority
- stored unknown fields
- VST3 state encoding

## After Phase 2D

```text
Phase 2D complete
→ Feature Freeze
→ full regression / real-device debugging
→ RC1
→ fixes
→ RC2 if required
→ Version 1.0
```

No new feature class should be introduced between Feature Freeze and Version 1.0 unless required to resolve a release-blocking defect.
