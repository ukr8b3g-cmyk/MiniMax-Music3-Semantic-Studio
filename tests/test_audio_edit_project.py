import json

import pytest

from audio_edit_project import (
    DEFAULT_EDIT_JSON,
    EDIT_SCHEMA_VERSION,
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


def test_missing_connected_take_reference_fails_closed():
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

    with pytest.raises(ValueError, match="not connected"):
        normalize_edit_project(raw, [source()])


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


def test_invalid_json_and_schema_are_actionable():
    with pytest.raises(ValueError, match="audio edit JSON is invalid"):
        load_edit_project("{bad")

    with pytest.raises(ValueError, match="Unsupported audio edit_schema_version"):
        load_edit_project({"edit_schema_version": 99})
