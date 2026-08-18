# VST3 Phase 2A — queued host rendering

Phase 2A adds optional Windows 64-bit VST3 **effect** processing to the Audio Editor's authoritative Python Queue render.

## Install the optional host

The core custom node still has no new required runtime dependency. To enable VST3 hosting, install the optional file into the same Python environment used by ComfyUI:

```bash
python -m pip install -r requirements-vst3.txt
```

Restart ComfyUI afterwards. The VST3 tab reports whether the Pedalboard host is ready.

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
- Native plugin UI is Phase 2B.
- Plugin parameters/preset state editing is Phase 2B/2C; Phase 2A uses the plugin's default loaded state.
- Arbitrary VST3 release/reverb tails are not inferred in Phase 2A. The output buffer length remains the input buffer length for a VST3 stage; built-in Reverb/Delay keep their existing deterministic tail behavior.
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
