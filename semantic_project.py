from __future__ import annotations

import json
import math
import re
from copy import deepcopy
from dataclasses import dataclass
from typing import Any

SCHEMA_VERSION = 1
MAX_SECTIONS = 32

SECTION_TYPES = (
    "Intro",
    "Verse",
    "Pre-Chorus",
    "Chorus",
    "Post-Chorus",
    "Bridge",
    "Instrumental",
    "Solo",
    "Outro",
)

DEFAULT_PROJECT: dict[str, Any] = {
    "schema_version": SCHEMA_VERSION,
    "project_id": "",
    "global": {
        "title": "",
        "genre": "Pop",
        "subgenres": [],
        "bpm": 120,
        "key": "",
        "scale": "",
        "meter": "4/4",
        "mood": "",
        "production": "",
        "vocal": {
            "mode": "vocal",
            "gender": "",
            "timbre": "",
            "delivery": "",
            "harmony": "",
            "effects": "",
        },
    },
    "timeline": {
        "sections": [
            {
                "id": "intro-1",
                "type": "Intro",
                "label": "Intro",
                "duration": 8.0,
                "energy": 0.20,
                "lyrics": "",
                "instruments": ["piano", "pad"],
                "vocal": "instrumental",
                "directives": "Sparse opening; establish the main tone without a full groove.",
            },
            {
                "id": "verse-1",
                "type": "Verse",
                "label": "Verse 1",
                "duration": 24.0,
                "energy": 0.38,
                "lyrics": "",
                "instruments": ["piano", "bass", "light drums"],
                "vocal": "soft",
                "directives": "Keep the arrangement restrained and leave space for the lead vocal.",
            },
            {
                "id": "chorus-1",
                "type": "Chorus",
                "label": "Chorus 1",
                "duration": 24.0,
                "energy": 0.82,
                "lyrics": "",
                "instruments": ["full drums", "bass", "guitar", "piano", "pad"],
                "vocal": "power",
                "directives": "Open into a wider, fuller arrangement with a clear melodic lift.",
            },
            {
                "id": "verse-2",
                "type": "Verse",
                "label": "Verse 2",
                "duration": 24.0,
                "energy": 0.48,
                "lyrics": "",
                "instruments": ["piano", "bass", "drums", "guitar"],
                "vocal": "soft",
                "directives": "Retain momentum from the chorus while returning to a lighter texture.",
            },
            {
                "id": "chorus-2",
                "type": "Chorus",
                "label": "Chorus 2",
                "duration": 24.0,
                "energy": 0.88,
                "lyrics": "",
                "instruments": ["full drums", "bass", "guitar", "piano", "pad"],
                "vocal": "power",
                "directives": "Repeat the chorus identity with slightly more density and backing support.",
            },
            {
                "id": "bridge-1",
                "type": "Bridge",
                "label": "Bridge",
                "duration": 16.0,
                "energy": 0.45,
                "lyrics": "",
                "instruments": ["piano", "strings", "pad"],
                "vocal": "intimate",
                "directives": "Pull back the groove and create contrast before the final lift.",
            },
            {
                "id": "chorus-3",
                "type": "Chorus",
                "label": "Final Chorus",
                "duration": 28.0,
                "energy": 1.00,
                "lyrics": "",
                "instruments": ["full drums", "bass", "guitar", "piano", "strings", "pad"],
                "vocal": "power",
                "directives": "Peak arrangement density and emotional intensity; broaden the stereo image.",
            },
            {
                "id": "outro-1",
                "type": "Outro",
                "label": "Outro",
                "duration": 12.0,
                "energy": 0.30,
                "lyrics": "",
                "instruments": ["piano", "pad"],
                "vocal": "fade",
                "directives": "Release the energy and finish with a clean, natural decay.",
            },
        ]
    },
    # Reserved namespaces. V1 does not execute these fields, but preserving them now
    # lets V2/V3 evolve the project format without replacing the editor model.
    "audio_edits": [],
    "takes": [],
    "conditioning_tracks": [],
}

DEFAULT_PROJECT_JSON = json.dumps(DEFAULT_PROJECT, ensure_ascii=False, separators=(",", ":"))


@dataclass(frozen=True)
class CompiledProject:
    caption: str
    lyrics: str
    target_duration: float
    warnings: tuple[str, ...]


def _as_text(value: Any) -> str:
    if value is None:
        return ""
    return str(value).strip()


def _as_float(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _normalize_string_list(value: Any) -> list[str]:
    if isinstance(value, str):
        value = value.split(",")
    if not isinstance(value, list):
        return []
    result: list[str] = []
    seen: set[str] = set()
    for item in value:
        text = _as_text(item)
        key = text.casefold()
        if text and key not in seen:
            result.append(text)
            seen.add(key)
    return result


def _merge_defaults(project: dict[str, Any]) -> dict[str, Any]:
    """Fill V1-required fields while preserving unknown future fields."""
    result = deepcopy(project)
    defaults = deepcopy(DEFAULT_PROJECT)

    result.setdefault("project_id", defaults["project_id"])

    global_data = result.setdefault("global", {})
    if not isinstance(global_data, dict):
        global_data = result["global"] = {}
    for key, value in defaults["global"].items():
        if key == "vocal":
            continue
        global_data.setdefault(key, deepcopy(value))

    vocal = global_data.setdefault("vocal", {})
    if not isinstance(vocal, dict):
        vocal = global_data["vocal"] = {}
    for key, value in defaults["global"]["vocal"].items():
        vocal.setdefault(key, deepcopy(value))

    timeline = result.setdefault("timeline", {})
    if not isinstance(timeline, dict):
        timeline = result["timeline"] = {}
    timeline.setdefault("sections", [])

    result.setdefault("audio_edits", [])
    result.setdefault("takes", [])
    result.setdefault("conditioning_tracks", [])
    return result


def load_project(project_json: str | dict[str, Any]) -> dict[str, Any]:
    if isinstance(project_json, dict):
        raw = deepcopy(project_json)
    else:
        if not isinstance(project_json, str) or not project_json.strip():
            raw = deepcopy(DEFAULT_PROJECT)
        else:
            try:
                raw = json.loads(project_json)
            except json.JSONDecodeError as exc:
                raise ValueError(f"Semantic Studio project JSON is invalid: {exc.msg} at line {exc.lineno} column {exc.colno}") from exc

    if not isinstance(raw, dict):
        raise ValueError("Semantic Studio project JSON must contain a JSON object at the top level.")

    version = raw.get("schema_version", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported Semantic Studio schema_version={version!r}; this build supports schema_version={SCHEMA_VERSION}."
        )

    raw["schema_version"] = SCHEMA_VERSION
    project = _merge_defaults(raw)

    timeline = project["timeline"]
    sections = timeline.get("sections")
    if not isinstance(sections, list):
        raise ValueError("timeline.sections must be a JSON array.")
    if not sections:
        raise ValueError("Semantic Studio requires at least one timeline section.")
    if len(sections) > MAX_SECTIONS:
        raise ValueError(f"Semantic Studio supports at most {MAX_SECTIONS} sections in V1.")

    normalized_sections: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            raise ValueError(f"timeline.sections[{index}] must be a JSON object.")

        section_type = _as_text(section.get("type")) or "Verse"
        if section_type not in SECTION_TYPES:
            raise ValueError(
                f"timeline.sections[{index}].type={section_type!r} is unsupported. "
                f"Expected one of: {', '.join(SECTION_TYPES)}"
            )

        duration = _clamp(_as_float(section.get("duration"), 16.0), 0.5, 360.0)
        energy = _clamp(_as_float(section.get("energy"), 0.5), 0.0, 1.0)
        label = _as_text(section.get("label")) or section_type
        section_id = _as_text(section.get("id")) or f"section-{index + 1}"

        normalized = deepcopy(section)
        normalized.update(
            {
                "id": section_id,
                "type": section_type,
                "label": label,
                "duration": duration,
                "energy": energy,
                "lyrics": _as_text(section.get("lyrics")),
                "instruments": _normalize_string_list(section.get("instruments")),
                "vocal": _as_text(section.get("vocal")),
                "directives": _as_text(section.get("directives")),
            }
        )
        normalized_sections.append(normalized)

    timeline["sections"] = normalized_sections

    global_data = project["global"]
    global_data["title"] = _as_text(global_data.get("title"))
    global_data["genre"] = _as_text(global_data.get("genre"))
    global_data["subgenres"] = _normalize_string_list(global_data.get("subgenres"))
    global_data["bpm"] = int(round(_clamp(_as_float(global_data.get("bpm"), 120.0), 20.0, 400.0)))
    global_data["key"] = _as_text(global_data.get("key"))
    global_data["scale"] = _as_text(global_data.get("scale"))
    global_data["meter"] = _as_text(global_data.get("meter")) or "4/4"
    global_data["mood"] = _as_text(global_data.get("mood"))
    global_data["production"] = _as_text(global_data.get("production"))

    vocal = global_data["vocal"]
    for key in ("mode", "gender", "timbre", "delivery", "harmony", "effects"):
        vocal[key] = _as_text(vocal.get(key))
    vocal["mode"] = vocal["mode"] or "vocal"

    return project


def project_duration(project: dict[str, Any]) -> float:
    sections = project.get("timeline", {}).get("sections", [])
    return round(sum(_as_float(section.get("duration"), 0.0) for section in sections), 2)


def _format_time(seconds: float) -> str:
    whole = max(0, int(round(seconds)))
    minutes, secs = divmod(whole, 60)
    return f"{minutes}:{secs:02d}"


def _energy_phrase(energy: float) -> str:
    if energy < 0.18:
        return "very sparse and restrained"
    if energy < 0.38:
        return "low-density and restrained"
    if energy < 0.62:
        return "moderate and controlled"
    if energy < 0.82:
        return "full and energetic"
    if energy < 0.96:
        return "high-intensity and expansive"
    return "peak intensity and maximum arrangement density"


def _energy_arc(sections: list[dict[str, Any]]) -> str:
    if not sections:
        return ""
    compact = []
    for section in sections:
        compact.append(f"{section['label']} {_energy_phrase(section['energy'])}")
    return "; then ".join(compact)


def _canonical_lyric_tag(section_type: str) -> str:
    return {
        "Intro": "Intro",
        "Verse": "Verse",
        "Pre-Chorus": "Pre-Chorus",
        "Chorus": "Chorus",
        "Post-Chorus": "Post-Chorus",
        "Bridge": "Bridge",
        "Instrumental": "Instrumental",
        "Solo": "Solo",
        "Outro": "Outro",
    }.get(section_type, section_type)


def _strip_leading_section_tags(lyrics: str) -> str:
    lines = lyrics.splitlines()
    while lines and re.fullmatch(r"\s*\[[^\]]+\]\s*", lines[0]):
        lines.pop(0)
    return "\n".join(lines).strip()


def compile_project(project_json: str | dict[str, Any]) -> CompiledProject:
    project = load_project(project_json)
    global_data = project["global"]
    vocal = global_data["vocal"]
    sections = project["timeline"]["sections"]
    warnings: list[str] = []

    metadata_parts: list[str] = []
    if global_data["genre"]:
        genre = global_data["genre"]
        if global_data["subgenres"]:
            genre += f" with {', '.join(global_data['subgenres'])} influences"
        metadata_parts.append(f"Genre: {genre}.")
    metadata_parts.append(f"Tempo target: approximately {global_data['bpm']} BPM in {global_data['meter']} meter.")
    if global_data["key"]:
        key_text = global_data["key"]
        if global_data["scale"]:
            key_text += f" {global_data['scale']}"
        metadata_parts.append(f"Key/scale target: {key_text}.")
    if global_data["mood"]:
        metadata_parts.append(f"Mood and emotional direction: {global_data['mood']}.")
    metadata_parts.append(f"Energy progression: {_energy_arc(sections)}.")
    if global_data["production"]:
        metadata_parts.append(f"Production profile: {global_data['production']}.")

    if vocal["mode"].casefold() == "instrumental":
        vocal_text = "Instrumental piece with no lead or backing vocals. Let the instrumental arrangement carry the melodic focus."
    else:
        vocal_parts: list[str] = []
        if vocal["gender"]:
            vocal_parts.append(f"Lead vocal: {vocal['gender']}")
        else:
            vocal_parts.append("Lead vocal: present")
        if vocal["timbre"]:
            vocal_parts.append(f"timbre {vocal['timbre']}")
        if vocal["delivery"]:
            vocal_parts.append(f"delivery {vocal['delivery']}")
        vocal_text = "; ".join(vocal_parts) + "."
        if vocal["harmony"]:
            vocal_text += f" Harmony/backing vocals: {vocal['harmony']}."
        if vocal["effects"]:
            vocal_text += f" Vocal effects: {vocal['effects']}."

    arrangement_lines: list[str] = []
    cursor = 0.0
    for section in sections:
        end = cursor + section["duration"]
        instruments = ", ".join(section["instruments"]) if section["instruments"] else "arrangement appropriate to the established palette"
        sentence = (
            f"{section['label']} ({_format_time(cursor)}–{_format_time(end)} target, {_energy_phrase(section['energy'])}): "
            f"Use {instruments}."
        )
        if section["vocal"]:
            sentence += f" Vocal treatment: {section['vocal']}."
        if section["directives"]:
            sentence += f" {section['directives'].rstrip('.')} ."
            sentence = sentence.replace(" .", ".")
        arrangement_lines.append(sentence)
        cursor = end

    caption = "\n\n".join(
        (
            "### Global Metadata\n" + " ".join(metadata_parts),
            "### Vocal Details\n" + vocal_text,
            "### Arrangement\n" + "\n".join(arrangement_lines),
        )
    )

    lyric_blocks: list[str] = []
    instrumental_global = vocal["mode"].casefold() == "instrumental"
    for section in sections:
        tag = _canonical_lyric_tag(section["type"])
        lyric_blocks.append(f"[{tag}]")
        text = _strip_leading_section_tags(section["lyrics"])
        if text and not instrumental_global:
            lyric_blocks.append(text)
        elif text and instrumental_global:
            warnings.append(f"Lyrics in {section['label']} were ignored because global vocal mode is instrumental.")

    target_duration = project_duration(project)
    if target_duration > 300.0:
        warnings.append(
            "The semantic timeline exceeds five minutes. MiniMax Music 3 section timing is advisory and long-form limits depend on the active ComfyUI implementation."
        )

    return CompiledProject(
        caption=caption.strip(),
        lyrics="\n".join(lyric_blocks).strip(),
        target_duration=target_duration,
        warnings=tuple(warnings),
    )
