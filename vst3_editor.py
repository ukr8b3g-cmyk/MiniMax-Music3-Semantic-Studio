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
_ACTIVE_PROCESS: asyncio.subprocess.Process | None = None


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


async def close_native_editor() -> dict[str, Any]:
    """Ask the active helper to close its native plugin window.

    Pedalboard's ``show_editor(close_event)`` checks a threading.Event. The
    helper owns that Event, so the server sends a small command over stdin.
    If a plugin refuses to close after the event is set, terminate only the
    isolated helper process so ComfyUI itself stays alive.
    """

    process = _ACTIVE_PROCESS
    if process is None or process.returncode is not None:
        raise Vst3EditorRequestError("No native VST3 plugin editor is currently open.")
    if process.stdin is None:
        raise RuntimeError("Native VST3 editor control channel is unavailable.")

    try:
        process.stdin.write(b"close\n")
        await process.stdin.drain()
    except (BrokenPipeError, ConnectionResetError) as exc:
        raise RuntimeError("Native VST3 editor control channel closed unexpectedly.") from exc

    forced = False
    try:
        await asyncio.wait_for(asyncio.shield(process.wait()), timeout=3.0)
    except asyncio.TimeoutError:
        forced = True
        process.terminate()
        try:
            await asyncio.wait_for(asyncio.shield(process.wait()), timeout=2.0)
        except asyncio.TimeoutError:
            process.kill()
            await process.wait()

    return {
        "ok": True,
        "closing": True,
        "forced": forced,
        "message": (
            "Native VST3 helper was force-closed; the latest plugin state may not have been captured."
            if forced
            else "Native VST3 editor close requested; plugin state is being captured."
        ),
    }


async def open_native_editor(payload: Any) -> dict[str, Any]:
    global _ACTIVE_PROCESS

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
                stdin=asyncio.subprocess.PIPE,
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _ACTIVE_PROCESS = process
            try:
                stdout_task = asyncio.create_task(process.stdout.read()) if process.stdout else None
                stderr_task = asyncio.create_task(process.stderr.read()) if process.stderr else None
                await process.wait()
                stdout = await stdout_task if stdout_task else b""
                stderr = await stderr_task if stderr_task else b""
            finally:
                if _ACTIVE_PROCESS is process:
                    _ACTIVE_PROCESS = None
                if process.stdin is not None:
                    process.stdin.close()

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
