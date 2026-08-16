import json

import pytest

from semantic_project import DEFAULT_PROJECT, DEFAULT_PROJECT_JSON, compile_project, load_project, project_duration


def test_default_project_round_trips_and_compiles():
    project = load_project(DEFAULT_PROJECT_JSON)
    compiled = compile_project(project)

    assert project["schema_version"] == 1
    assert project_duration(project) == 160.0
    assert "### Global Metadata" in compiled.caption
    assert "### Vocal Details" in compiled.caption
    assert "### Arrangement" in compiled.caption
    assert "[Intro]" in compiled.lyrics
    assert "[Chorus]" in compiled.lyrics
    assert compiled.target_duration == 160.0


def test_unknown_future_fields_are_preserved():
    project = json.loads(DEFAULT_PROJECT_JSON)
    project["future_extension"] = {"v3": {"conditioning_curve": [0.0, 1.0]}}
    loaded = load_project(project)

    assert loaded["future_extension"]["v3"]["conditioning_curve"] == [0.0, 1.0]


def test_instrumental_mode_ignores_lyrics_with_warning():
    project = json.loads(DEFAULT_PROJECT_JSON)
    project["global"]["vocal"]["mode"] = "instrumental"
    project["timeline"]["sections"][1]["lyrics"] = "This should not be sung"

    compiled = compile_project(project)

    assert "This should not be sung" not in compiled.lyrics
    assert any("ignored" in warning for warning in compiled.warnings)
    assert "Instrumental piece" in compiled.caption


def test_section_energy_and_duration_are_normalized():
    project = json.loads(DEFAULT_PROJECT_JSON)
    project["timeline"]["sections"] = [
        {
            "id": "x",
            "type": "Verse",
            "label": "Verse",
            "duration": -50,
            "energy": 3,
            "lyrics": "hello",
            "instruments": "piano, piano, bass",
        }
    ]

    loaded = load_project(project)
    section = loaded["timeline"]["sections"][0]

    assert section["duration"] == 0.5
    assert section["energy"] == 1.0
    assert section["instruments"] == ["piano", "bass"]


def test_invalid_json_has_actionable_error():
    with pytest.raises(ValueError, match="project JSON is invalid"):
        load_project("{not-json")


def test_unsupported_schema_version_fails_closed():
    project = json.loads(DEFAULT_PROJECT_JSON)
    project["schema_version"] = 99

    with pytest.raises(ValueError, match="Unsupported Semantic Studio schema_version"):
        load_project(project)


def test_default_object_is_not_mutated_by_load():
    original = json.dumps(DEFAULT_PROJECT, sort_keys=True)
    loaded = load_project(DEFAULT_PROJECT)
    loaded["global"]["genre"] = "Changed"

    assert json.dumps(DEFAULT_PROJECT, sort_keys=True) == original
