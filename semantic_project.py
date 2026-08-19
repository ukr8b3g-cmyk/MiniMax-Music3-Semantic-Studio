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

SECTION_ALIASES = {
    "intro": "Intro",
    "opening": "Intro",
    "verse": "Verse",
    "pre-chorus": "Pre-Chorus",
    "prechorus": "Pre-Chorus",
    "chorus": "Chorus",
    "hook": "Chorus",
    "refrain": "Chorus",
    "post-chorus": "Post-Chorus",
    "postchorus": "Post-Chorus",
    "bridge": "Bridge",
    "break": "Instrumental",
    "breakdown": "Instrumental",
    "instrumental": "Instrumental",
    "instrumental break": "Instrumental",
    "solo": "Solo",
    "guitar solo": "Solo",
    "piano solo": "Solo",
    "outro": "Outro",
    "ending": "Outro",
}

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


def _minimal_section() -> dict[str, Any]:
    return {
        "id": "section-1",
        "type": "Instrumental",
        "label": "Instrumental",
        "duration": 16.0,
        "energy": 0.5,
        "lyrics": "",
        "instruments": [],
        "vocal": "",
        "directives": "",
    }


def _minimal_project() -> dict[str, Any]:
    project = deepcopy(DEFAULT_PROJECT)
    project["global"].update(
        {
            "title": "",
            "genre": "",
            "subgenres": [],
            "key": "",
            "scale": "",
            "mood": "",
            "production": "",
            "vocal": {
                "mode": "instrumental",
                "gender": "",
                "timbre": "",
                "delivery": "",
                "harmony": "",
                "effects": "",
            },
        }
    )
    project["timeline"]["sections"] = [_minimal_section()]
    return project


def _merge_defaults(project: dict[str, Any]) -> dict[str, Any]:
    """Fill fields needed by the compiler while preserving unknown future fields."""
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


def _normalize_section_type(value: Any) -> str:
    text = _as_text(value)
    if text in SECTION_TYPES:
        return text
    lowered = text.casefold().replace("_", "-").strip()
    lowered = re.sub(r"\s+", " ", lowered)
    lowered = re.sub(r"\s*(?:#?\d+|\d+(?:st|nd|rd|th))\s*$", "", lowered).strip()
    if lowered.startswith("final chorus"):
        return "Chorus"
    if lowered in SECTION_ALIASES:
        return SECTION_ALIASES[lowered]
    for alias, section_type in SECTION_ALIASES.items():
        if lowered.startswith(alias + " "):
            return section_type
    return "Instrumental"


def _load_project(project_json: str | dict[str, Any], warnings: list[str] | None = None) -> dict[str, Any]:
    def warn(message: str) -> None:
        if warnings is not None:
            warnings.append(message)

    if isinstance(project_json, dict):
        raw: Any = deepcopy(project_json)
    elif not isinstance(project_json, str) or not project_json.strip():
        raw = _minimal_project()
        warn("Empty project state was replaced with a minimal instrumental project.")
    else:
        try:
            raw = json.loads(project_json)
        except Exception:
            raw = _minimal_project()
            warn("Invalid project JSON was ignored for this run and a minimal project was used.")

    if not isinstance(raw, dict):
        raw = _minimal_project()
        warn("Non-object project state was ignored for this run and a minimal project was used.")

    version = raw.get("schema_version", SCHEMA_VERSION)
    if version != SCHEMA_VERSION:
        reserved = raw.get("reserved") if isinstance(raw.get("reserved"), dict) else {}
        reserved = deepcopy(reserved)
        reserved.setdefault("source_schema_version", version)
        raw["reserved"] = reserved
        warn(f"Unknown schema_version={version!r} was interpreted using schema {SCHEMA_VERSION} fields where possible.")
    raw["schema_version"] = SCHEMA_VERSION

    project = _merge_defaults(raw)
    timeline = project["timeline"]
    sections = timeline.get("sections")
    if not isinstance(sections, list):
        sections = []
        warn("timeline.sections was not an array and was replaced with a minimal section.")
    if len(sections) > MAX_SECTIONS:
        warn(f"Only the first {MAX_SECTIONS} timeline sections were used.")
        sections = sections[:MAX_SECTIONS]

    normalized_sections: list[dict[str, Any]] = []
    for index, section in enumerate(sections):
        if not isinstance(section, dict):
            warn(f"timeline.sections[{index}] was not an object and was skipped.")
            continue

        original_type = _as_text(section.get("type"))
        section_type = _normalize_section_type(original_type or "Instrumental")
        if original_type and section_type != original_type:
            warn(f"timeline.sections[{index}].type={original_type!r} was interpreted as {section_type!r}.")

        duration = _clamp(_as_float(section.get("duration"), 16.0), 0.5, 360.0)
        energy = _clamp(_as_float(section.get("energy"), 0.5), 0.0, 1.0)
        label = _as_text(section.get("label")) or original_type or section_type
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

    if not normalized_sections:
        normalized_sections = [_minimal_section()]
        warn("No usable timeline sections were present, so a minimal Instrumental section was used.")
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


def load_project(project_json: str | dict[str, Any]) -> dict[str, Any]:
    return _load_project(project_json)


def project_duration(project: dict[str, Any]) -> float:
    sections = project.get("timeline", {}).get("sections", [])
    return round(sum(_as_float(section.get("duration"), 0.0) for section in sections if isinstance(section, dict)), 2)


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
    return "; then ".join(f"{section['label']} {_energy_phrase(section['energy'])}" for section in sections)


def _canonical_lyric_tag(section_type: str) -> str:
    return section_type if section_type in SECTION_TYPES else "Instrumental"


def _strip_leading_section_tags(lyrics: str) -> str:
    lines = lyrics.splitlines()
    while lines and re.fullmatch(r"\s*\[[^\]]+\]\s*", lines[0]):
        lines.pop(0)
    return "\n".join(lines).strip()


def compile_project(project_json: str | dict[str, Any]) -> CompiledProject:
    warnings: list[str] = []
    project = _load_project(project_json, warnings)
    global_data = project["global"]
    vocal = global_data["vocal"]
    sections = project["timeline"]["sections"]

    metadata_parts: list[str] = []
    if global_data["genre"]:
        genre = global_data["genre"]
        if global_data["subgenres"]:
            genre += f" with {', '.join(global_data['subgenres'])} influences"
        metadata_parts.append(f"Genre: {genre}.")
    if global_data["bpm"]:
        metadata_parts.append(f"Tempo target: approximately {global_data['bpm']} BPM in {global_data['meter']} meter.")
    if global_data["key"]:
        key_text = global_data["key"]
        if global_data["scale"]:
            key_text += f" {global_data['scale']}"
        metadata_parts.append(f"Key/scale target: {key_text}.")
    if global_data["mood"]:
        metadata_parts.append(f"Mood and emotional direction: {global_data['mood']}.")
    if sections:
        metadata_parts.append(f"Energy progression: {_energy_arc(sections)}.")
    if global_data["production"]:
        metadata_parts.append(f"Production profile: {global_data['production']}.")

    if vocal["mode"].casefold() == "instrumental":
        vocal_text = "Instrumental piece with no lead or backing vocals. Let the instrumental arrangement carry the melodic focus."
    else:
        vocal_parts: list[str] = [f"Lead vocal: {vocal['gender']}" if vocal["gender"] else "Lead vocal: present"]
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

    caption_blocks: list[str] = []
    if metadata_parts:
        caption_blocks.append("### Global Metadata\n" + " ".join(metadata_parts))
    if vocal_text:
        caption_blocks.append("### Vocal Details\n" + vocal_text)
    if arrangement_lines:
        caption_blocks.append("### Arrangement\n" + "\n".join(arrangement_lines))
    caption = "\n\n".join(caption_blocks)

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
