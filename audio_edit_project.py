from __future__ import annotations

import json
import math
from copy import deepcopy
from dataclasses import dataclass
from typing import Any, Iterable

EDIT_SCHEMA_VERSION = 2
LEGACY_EDIT_SCHEMA_VERSION = 1
MAX_TAKES = 4
MAX_TRACKS = 16
MAX_CLIPS = 512
MAX_ENVELOPE_POINTS = 128
MAX_EFFECTS = 64

TAKE_INPUTS = ("audio", "take_2", "take_3", "take_4")
CHANNEL_MODES = ("preserve", "mono", "stereo", "left_only", "right_only", "swap_lr")
FADE_CURVES = ("linear", "equal_power")

DEFAULT_EDIT_PROJECT: dict[str, Any] = {
    "edit_schema_version": EDIT_SCHEMA_VERSION,
    "project_id": "",
    "view": {
        "zoom": 1.0,
        "scroll_seconds": 0.0,
        "waveform_height": 360.0,
    },
    "takes": [],
    "tracks": [
        {
            "id": "main",
            "name": "Main Track",
            "muted": False,
            "solo": False,
            "gain_db": 0.0,
            "pan": 0.0,
            "gain_envelope": [],
            "effects": [],
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
        "effects": [],
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


def _migrate_v1_to_v2(raw: dict[str, Any]) -> dict[str, Any]:
    """Migrate legacy clip-centric state while preserving unknown fields."""

    migrated = deepcopy(raw)
    tracks = migrated.get("tracks")
    if not isinstance(tracks, list) or not tracks:
        tracks = deepcopy(DEFAULT_EDIT_PROJECT["tracks"])
    for index, track in enumerate(tracks):
        if not isinstance(track, dict):
            continue
        track.setdefault("name", "Main Track" if index == 0 else f"Track {index + 1}")
        track.setdefault("muted", False)
        track.setdefault("solo", False)
        track.setdefault("gain_db", 0.0)
        track.setdefault("pan", 0.0)
        track.setdefault("gain_envelope", [])
        track.setdefault("effects", [])
    migrated["tracks"] = tracks

    master = migrated.get("master")
    if not isinstance(master, dict):
        master = {}
    master.setdefault("effects", [])
    migrated["master"] = master

    view = migrated.get("view")
    if not isinstance(view, dict):
        view = {}
    view.setdefault("waveform_height", 360.0)
    migrated["view"] = view
    migrated["edit_schema_version"] = EDIT_SCHEMA_VERSION
    return migrated


def load_edit_project(edit_json: str | dict[str, Any] | None) -> dict[str, Any]:
    """Parse edit state, migrate known legacy state, and preserve unknown fields.

    Invalid JSON remains a hard error because guessing over corrupted persistent edit
    data could silently destroy user edits. Unknown schema versions are not rejected:
    known fields are interpreted conservatively and the source version is retained.
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

    version = raw.get("edit_schema_version", LEGACY_EDIT_SCHEMA_VERSION)
    if version == LEGACY_EDIT_SCHEMA_VERSION:
        return _migrate_v1_to_v2(raw)
    if version != EDIT_SCHEMA_VERSION:
        reserved = raw.get("reserved") if isinstance(raw.get("reserved"), dict) else {}
        reserved = deepcopy(reserved)
        reserved.setdefault("source_edit_schema_version", version)
        raw["reserved"] = reserved
    raw["edit_schema_version"] = EDIT_SCHEMA_VERSION
    return raw


def _source_lookup(source_infos: Iterable[SourceInfo]) -> dict[str, SourceInfo]:
    # Public V1.0 exposes one AUDIO input, but keep legacy callers permissive.
    sources = list(source_infos)[:MAX_TAKES]
    lookup = {source.id: source for source in sources}
    if not lookup:
        raise ValueError("Music3 Semantic Studio Audio Editor requires the primary audio input.")
    if "take-1" not in lookup:
        raise ValueError("Primary audio source must be registered as take-1.")
    return lookup


def _reset_audio_edits_for_source_identity(project: dict[str, Any], source_identity: str) -> None:
    identity = _text(source_identity)
    reserved = project.get("reserved")
    if not isinstance(reserved, dict):
        reserved = {}
    reserved = deepcopy(reserved)

    if identity:
        previous = _text(reserved.get("source_identity"))
        if previous != identity:
            # A newly captured take must not inherit edits from the previous
            # waveform. Keep project/view/unknown top-level state, but reset
            # all source-dependent audio editing and processing state.
            project["takes"] = []
            project["tracks"] = deepcopy(DEFAULT_EDIT_PROJECT["tracks"])
            project["master"] = deepcopy(DEFAULT_EDIT_PROJECT["master"])
        reserved["source_identity"] = identity

    project["reserved"] = reserved


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
    for source in source_infos[:MAX_TAKES]:
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


def _normalize_envelope(value: Any, duration: float) -> list[dict[str, float]]:
    if not isinstance(value, list):
        return []
    points: list[dict[str, float]] = []
    for item in value[:MAX_ENVELOPE_POINTS]:
        if not isinstance(item, dict):
            continue
        time = _clamp(_float(item.get("time"), 0.0), 0.0, max(0.0, duration))
        gain_db = _clamp(_float(item.get("gain_db"), 0.0), -60.0, 24.0)
        points.append({"time": time, "gain_db": gain_db})
    deduped: dict[float, dict[str, float]] = {}
    for point in points:
        deduped[round(point["time"], 9)] = point
    return [deduped[key] for key in sorted(deduped)]


def _normalize_effects(value: Any) -> list[dict[str, Any]]:
    if not isinstance(value, list):
        return []
    effects: list[dict[str, Any]] = []
    seen: set[str] = set()
    for index, raw in enumerate(value[:MAX_EFFECTS]):
        if not isinstance(raw, dict):
            continue
        effect = deepcopy(raw)
        effect["id"] = _unique_id(effect.get("id"), f"effect-{index + 1}", seen)
        effect["type"] = _text(effect.get("type"))
        effect["enabled"] = _bool(effect.get("enabled"), True)
        params = effect.get("params")
        effect["params"] = deepcopy(params) if isinstance(params, dict) else {}
        effects.append(effect)
    return effects


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
        source_id = "take-1"
        source = sources[source_id]

    source_in = _clamp(_float(clip.get("source_in"), 0.0), 0.0, source.duration)
    source_out = _clamp(_float(clip.get("source_out"), source.duration), 0.0, source.duration)
    if source_out <= source_in:
        if source.duration > source_in:
            source_out = source.duration
        else:
            source_in = 0.0
            source_out = source.duration
    # AUDIO validation guarantees at least one sample, so duration should be > 0.
    # Keep a tiny positive range as a last-resort guard against pathological metadata.
    if source_out <= source_in:
        source_in = 0.0
        source_out = max(source.duration, 1e-9)
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
    *,
    source_identity: str = "",
) -> dict[str, Any]:
    """Normalize edit state against connected audio without rejecting repairable state."""

    project = load_edit_project(edit_json)
    source_list = list(source_infos)[:MAX_TAKES]
    sources = _source_lookup(source_list)

    project.setdefault("project_id", "")
    project["project_id"] = _text(project.get("project_id"))
    _reset_audio_edits_for_source_identity(project, source_identity)

    view = project.get("view")
    if not isinstance(view, dict):
        view = {}
    view = deepcopy(view)
    view.update(
        {
            "zoom": _clamp(_float(view.get("zoom"), 1.0), 0.05, 100.0),
            "scroll_seconds": max(0.0, _float(view.get("scroll_seconds"), 0.0)),
            "waveform_height": _clamp(_float(view.get("waveform_height"), 360.0), 220.0, 900.0),
        }
    )
    project["view"] = view
    project["takes"] = _normalize_take_records(project, source_list)

    tracks_raw = project.get("tracks")
    if not isinstance(tracks_raw, list) or not tracks_raw:
        tracks_raw = deepcopy(DEFAULT_EDIT_PROJECT["tracks"])
    tracks_raw = tracks_raw[:MAX_TRACKS]

    tracks: list[dict[str, Any]] = []
    seen_track_ids: set[str] = set()
    total_clips = 0
    for track_index, track_raw in enumerate(tracks_raw):
        if not isinstance(track_raw, dict):
            continue
        track = deepcopy(track_raw)
        track_id = _unique_id(track.get("id"), f"track-{track_index + 1}", seen_track_ids)
        track["id"] = track_id
        track["name"] = _text(track.get("name")) or ("Main Track" if track_index == 0 else f"Track {track_index + 1}")

        clips_raw = track.get("clips")
        if not isinstance(clips_raw, list):
            clips_raw = []

        if track_index == 0 and not clips_raw:
            clips_raw = [_default_clip(sources["take-1"])]

        remaining = max(0, MAX_CLIPS - total_clips)
        clips_raw = clips_raw[:remaining]
        seen_clip_ids: set[str] = set()
        clips: list[dict[str, Any]] = []
        for clip_index, clip_raw in enumerate(clips_raw):
            if not isinstance(clip_raw, dict):
                continue
            clips.append(_normalize_clip(clip_raw, clip_index, sources, seen_clip_ids))
        total_clips += len(clips)

        track_duration = max(
            (
                max(0.0, float(clip["timeline_start"]))
                + max(0.0, float(clip["source_out"]) - float(clip["source_in"]))
                for clip in clips
            ),
            default=0.0,
        )
        track.update(
            {
                "muted": _bool(track.get("muted"), False),
                "solo": _bool(track.get("solo"), False),
                "gain_db": _clamp(_float(track.get("gain_db"), 0.0), -60.0, 24.0),
                "pan": _clamp(_float(track.get("pan"), 0.0), -1.0, 1.0),
                "gain_envelope": _normalize_envelope(track.get("gain_envelope"), track_duration),
                "effects": _normalize_effects(track.get("effects")),
                "clips": clips,
            }
        )
        tracks.append(track)
        if total_clips >= MAX_CLIPS:
            break

    if not tracks:
        track = deepcopy(DEFAULT_EDIT_PROJECT["tracks"][0])
        track["clips"] = [_default_clip(sources["take-1"])]
        tracks = [track]
    elif not tracks[0].get("clips"):
        tracks[0]["clips"] = [_default_clip(sources["take-1"])]
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
            "effects": _normalize_effects(master.get("effects")),
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
