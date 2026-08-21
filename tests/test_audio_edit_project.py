import json

import pytest

from audio_edit_project import (
    DEFAULT_EDIT_JSON,
    EDIT_SCHEMA_VERSION,
    MAX_CLIPS,
    MAX_TRACKS,
    SourceInfo,
    dump_edit_project,
    load_edit_project,
    normalize_edit_project,
    project_timeline_duration,
)


def source(source_id="take-1", input_name="audio", duration=2.0, sample_rate=10, channels=2):
    return SourceInfo(
        id=source_id,
        input_name=input_name,
        name=source_id,
        sample_rate=sample_rate,
        batch_size=1,
        channels=channels,
        num_samples=int(duration * sample_rate),
        duration=duration,
    )


def test_default_edit_state_expands_to_full_primary_clip():
    project = normalize_edit_project(DEFAULT_EDIT_JSON, [source(duration=3.5, sample_rate=100)])
    clip = project["tracks"][0]["clips"][0]

    assert clip["source_id"] == "take-1"
    assert clip["source_in"] == 0.0
    assert clip["source_out"] == 3.5
    assert project_timeline_duration(project) == 3.5
    assert project["edit_schema_version"] == EDIT_SCHEMA_VERSION
    assert project["tracks"][0]["name"] == "Main Track"


def test_unknown_fields_round_trip():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["future"] = {"v3": True}
    raw["master"]["future_master"] = 9
    raw["tracks"][0]["future_track"] = "x"

    project = normalize_edit_project(raw, [source()])
    encoded = json.loads(dump_edit_project(project))

    assert encoded["future"]["v3"] is True
    assert encoded["master"]["future_master"] == 9
    assert encoded["tracks"][0]["future_track"] == "x"


def test_connected_take_records_are_explicit_and_stale_take_is_removed():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["takes"] = [
        {"id": "take-1", "name": "Lead"},
        {"id": "take-4", "name": "stale"},
    ]
    sources = [source(), source("take-2", "take_2")]

    project = normalize_edit_project(raw, sources)

    assert [take["id"] for take in project["takes"]] == ["take-1", "take-2"]
    assert project["takes"][0]["name"] == "Lead"


def test_missing_legacy_take_reference_falls_back_to_primary_audio():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["tracks"][0]["clips"] = [
        {
            "id": "bad",
            "source_id": "take-2",
            "source_in": 0,
            "source_out": 1,
            "timeline_start": 0,
        }
    ]

    project = normalize_edit_project(raw, [source()])
    clip = project["tracks"][0]["clips"][0]
    assert clip["source_id"] == "take-1"
    assert clip["source_out"] == 1.0


def test_empty_or_reversed_source_range_is_repaired():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["tracks"][0]["clips"] = [
        {"id": "empty", "source_id": "take-1", "source_in": 1.5, "source_out": 1.0},
    ]
    project = normalize_edit_project(raw, [source(duration=2.0)])
    clip = project["tracks"][0]["clips"][0]
    assert clip["source_in"] == 1.5
    assert clip["source_out"] == 2.0


def test_clip_and_track_values_are_clamped_and_envelopes_sorted():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["tracks"][0].update(
        {
            "muted": "yes",
            "solo": 1,
            "gain_db": 99,
            "pan": -9,
            "gain_envelope": [
                {"time": 1.5, "gain_db": 40},
                {"time": 0.5, "gain_db": -90},
            ],
        }
    )
    raw["tracks"][0]["clips"] = [
        {
            "id": "clip",
            "source_id": "take-1",
            "source_in": -4,
            "source_out": 99,
            "timeline_start": -3,
            "gain_db": 99,
            "pan": -9,
            "fade_in": {"duration": 99, "curve": "bad"},
            "gain_envelope": [
                {"time": 1.5, "gain_db": 40},
                {"time": 0.5, "gain_db": -90},
            ],
        }
    ]

    project = normalize_edit_project(raw, [source(duration=2.0)])
    clip = project["tracks"][0]["clips"][0]
    track = project["tracks"][0]

    assert clip["source_in"] == 0.0
    assert clip["source_out"] == 2.0
    assert clip["timeline_start"] == 0.0
    assert clip["gain_db"] == 24.0
    assert clip["pan"] == -1.0
    assert clip["fade_in"] == {"duration": 2.0, "curve": "linear"}
    assert clip["gain_envelope"] == [
        {"time": 0.5, "gain_db": -60.0},
        {"time": 1.5, "gain_db": 24.0},
    ]
    assert track["muted"] is True
    assert track["solo"] is True
    assert track["gain_db"] == 24.0
    assert track["pan"] == -1.0
    assert track["gain_envelope"] == [
        {"time": 0.5, "gain_db": -60.0},
        {"time": 1.5, "gain_db": 24.0},
    ]


def test_schema_1_migrates_without_changing_clip_state():
    legacy = {
        "edit_schema_version": 1,
        "project_id": "legacy",
        "view": {"zoom": 2, "scroll_seconds": 1},
        "takes": [],
        "tracks": [
            {
                "id": "main",
                "name": "Main Comp",
                "clips": [
                    {
                        "id": "clip-legacy",
                        "source_id": "take-1",
                        "source_in": 0,
                        "source_out": 2,
                        "timeline_start": 0,
                        "gain_db": -3,
                        "pan": 0.25,
                        "muted": False,
                        "reverse": False,
                        "fade_in": {"duration": 0, "curve": "linear"},
                        "fade_out": {"duration": 0, "curve": "linear"},
                        "gain_envelope": [{"time": 1, "gain_db": -6}],
                    }
                ],
            }
        ],
        "master": {"gain_db": 0, "channel_mode": "preserve", "normalize": {"enabled": False, "target_peak_dbfs": -1}},
        "reserved": {"keep": True},
    }

    project = normalize_edit_project(legacy, [source(duration=2)])

    assert project["edit_schema_version"] == 2
    assert project["tracks"][0]["gain_db"] == 0
    assert project["tracks"][0]["pan"] == 0
    assert project["tracks"][0]["muted"] is False
    assert project["tracks"][0]["gain_envelope"] == []
    assert project["tracks"][0]["clips"][0]["gain_db"] == -3
    assert project["tracks"][0]["clips"][0]["gain_envelope"] == [{"time": 1.0, "gain_db": -6.0}]
    assert project["reserved"]["keep"] is True


def test_unknown_edit_schema_is_interpreted_and_preserved():
    loaded = load_edit_project({"edit_schema_version": 99, "future": {"keep": True}})
    assert loaded["edit_schema_version"] == EDIT_SCHEMA_VERSION
    assert loaded["reserved"]["source_edit_schema_version"] == 99
    assert loaded["future"]["keep"] is True


def test_track_and_clip_limits_truncate_instead_of_stopping():
    raw = json.loads(DEFAULT_EDIT_JSON)
    template = raw["tracks"][0]
    raw["tracks"] = []
    for track_index in range(MAX_TRACKS + 5):
        track = dict(template)
        track["id"] = f"track-{track_index}"
        track["clips"] = [
            {"id": f"c-{track_index}-{clip_index}", "source_id": "take-1", "source_in": 0, "source_out": 1}
            for clip_index in range(40)
        ]
        raw["tracks"].append(track)

    project = normalize_edit_project(raw, [source(duration=2)])
    assert len(project["tracks"]) <= MAX_TRACKS
    assert sum(len(track["clips"]) for track in project["tracks"]) <= MAX_CLIPS


def test_invalid_json_remains_actionable_to_protect_persistent_edits():
    with pytest.raises(ValueError, match="audio edit JSON is invalid"):
        load_edit_project("{bad")


def test_new_source_identity_resets_audio_edits_but_preserves_view_and_project_metadata():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["project_id"] = "project-keep"
    raw["future"] = {"keep": True}
    raw["view"] = {"zoom": 2.5, "scroll_seconds": 1.25, "waveform_height": 512}
    raw["reserved"] = {"source_identity": "capture-old", "keep": True}
    raw["tracks"][0].update(
        {
            "gain_db": -6,
            "pan": 0.5,
            "gain_envelope": [{"time": 0.5, "gain_db": -3}],
            "effects": [{"id": "fx-1", "type": "reverb", "enabled": True, "params": {"wet": 0.5}}],
        }
    )
    raw["tracks"][0]["clips"] = [
        {
            "id": "edited",
            "source_id": "take-1",
            "source_in": 0.25,
            "source_out": 1.5,
            "timeline_start": 0.4,
            "gain_db": -4,
            "pan": -0.2,
            "muted": False,
            "reverse": True,
            "fade_in": {"duration": 0.3, "curve": "linear"},
            "fade_out": {"duration": 0.4, "curve": "equal_power"},
            "gain_envelope": [{"time": 0.5, "gain_db": -8}],
        }
    ]
    raw["master"].update(
        {
            "gain_db": -2,
            "effects": [{"id": "master-fx", "type": "delay", "enabled": True, "params": {}}],
        }
    )

    project = normalize_edit_project(raw, [source(duration=3.0)], source_identity="capture-new")
    track = project["tracks"][0]
    clip = track["clips"][0]

    assert project["project_id"] == "project-keep"
    assert project["future"] == {"keep": True}
    assert project["view"] == {"zoom": 2.5, "scroll_seconds": 1.25, "waveform_height": 512.0}
    assert project["reserved"]["keep"] is True
    assert project["reserved"]["source_identity"] == "capture-new"
    assert track["gain_db"] == 0.0
    assert track["pan"] == 0.0
    assert track["gain_envelope"] == []
    assert track["effects"] == []
    assert clip["source_in"] == 0.0
    assert clip["source_out"] == 3.0
    assert clip["timeline_start"] == 0.0
    assert clip["gain_db"] == 0.0
    assert clip["pan"] == 0.0
    assert clip["reverse"] is False
    assert clip["fade_in"] == {"duration": 0.0, "curve": "linear"}
    assert clip["fade_out"] == {"duration": 0.0, "curve": "linear"}
    assert project["master"]["gain_db"] == 0.0
    assert project["master"]["effects"] == []


def test_same_source_identity_preserves_existing_audio_edits():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["reserved"] = {"source_identity": "capture-same"}
    raw["tracks"][0]["gain_db"] = -3
    raw["tracks"][0]["effects"] = [{"id": "fx", "type": "reverb", "enabled": True, "params": {}}]
    raw["tracks"][0]["clips"] = [
        {
            "id": "clip",
            "source_id": "take-1",
            "source_in": 0,
            "source_out": 2,
            "timeline_start": 0,
            "fade_in": {"duration": 0.5, "curve": "linear"},
            "fade_out": {"duration": 0.25, "curve": "linear"},
        }
    ]

    project = normalize_edit_project(raw, [source(duration=2)], source_identity="capture-same")

    assert project["tracks"][0]["gain_db"] == -3.0
    assert project["tracks"][0]["effects"][0]["type"] == "reverb"
    assert project["tracks"][0]["clips"][0]["fade_in"]["duration"] == 0.5
    assert project["tracks"][0]["clips"][0]["fade_out"]["duration"] == 0.25


def test_direct_audio_without_source_identity_keeps_existing_behavior():
    raw = json.loads(DEFAULT_EDIT_JSON)
    raw["reserved"] = {"source_identity": "capture-old"}
    raw["tracks"][0]["gain_db"] = -5
    raw["tracks"][0]["clips"] = [
        {"id": "clip", "source_id": "take-1", "source_in": 0, "source_out": 2, "timeline_start": 0}
    ]

    project = normalize_edit_project(raw, [source(duration=2)])

    assert project["tracks"][0]["gain_db"] == -5.0
    assert project["reserved"]["source_identity"] == "capture-old"
