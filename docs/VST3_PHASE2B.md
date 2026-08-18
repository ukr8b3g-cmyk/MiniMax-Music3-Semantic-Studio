# VST3 Phase 2B — Native Plugin UI

Phase 2B adds the original/native Windows VST3 editor window on top of the Phase 2A queued VST3 renderer.

## Distribution dependency

The repository root now contains:

```text
requirements.txt
```

with a Windows-only PEP 508 marker for Pedalboard. ComfyUI Manager installs a custom node's root `requirements.txt` during normal installation, so Windows users installing/updating through Manager normally receive the VST3 host automatically.

`requirements-vst3.txt` remains as a manual recovery/fallback file for non-Manager or damaged environments.

## User flow

1. Open Audio Editor → `VST3`.
2. Add an installed VST3 effect to `Track` or `Master`.
3. Click `Open UI` on that rack entry.
4. The plugin's original VST3 interface opens in a separate native window.
5. Change the plugin controls and close the native window.
6. The editor captures the plugin state and marks the VST3 rack dirty.
7. Click `Save Edits`.
8. Queue the Audio Editor node. The authoritative Python render restores the captured plugin state before processing AUDIO.

## Process isolation

Pedalboard's `show_editor()` must run on the main thread and blocks that thread while the native window is open. Phase 2B therefore does **not** call it from the ComfyUI server process.

The server starts `vst3_editor_process.py` with the same Python interpreter used by ComfyUI. The helper process:

- loads exactly one VST3 effect,
- restores previously saved state,
- calls `show_editor()` on the helper's main thread,
- captures the plugin state when the window closes,
- exits.

The ComfyUI event loop remains responsive while the helper window is open. A plugin crash in the native editor is also better isolated from the main ComfyUI process.

Only one native VST3 editor window is allowed at a time in Phase 2B.

## State storage

The existing `edit_schema_version=2` is preserved. VST3 state remains inside the existing effect record:

```json
{
  "id": "vst3-...",
  "type": "vst3",
  "enabled": true,
  "params": {
    "path": "C:\\Program Files\\Common Files\\VST3\\Example.vst3",
    "plugin_name": "Example",
    "name": "Example",
    "vendor": "Vendor",
    "phase": "2B",
    "state_kind": "preset_data",
    "state_b64": "...",
    "state_bytes": 1234,
    "plugin_identifier": "...",
    "plugin_version": "..."
  }
}
```

`preset_data` is preferred. `raw_state` is used only as a fallback when the plugin cannot expose preset data.

The stored plugin identifier is checked before restoring state during Queue render. If the installed plugin no longer matches the captured state, rendering fails explicitly and asks the user to reopen the native UI and save fresh state.

## Safety boundaries

- Windows 64-bit VST3 effects only.
- VST instruments are rejected.
- The native-editor route only accepts paths returned by the current installed VST3 scan; arbitrary executable/plugin paths cannot be requested through this endpoint.
- State payloads have explicit size limits.
- `Save Edits` is blocked while a native plugin window is still open so the latest state cannot be lost.
- Plugin load, editor, state restore, and processing failures are explicit errors; there is no silent bypass.
- Browser Draft still uses built-in DSP only. Queue render remains authoritative for VST3.
- Arbitrary VST3 tails are still not inferred automatically in Phase 2B.

## Not included yet

- Multiple native plugin windows at once.
- Embedded native VST3 UI inside the HTML/ComfyUI panel.
- Generic parameter sliders as a replacement for the original plugin UI.
- Automatic VST3 tail-length discovery.
- VST2, LV2, AU, or instrument hosting.
