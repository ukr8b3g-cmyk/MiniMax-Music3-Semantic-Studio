from __future__ import annotations

import sys
from typing import Any

PEDALBOARD_SPEC = "pedalboard>=0.9.24,<1"


def optional_host_status(status: dict[str, Any]) -> dict[str, Any]:
    """Add local manual-setup guidance without exposing an install endpoint."""
    result = dict(status or {})
    manual_install_required = result.get("platform") == "nt" and not bool(result.get("ready"))
    result["install_available"] = False
    result["manual_install_required"] = manual_install_required
    result["manual_install_command"] = install_command() if manual_install_required else []
    if manual_install_required:
        result["message"] = (
            "VST3 Host is optional and is not installed. Copy the command below, run it in a "
            "local PowerShell terminal, then restart ComfyUI."
        )
    return result


def install_command(executable: str | None = None) -> list[str]:
    """Return the fixed command displayed for manual local installation."""
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
