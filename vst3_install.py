from __future__ import annotations

import os
import subprocess
import sys
import threading
from typing import Any, Callable

PEDALBOARD_SPEC = "pedalboard>=0.9.24,<1"
_INSTALL_TIMEOUT_SECONDS = 300
_INSTALL_LOCK = threading.Lock()


def optional_host_status(status: dict[str, Any]) -> dict[str, Any]:
    """Add UI install capability without changing the low-level host probe."""
    result = dict(status or {})
    install_available = result.get("platform") == "nt" and not bool(result.get("ready"))
    result["install_available"] = install_available
    if install_available:
        result["message"] = (
            "VST3 Host is optional and is not installed. Click Install VST3 Host to install "
            "Pedalboard into the same Python environment that is running ComfyUI."
        )
    return result


def install_command(executable: str | None = None) -> list[str]:
    """Return the fixed, non-shell pip command used by the UI installer."""
    return [
        executable or sys.executable,
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--only-binary=:all:",
        PEDALBOARD_SPEC,
    ]


def _tail(text: str, limit: int = 4000) -> str:
    value = str(text or "").strip()
    return value[-limit:]


def install_vst3_host(
    *,
    runner: Callable[..., Any] = subprocess.run,
    executable: str | None = None,
    platform_name: str | None = None,
) -> dict[str, Any]:
    """Install the optional Pedalboard VST3 host into the running ComfyUI Python.

    This function intentionally accepts no package name or arbitrary command from
    the caller. The only installable target is ``PEDALBOARD_SPEC`` and the process
    is always started without a shell.
    """
    platform_name = os.name if platform_name is None else str(platform_name)
    if platform_name != "nt":
        return {
            "ok": False,
            "busy": False,
            "message": "VST3 host installation is available on Windows only.",
        }

    if not _INSTALL_LOCK.acquire(blocking=False):
        return {
            "ok": False,
            "busy": True,
            "message": "VST3 host installation is already running.",
        }

    try:
        command = install_command(executable)
        try:
            completed = runner(
                command,
                capture_output=True,
                text=True,
                timeout=_INSTALL_TIMEOUT_SECONDS,
                check=False,
                shell=False,
            )
        except Exception as exc:
            return {
                "ok": False,
                "busy": False,
                "message": f"Could not start VST3 host installation: {type(exc).__name__}: {exc}",
            }

        return_code = int(getattr(completed, "returncode", 1))
        stdout = _tail(getattr(completed, "stdout", ""))
        stderr = _tail(getattr(completed, "stderr", ""))
        if return_code != 0:
            detail = stderr or stdout or f"pip exited with code {return_code}"
            return {
                "ok": False,
                "busy": False,
                "returncode": return_code,
                "message": f"VST3 host installation failed: {detail}",
            }

        return {
            "ok": True,
            "busy": False,
            "returncode": 0,
            "message": "VST3 host installed into the current ComfyUI Python environment.",
        }
    finally:
        _INSTALL_LOCK.release()
