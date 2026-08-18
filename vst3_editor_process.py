from __future__ import annotations

import base64
import json
import sys
from pathlib import Path
from threading import Event, Thread
from typing import Any, TextIO

try:
    from .vst3_window import start_native_editor_window_manager
except ImportError:  # Executed directly by the helper subprocess.
    from vst3_window import start_native_editor_window_manager

MAX_STATE_BYTES = 32 * 1024 * 1024


def _load_plugin(path: str, plugin_name: str):
    from pedalboard import load_plugin

    kwargs: dict[str, Any] = {"initialization_timeout": 15.0}
    if plugin_name:
        kwargs["plugin_name"] = plugin_name
    try:
        return load_plugin(path, **kwargs)
    except Exception as first:
        if plugin_name:
            try:
                return load_plugin(path, initialization_timeout=15.0)
            except Exception:
                pass
        raise RuntimeError(f"Could not load VST3 plugin {plugin_name or Path(path).stem!r}: {first}") from first


def _decode_state(value: Any) -> bytes:
    if not value:
        return b""
    try:
        data = base64.b64decode(str(value), validate=True)
    except Exception as exc:
        raise ValueError("Stored VST3 state is not valid base64 data.") from exc
    if len(data) > MAX_STATE_BYTES:
        raise ValueError(f"Stored VST3 state exceeds the {MAX_STATE_BYTES // (1024 * 1024)} MiB safety limit.")
    return data


def _restore_state(plugin: Any, payload: dict[str, Any]) -> None:
    data = _decode_state(payload.get("state_b64"))
    if not data:
        return
    expected_identifier = str(payload.get("plugin_identifier") or "").strip()
    actual_identifier = str(getattr(plugin, "identifier", "") or "").strip()
    if expected_identifier and actual_identifier and expected_identifier != actual_identifier:
        raise ValueError(
            "Stored VST3 state belongs to a different plugin identifier. Reopen the plugin UI to create fresh state."
        )
    kind = str(payload.get("state_kind") or "preset_data")
    if kind == "raw_state":
        plugin.raw_state = data
    else:
        plugin.preset_data = data


def _capture_state(plugin: Any) -> tuple[str, bytes]:
    try:
        data = bytes(plugin.preset_data)
        kind = "preset_data"
    except Exception:
        data = bytes(plugin.raw_state)
        kind = "raw_state"
    if len(data) > MAX_STATE_BYTES:
        raise ValueError(f"VST3 state exceeds the {MAX_STATE_BYTES // (1024 * 1024)} MiB safety limit.")
    return kind, data


def _start_close_watcher(close_event: Event, stream: TextIO | None = None) -> Thread:
    """Watch stdin for a close request while show_editor owns the main thread."""

    control = stream if stream is not None else sys.stdin

    def watch() -> None:
        try:
            for line in control:
                if line.strip().casefold() in {"close", "quit", "exit"}:
                    close_event.set()
                    return
        except Exception:
            # Losing the control pipe must not crash the native editor helper.
            return

    thread = Thread(target=watch, name="m3ss-vst3-close-watcher", daemon=True)
    thread.start()
    return thread


def run(input_path: Path, output_path: Path) -> None:
    payload = json.loads(input_path.read_text(encoding="utf-8"))
    path = str(payload.get("path") or "").strip()
    plugin_name = str(payload.get("plugin_name") or "").strip()
    if not path or Path(path).suffix.lower() != ".vst3":
        raise ValueError("A valid .vst3 path is required.")

    plugin = _load_plugin(path, plugin_name)
    if not bool(getattr(plugin, "is_effect", False)):
        raise ValueError(f"Plugin {plugin_name or Path(path).stem!r} is not an audio effect.")

    _restore_state(plugin, payload)
    close_event = Event()
    _start_close_watcher(close_event)
    window_manager_stop = Event()
    window_manager = start_native_editor_window_manager(plugin_name, window_manager_stop)
    try:
        plugin.show_editor(close_event)
    finally:
        window_manager_stop.set()
        if window_manager is not None:
            window_manager.join(timeout=0.75)
    state_kind, state = _capture_state(plugin)

    result = {
        "ok": True,
        "state_kind": state_kind,
        "state_b64": base64.b64encode(state).decode("ascii"),
        "state_bytes": len(state),
        "plugin_name": str(getattr(plugin, "name", "") or plugin_name),
        "plugin_identifier": str(getattr(plugin, "identifier", "") or ""),
        "plugin_version": str(getattr(plugin, "version", "") or ""),
        "manufacturer": str(getattr(plugin, "manufacturer_name", "") or ""),
    }
    output_path.write_text(json.dumps(result, ensure_ascii=False), encoding="utf-8")


def main() -> int:
    if len(sys.argv) != 3:
        print("Usage: vst3_editor_process.py INPUT_JSON OUTPUT_JSON", file=sys.stderr)
        return 2
    output_path = Path(sys.argv[2])
    try:
        run(Path(sys.argv[1]), output_path)
        return 0
    except Exception as exc:
        try:
            output_path.write_text(
                json.dumps({"ok": False, "error": f"{type(exc).__name__}: {exc}"}, ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            pass
        print(f"{type(exc).__name__}: {exc}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
