from __future__ import annotations

import json
import math
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Iterable

EDIT_SCHEMA_VERSION = 1
MAX_TAKES = 4
MAX_TRACKS = 16
MAX_CLIPS = 512
MAX_ENVELOPE_POINTS = 128

TAKE_INPUTS = ("audio", "take_2", "take_3", "take_4")
CHANNEL_MODES = ("preserve", "mono", "stereo", "left_only", "right_only", "swap_lr")
FADE_CURVES = ("linear", "equal_power")

DEFAULT_EDIT_PROJECT: dict[str, Any] = {
    "edit_schema_version": EDIT_SCHEMA_VERSION,
    "project_id": "",
    "view": {
        "zoom": 1.0,
        "scroll_seconds": 0.0,
    },
    "takes": [],
    "tracks": [
        {
            "id": "main",
            "name": "Main Comp",
            "clips": [],
        }
    ],
    "master": {
        "gain_db": 0.0,
        "channel_mode": "preserve",
        "normalize": {
            "enabled": False,
            "target_peak_dbfs": -1.0,
        },
    },
    "reserved": {},
}

DEFAULT_EDIT_JSON = json.dumps(DEFAULT_EDIT_PROJECT, ensure_ascii=False, separators=(",", ":"))


@dataclass(frozen=True)
class SourceInfo:
    id: str
    input_name: str
    name: str
    sample_rate: int
    batch_size: int
    channels: int
    num_samples: int
    duration: float


def _text(value: Any) -> str:
    return "" if value is None else str(value).strip()


def _float(value: Any, default: float) -> float:
    try:
        result = float(value)
    except (TypeError, ValueError):
        return default
    return result if math.isfinite(result) else default


def _bool(value: Any, default: bool = False) -> bool:
    if isinstance(value, bool):
        return value
    if value is None:
        return default
    if isinstance(value, (int, float)):
        return bool(value)
    if isinstance(value, str):
        lowered = value.strip().casefold()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off", ""}:
            return False
    return default


def _clamp(value: float, minimum: float, maximum: float) -> float:
    return max(minimum, min(maximum, value))


def _unique_id(raw: Any, fallback: str, seen: set[str]) -> str:
    candidate = _text(raw) or fallback
    base = candidate
    suffix = 2
    while candidate in seen:
        candidate = f"{base}-{suffix}"
        suffix += 1
    seen.add(candidate)
    return candidate


def load_edit_project(edit_json: str | dict[str, Any] | None) -> dict[str, Any]:
    """Parse V2 edit state while preserving unknown fields.

    Source-aware normalization is intentionally handled by ``normalize_edit_project``.
    """

    if isinstance(edit_json, dict):
        raw = deepcopy(edit_json)
    elif edit_json is None or (isinstance(edit_json, str) and not edit_json.strip()):
        raw = deepcopy(DEFAULT_EDIT_PROJECT)
    elif isinstance(edit_json, str):
        try:
            raw = json.loads(edit_json)
        except json.JSONDecodeError as exc:
            raise ValueError(
                f"Semantic Studio audio edit JSON is invalid: {exc.msg} at line {exc.lineno} column {exc.colno}"
            ) from exc
    else:
        raise ValueError("Semantic Studio audio edit state must be a JSON object or JSON string.")

    if not isinstance(raw, dict):
        raise ValueError("Semantic Studio audio edit JSON must contain a JSON object at the top level.")

    version = raw.get("edit_schema_version", EDIT_SCHEMA_VERSION)
    if version != EDIT_SCHEMA_VERSION:
        raise ValueError(
            f"Unsupported audio edit_schema_version={version!r}; this build supports edit_schema_version={EDIT_SCHEMA_VERSION}."
        )
    raw["edit_schema_version"] = EDIT_SCHEMA_VERSION
    return raw


def _source_lookup(source_infos: Iterable[SourceInfo]) -> dict[str, SourceInfo]:
    lookup = {source.id: source for source in source_infos}
    if not lookup:
        raise ValueError("Music3 Semantic Studio Audio Editor requires at least the primary audio input.")
    if "take-1" not in lookup:
        raise ValueError("Primary audio source must be registered as take-1.")
    if len(lookup) > MAX_TAKES:
        raise ValueError(f"V2 supports at most {MAX_TAKES} connected takes.")
    return lookup


def _normalize_take_records(project: dict[str, Any], source_infos: list[SourceInfo]) -> list[dict[str, Any]]:
    existing = project.get("takes")
    existing_by_id: dict[str, dict[str, Any]] = {}
    if isinstance(existing, list):
        for item in existing:
            if isinstance(item, dict):
                key = _text(item.get("id"))
                if key:
                    existing_by_id[key] = deepcopy(item)

    takes: list[dict[str, Any]] = []
    for source in source_infos:
        item = existing_by_id.get(source.id, {})
        item.update(
            {
                "id": source.id,
                "input": source.input_name,
                "name": _text(item.get("name")) or source.name,
                "enabled": _bool(item.get("enabled"), True),
            }
        )
        takes.append(item)
    return takes


def _default_clip(source: SourceInfo) -> dict[str, Any]:
    return {
        "id": "clip-1",
        "source_id": source.id,
        "source_in": 0.0,
        "source_out": round(source.duration, 9),
        "timeline_start": 0.0,
        "gain_db": 0.0,
        "pan": 0.0,
        "muted": False,
        "reverse": False,
        "fade_in": {"duration": 0.0, "curve": "linear"},
        "fade_out": {"duration": 0.0, "curve": "linear"},
        "gain_envelope": [],
    }


def _normalize_fade(value: Any, clip_duration: float) -> dict[str, Any]:
    raw = deepcopy(value) if isinstance(value, dict) else {}
    duration = _clamp(_float(raw.get("duration"), 0.0), 0.0, max(0.0, clip_duration))
    curve = _text(raw.get("curve")) or "linear"
    if curve not in FADE_CURVES:
        curve = "linear"
    raw.update({"duration": duration, "curve": curve})
    return raw


def _normalize_envelope(value: Any, clip_duration: float) -> list[dict[str, float]]:
    if not isinstance(value, list):
        return []
    points: list[dict[str, float]] = []
    for item in value[:MAX_ENVELOPE_POINTS]:
        if not isinstance(item, dict):
            continue
        time = _clamp(_float(item.get("time"), 0.0), 0.0, max(0.0, clip_duration))
        gain_db = _clamp(_float(item.get("gain_db"), 0.0), -60.0, 24.0)
        points.append({"time": time, "gain_db": gain_db})
    # Last point at a duplicate time wins. This keeps interactive drag updates deterministic.
    deduped: dict[float, dict[str, float]] = {}
    for point in points:
        deduped[round(point["time"], 9)] = point
    return [deduped[key] for key in sorted(deduped)]


def _normalize_clip(
    clip: dict[str, Any],
    index: int,
    sources: dict[str, SourceInfo],
    seen_ids: set[str],
) -> dict[str, Any]:
    normalized = deepcopy(clip)
    clip_id = _unique_id(clip.get("id"), f"clip-{index + 1}", seen_ids)
    source_id = _text(clip.get("source_id")) or "take-1"
    source = sources.get(source_id)
    if source is None:
        raise ValueError(
            f"Clip {clip_id!r} references {source_id!r}, but that take is not connected to the V2 node."
        )

    source_in = _clamp(_float(clip.get("source_in"), 0.0), 0.0, source.duration)
    source_out = _clamp(_float(clip.get("source_out"), source.duration), 0.0, source.duration)
    if source_out <= source_in:
        raise ValueError(
            f"Clip {clip_id!r} has an empty source range ({source_in:.6f}s to {source_out:.6f}s)."
        )
    clip_duration = source_out - source_in

    normalized.update(
        {
            "id": clip_id,
            "source_id": source_id,
            "source_in": source_in,
            "source_out": source_out,
            "timeline_start": max(0.0, _float(clip.get("timeline_start"), 0.0)),
            "gain_db": _clamp(_float(clip.get("gain_db"), 0.0), -60.0, 24.0),
            "pan": _clamp(_float(clip.get("pan"), 0.0), -1.0, 1.0),
            "muted": _bool(clip.get("muted"), False),
            "reverse": _bool(clip.get("reverse"), False),
            "fade_in": _normalize_fade(clip.get("fade_in"), clip_duration),
            "fade_out": _normalize_fade(clip.get("fade_out"), clip_duration),
            "gain_envelope": _normalize_envelope(clip.get("gain_envelope"), clip_duration),
        }
    )
    return normalized


def normalize_edit_project(
    edit_json: str | dict[str, Any] | None,
    source_infos: Iterable[SourceInfo],
) -> dict[str, Any]:
    """Normalize an edit document against the currently connected source takes."""

    project = load_edit_project(edit_json)
    source_list = list(source_infos)
    sources = _source_lookup(source_list)

    project.setdefault("project_id", "")
    project["project_id"] = _text(project.get("project_id"))

    view = project.get("view")
    if not isinstance(view, dict):
        view = {}
    view = deepcopy(view)
    view.update(
        {
            "zoom": _clamp(_float(view.get("zoom"), 1.0), 0.05, 100.0),
            "scroll_seconds": max(0.0, _float(view.get("scroll_seconds"), 0.0)),
        }
    )
    project["view"] = view
    project["takes"] = _normalize_take_records(project, source_list)

    tracks_raw = project.get("tracks")
    if not isinstance(tracks_raw, list) or not tracks_raw:
        tracks_raw = deepcopy(DEFAULT_EDIT_PROJECT["tracks"])
    if len(tracks_raw) > MAX_TRACKS:
        raise ValueError(f"V2 supports at most {MAX_TRACKS} edit tracks.")

    tracks: list[dict[str, Any]] = []
    seen_track_ids: set[str] = set()
    total_clips = 0
    for track_index, track_raw in enumerate(tracks_raw):
        if not isinstance(track_raw, dict):
            raise ValueError(f"tracks[{track_index}] must be a JSON object.")
        track = deepcopy(track_raw)
        track_id = _unique_id(track.get("id"), f"track-{track_index + 1}", seen_track_ids)
        track["id"] = track_id
        track["name"] = _text(track.get("name")) or ("Main Comp" if track_index == 0 else f"Track {track_index + 1}")

        clips_raw = track.get("clips")
        if clips_raw is None:
            clips_raw = []
        if not isinstance(clips_raw, list):
            raise ValueError(f"Track {track_id!r} clips must be a JSON array.")

        if track_index == 0 and not clips_raw:
            clips_raw = [_default_clip(sources["take-1"])]

        seen_clip_ids: set[str] = set()
        clips: list[dict[str, Any]] = []
        for clip_index, clip_raw in enumerate(clips_raw):
            if not isinstance(clip_raw, dict):
                raise ValueError(f"Track {track_id!r} clip {clip_index} must be a JSON object.")
            clips.append(_normalize_clip(clip_raw, clip_index, sources, seen_clip_ids))
        total_clips += len(clips)
        if total_clips > MAX_CLIPS:
            raise ValueError(f"V2 supports at most {MAX_CLIPS} clips across all tracks.")
        track["clips"] = clips
        tracks.append(track)
    project["tracks"] = tracks

    master = project.get("master")
    if not isinstance(master, dict):
        master = {}
    master = deepcopy(master)
    channel_mode = _text(master.get("channel_mode")) or "preserve"
    if channel_mode not in CHANNEL_MODES:
        channel_mode = "preserve"
    normalize = master.get("normalize")
    if not isinstance(normalize, dict):
        normalize = {}
    normalize = deepcopy(normalize)
    normalize.update(
        {
            "enabled": _bool(normalize.get("enabled"), False),
            "target_peak_dbfs": _clamp(_float(normalize.get("target_peak_dbfs"), -1.0), -60.0, 0.0),
        }
    )
    master.update(
        {
            "gain_db": _clamp(_float(master.get("gain_db"), 0.0), -60.0, 24.0),
            "channel_mode": channel_mode,
            "normalize": normalize,
        }
    )
    project["master"] = master

    reserved = project.get("reserved")
    if not isinstance(reserved, dict):
        reserved = {}
    project["reserved"] = deepcopy(reserved)
    project["edit_schema_version"] = EDIT_SCHEMA_VERSION
    return project


def project_timeline_duration(project: dict[str, Any]) -> float:
    maximum = 0.0
    tracks = project.get("tracks", [])
    if not isinstance(tracks, list):
        return 0.0
    for track in tracks:
        if not isinstance(track, dict):
            continue
        for clip in track.get("clips", []) if isinstance(track.get("clips"), list) else []:
            if not isinstance(clip, dict):
                continue
            duration = max(0.0, _float(clip.get("source_out"), 0.0) - _float(clip.get("source_in"), 0.0))
            end = max(0.0, _float(clip.get("timeline_start"), 0.0)) + duration
            maximum = max(maximum, end)
    return round(maximum, 9)


def dump_edit_project(project: dict[str, Any]) -> str:
    return json.dumps(project, ensure_ascii=False, separators=(",", ":"))
