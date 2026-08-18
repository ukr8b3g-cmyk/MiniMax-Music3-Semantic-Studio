from __future__ import annotations

import asyncio
import json
import os
import sys
import tempfile
from pathlib import Path
from typing import Any

try:
    from .vst3_host import host_status
    from .vst3_scan import scan_vst3_plugins
except ImportError:  # Pure-module tests.
    from vst3_host import host_status
    from vst3_scan import scan_vst3_plugins

MAX_STATE_TEXT = 48 * 1024 * 1024
_EDITOR_LOCK = asyncio.Lock()


class Vst3EditorBusy(RuntimeError):
    pass


class Vst3EditorRequestError(ValueError):
    pass


def _canonical(path: str) -> str:
    try:
        return os.path.normcase(str(Path(path).resolve()))
    except OSError:
        return os.path.normcase(str(Path(path)))


def _validated_payload(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise Vst3EditorRequestError("VST3 editor request must be a JSON object.")
    path = str(payload.get("path") or "").strip()
    plugin_name = str(payload.get("plugin_name") or "").strip()
    if not path or Path(path).suffix.lower() != ".vst3":
        raise Vst3EditorRequestError("A valid .vst3 plugin path is required.")
    state_b64 = str(payload.get("state_b64") or "")
    if len(state_b64) > MAX_STATE_TEXT:
        raise Vst3EditorRequestError("Stored VST3 state is too large to open safely.")

    detected = scan_vst3_plugins()
    allowed = {_canonical(str(item.get("path") or "")) for item in detected.get("plugins", [])}
    if _canonical(path) not in allowed:
        raise Vst3EditorRequestError("The requested VST3 path is not in the current installed-plugin scan.")

    return {
        "path": path,
        "plugin_name": plugin_name,
        "state_kind": str(payload.get("state_kind") or "preset_data"),
        "state_b64": state_b64,
        "plugin_identifier": str(payload.get("plugin_identifier") or ""),
    }


async def open_native_editor(payload: Any) -> dict[str, Any]:
    status = host_status()
    if not status.get("ready"):
        raise Vst3EditorRequestError(str(status.get("message") or "VST3 host is unavailable."))
    if os.name != "nt":
        raise Vst3EditorRequestError("Native VST3 editor windows are currently enabled for Windows only.")
    if _EDITOR_LOCK.locked():
        raise Vst3EditorBusy("Another VST3 plugin editor is already open.")

    request = _validated_payload(payload)
    script = Path(__file__).with_name("vst3_editor_process.py")
    if not script.is_file():
        raise RuntimeError("VST3 editor helper process is missing from the custom node installation.")

    async with _EDITOR_LOCK:
        with tempfile.TemporaryDirectory(prefix="m3ss-vst3-ui-") as directory:
            folder = Path(directory)
            input_path = folder / "input.json"
            output_path = folder / "output.json"
            input_path.write_text(json.dumps(request, ensure_ascii=False), encoding="utf-8")

            process = await asyncio.create_subprocess_exec(
                sys.executable,
                str(script),
                str(input_path),
                str(output_path),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            stdout, stderr = await process.communicate()
            result: dict[str, Any] | None = None
            try:
                if output_path.is_file():
                    parsed = json.loads(output_path.read_text(encoding="utf-8"))
                    if isinstance(parsed, dict):
                        result = parsed
            except (OSError, UnicodeError, json.JSONDecodeError):
                result = None

            if process.returncode != 0 or not result or not result.get("ok"):
                detail = ""
                if result and result.get("error"):
                    detail = str(result["error"])
                elif stderr:
                    detail = stderr.decode("utf-8", errors="replace").strip()
                elif stdout:
                    detail = stdout.decode("utf-8", errors="replace").strip()
                detail = detail[-4000:] if detail else f"helper exited with code {process.returncode}"
                raise RuntimeError(f"Native VST3 editor failed: {detail}")

            state_b64 = str(result.get("state_b64") or "")
            if len(state_b64) > MAX_STATE_TEXT:
                raise RuntimeError("Native VST3 editor returned state that exceeds the safety limit.")
            return result
