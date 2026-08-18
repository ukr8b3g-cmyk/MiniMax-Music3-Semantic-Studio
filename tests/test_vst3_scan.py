import json

from vst3_scan import scan_vst3_plugins


def test_scan_detects_vst3_bundle_and_reads_moduleinfo(tmp_path):
    bundle = tmp_path / "MuseFX Reverb.vst3"
    info_dir = bundle / "Contents"
    info_dir.mkdir(parents=True)
    (info_dir / "moduleinfo.json").write_text(json.dumps({
        "Factory Info": {"Vendor": "Muse"},
        "Classes": [{"Name": "MuseFX Reverb", "Sub Categories": ["Fx", "Reverb"]}],
    }), encoding="utf-8")

    result = scan_vst3_plugins([tmp_path])

    assert result["count"] == 1
    plugin = result["plugins"][0]
    assert plugin["name"] == "MuseFX Reverb"
    assert plugin["vendor"] == "Muse"
    assert plugin["kind"] == "effect"
    assert plugin["status"] == "detected"
    assert plugin["validated"] is False


def test_scan_keeps_unclassified_effect_candidate(tmp_path):
    bundle = tmp_path / "LegacyEffect.vst3"
    bundle.mkdir()

    result = scan_vst3_plugins([tmp_path])

    assert result["count"] == 1
    assert result["plugins"][0]["name"] == "LegacyEffect"
    assert result["plugins"][0]["kind"] == "unknown"


def test_scan_filters_known_vst3_instruments(tmp_path):
    bundle = tmp_path / "Synth.vst3"
    info_dir = bundle / "Contents"
    info_dir.mkdir(parents=True)
    (info_dir / "moduleinfo.json").write_text(json.dumps({
        "Classes": [{"Name": "Test Synth", "Sub Categories": ["Instrument", "Synth"]}],
    }), encoding="utf-8")

    result = scan_vst3_plugins([tmp_path])

    assert result["count"] == 0
    assert result["plugins"] == []


def test_scan_does_not_double_count_bundle_internal_binary(tmp_path):
    bundle = tmp_path / "BundleFx.vst3"
    binary_dir = bundle / "Contents" / "x86_64-win"
    binary_dir.mkdir(parents=True)
    (binary_dir / "BundleFx.vst3").write_bytes(b"placeholder")

    result = scan_vst3_plugins([tmp_path])

    assert result["count"] == 1
    assert result["plugins"][0]["path"] == str(bundle)
