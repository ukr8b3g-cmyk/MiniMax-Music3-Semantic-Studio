# VST3 Phase 2A — queued host rendering

Phase 2A adds Windows 64-bit VST3 **effect** processing to the Audio Editor's authoritative Python Queue render.

## VST3 host dependency

Starting with Phase 2B distribution, the repository root `requirements.txt` installs Pedalboard automatically on Windows when the custom node is installed or updated through ComfyUI Manager.

`requirements-vst3.txt` remains only as a manual recovery/fallback path for installations where the normal dependency step was skipped or damaged:

```bash
python -m pip install -r requirements-vst3.txt
```

Restart ComfyUI after dependency changes. The VST3 tab reports whether the Pedalboard host is ready.

## Workflow

1. Open Audio Editor → `VST3`.
2. Choose an installed effect and add it to `Track` or `Master`.
3. Reorder, Bypass/Enable, or remove VST3 instances in the VST3 rack.
4. `Save Edits`.
5. Queue the Audio Editor node. The Python renderer loads the selected VST3 plugin and processes AUDIO in rack order.

Phase 2A appends VST3 effects after built-in effects for each owner. VST3-to-VST3 order is preserved.

## Boundaries

- Windows 64-bit VST3 effects only.
- VST instruments are rejected by the host even if Phase 1 could not classify them.
- Browser Draft does not host VST3. Queue render is authoritative.
- Native plugin UI and captured plugin state are implemented in Phase 2B.
- Arbitrary VST3 release/reverb tails are not inferred. The output buffer length remains the input buffer length for a VST3 stage; built-in Reverb/Delay keep their existing deterministic tail behavior.
- Plugin load/process failures are explicit errors; they are never silently bypassed.

## Stored effect record

VST3 instances are stored inside the existing track/master `effects[]` arrays, preserving the public `edit_schema_version=2` format:

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
    "phase": "2A"
  }
}
```

Phase 2B extends the same record with captured native plugin state without changing the edit schema version.
