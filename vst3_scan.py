from __future__ import annotations

import json
import os
import re
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


def _subcategory_values(value: Any) -> list[str]:
    if isinstance(value, str):
        return [item.strip() for item in value.replace("|", ",").split(",") if item.strip()]
    if isinstance(value, list):
        return [str(item).strip() for item in value if str(item).strip()]
    return []


def _release_category(name: str, subcategories: Iterable[str]) -> str:
    values = " ".join(str(item) for item in subcategories).lower()
    text = f"{name} {values}".lower()
    if re.search(r"compress|limiter|gate|de[- ]?ess|dynamics|master", text):
        return "Dynamics"
    if re.search(r"chorus|flanger|phaser|modulat", text):
        return "Modulation"
    if re.search(r"delay|echo|reverb|room|space", text):
        return "Space"
    if re.search(r"pitch|harmoni|tune", text):
        return "Pitch"
    if re.search(r"\beq\b|equaliz|filter", text):
        return "EQ / Filter"
    if re.search(r"distort|saturat|drive|amp", text):
        return "Color"
    return "Other"


def _plugin_metadata(bundle: Path) -> dict[str, str]:
    name = bundle.stem
    vendor = ""
    kind = "unknown"
    categories: list[str] = []
    info = _read_moduleinfo(bundle)
    if not info:
        return {"name": name, "vendor": vendor, "kind": kind, "category": _release_category(name, [])}

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
            subs = _subcategory_values(item.get("Sub Categories"))
            categories.extend(subs)
            values = {value.lower() for value in subs}
            if any("instrument" in value for value in values):
                kind = "instrument"
                break
            if any(value == "fx" or value.startswith("fx ") or "effect" in value for value in values):
                kind = "effect"

    return {
        "name": name,
        "vendor": vendor,
        "kind": kind,
        "category": _release_category(name, categories),
    }


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
                continue
            plugins.append({
                "name": metadata["name"],
                "vendor": metadata["vendor"],
                "kind": metadata["kind"],
                "category": metadata["category"],
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
