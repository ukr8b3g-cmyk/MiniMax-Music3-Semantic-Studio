import json

from semantic_project import DEFAULT_PROJECT, DEFAULT_PROJECT_JSON, MAX_SECTIONS, compile_project, load_project, project_duration


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


def test_invalid_or_empty_project_state_falls_back_and_compiles():
    for value in ("{not-json", "", None, [], 42):
        compiled = compile_project(value)
        assert compiled.target_duration > 0
        assert "### Arrangement" in compiled.caption
        assert "[Instrumental]" in compiled.lyrics
        assert compiled.warnings


def test_unknown_schema_version_is_forward_interpreted_not_blocked():
    project = json.loads(DEFAULT_PROJECT_JSON)
    project["schema_version"] = 99
    project["future_extension"] = {"keep": True}

    loaded = load_project(project)
    compiled = compile_project(project)

    assert loaded["schema_version"] == 1
    assert loaded["reserved"]["source_schema_version"] == 99
    assert loaded["future_extension"]["keep"] is True
    assert any("schema_version=99" in warning for warning in compiled.warnings)


def test_empty_unknown_and_excess_sections_are_repaired_without_stopping():
    empty = {"schema_version": 1, "global": {}, "timeline": {"sections": []}}
    compiled_empty = compile_project(empty)
    assert compiled_empty.target_duration == 16.0
    assert "[Instrumental]" in compiled_empty.lyrics

    weird = json.loads(DEFAULT_PROJECT_JSON)
    weird["timeline"]["sections"] = [
        {"id": "a", "type": "Piano Solo", "duration": 4},
        {"id": "b", "type": "anything-user-invented", "duration": 4},
    ]
    loaded_weird = load_project(weird)
    assert [item["type"] for item in loaded_weird["timeline"]["sections"]] == ["Solo", "Instrumental"]

    excess = json.loads(DEFAULT_PROJECT_JSON)
    excess["timeline"]["sections"] = [
        {"id": f"s-{index}", "type": "Verse", "duration": 1}
        for index in range(MAX_SECTIONS + 20)
    ]
    loaded_excess = load_project(excess)
    assert len(loaded_excess["timeline"]["sections"]) == MAX_SECTIONS


def test_default_object_is_not_mutated_by_load():
    original = json.dumps(DEFAULT_PROJECT, sort_keys=True)
    loaded = load_project(DEFAULT_PROJECT)
    loaded["global"]["genre"] = "Changed"

    assert json.dumps(DEFAULT_PROJECT, sort_keys=True) == original
