from __future__ import annotations

import json
import os
from pathlib import Path
from typing import Any, Iterable


def default_windows_vst3_paths() -> list[Path]:
    roots: list[Path] = []
    program_files = os.environ.get("ProgramFiles")
    if program_files:
        roots.append(Path(program_files) / "Common Files" / "VST3")
    fallback = Path(r"C:\Program Files\Common Files\VST3")
    if fallback not in roots:
        roots.append(fallback)
    return roots


def _read_moduleinfo(bundle: Path) -> dict[str, Any] | None:
    candidates = [
        bundle / "Contents" / "moduleinfo.json",
        bundle / "moduleinfo.json",
    ]
    for path in candidates:
        try:
            if path.is_file():
                data = json.loads(path.read_text(encoding="utf-8"))
                return data if isinstance(data, dict) else None
        except (OSError, UnicodeError, json.JSONDecodeError):
            continue
    return None


def _plugin_metadata(bundle: Path) -> dict[str, str]:
    name = bundle.stem
    vendor = ""
    kind = "unknown"
    info = _read_moduleinfo(bundle)
    if not info:
        return {"name": name, "vendor": vendor, "kind": kind}

    factory = info.get("Factory Info")
    if isinstance(factory, dict):
        vendor = str(factory.get("Vendor") or "").strip()

    classes = info.get("Classes")
    if isinstance(classes, list):
        for item in classes:
            if not isinstance(item, dict):
                continue
            class_name = str(item.get("Name") or "").strip()
            if class_name:
                name = class_name
            subs = item.get("Sub Categories")
            if isinstance(subs, str):
                values = {x.strip().lower() for x in subs.replace("|", ",").split(",") if x.strip()}
            elif isinstance(subs, list):
                values = {str(x).strip().lower() for x in subs if str(x).strip()}
            else:
                values = set()
            if any("instrument" in value for value in values):
                kind = "instrument"
                break
            if any(value == "fx" or value.startswith("fx ") or "effect" in value for value in values):
                kind = "effect"

    return {"name": name, "vendor": vendor, "kind": kind}


def _iter_vst3_entries(root: Path) -> Iterable[Path]:
    if not root.is_dir():
        return []
    entries: list[Path] = []
    try:
        for current, dirs, files in os.walk(root):
            base = Path(current)
            vst3_dirs = [name for name in dirs if Path(name).suffix.lower() == ".vst3"]
            for name in vst3_dirs:
                entries.append(base / name)
            # A .vst3 directory is a complete bundle. Do not descend into it,
            # otherwise Contents/x86_64-win/<name>.vst3 can be double-counted.
            dirs[:] = [name for name in dirs if Path(name).suffix.lower() != ".vst3"]
            for name in files:
                if Path(name).suffix.lower() == ".vst3":
                    entries.append(base / name)
    except OSError:
        return []
    return entries


def scan_vst3_plugins(paths: Iterable[str | os.PathLike[str]] | None = None) -> dict[str, Any]:
    roots = [Path(path) for path in paths] if paths is not None else default_windows_vst3_paths()
    plugins: list[dict[str, Any]] = []
    seen: set[str] = set()

    for root in roots:
        for bundle in _iter_vst3_entries(root):
            try:
                key = str(bundle.resolve()).lower()
            except OSError:
                key = str(bundle).lower()
            if key in seen:
                continue
            seen.add(key)
            metadata = _plugin_metadata(bundle)
            if metadata["kind"] == "instrument":
                # Phase 1 intentionally exposes effects/candidates only.
                continue
            plugins.append({
                "name": metadata["name"],
                "vendor": metadata["vendor"],
                "kind": metadata["kind"],
                "path": str(bundle),
                "status": "detected",
                "validated": False,
            })

    plugins.sort(key=lambda item: (str(item["name"]).lower(), str(item["path"]).lower()))
    return {
        "platform": os.name,
        "phase": 1,
        "roots": [str(path) for path in roots],
        "count": len(plugins),
        "plugins": plugins,
    }
