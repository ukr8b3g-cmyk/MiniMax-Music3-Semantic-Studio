import base64
import json

import pytest

import vst3_editor
import vst3_editor_process


def test_editor_request_only_accepts_currently_scanned_vst3(monkeypatch, tmp_path):
    bundle = tmp_path / "MuseFX Chorus.vst3"
    bundle.mkdir()
    monkeypatch.setattr(vst3_editor, "scan_vst3_plugins", lambda: {
        "plugins": [{"path": str(bundle), "name": "Chorus"}],
    })

    result = vst3_editor._validated_payload({
        "path": str(bundle),
        "plugin_name": "Chorus",
        "state_kind": "preset_data",
        "state_b64": "",
    })
    assert result["path"] == str(bundle)
    assert result["plugin_name"] == "Chorus"

    other = tmp_path / "Other.vst3"
    other.mkdir()
    with pytest.raises(vst3_editor.Vst3EditorRequestError, match="current installed-plugin scan"):
        vst3_editor._validated_payload({"path": str(other), "plugin_name": "Other"})


def test_helper_process_restores_opens_and_captures_state(monkeypatch, tmp_path):
    class FakePlugin:
        is_effect = True
        name = "MuseFX Chorus"
        identifier = "muse.chorus.fake"
        version = "1.2.3"
        manufacturer_name = "Muse"

        def __init__(self):
            self.preset_data = b""
            self.raw_state = b""
            self.opened = False

        def show_editor(self):
            assert self.preset_data == b"before-ui"
            self.opened = True
            self.preset_data = b"after-ui"

    plugin = FakePlugin()
    monkeypatch.setattr(vst3_editor_process, "_load_plugin", lambda path, name: plugin)
    bundle = tmp_path / "MuseFX Chorus.vst3"
    bundle.mkdir()
    input_path = tmp_path / "input.json"
    output_path = tmp_path / "output.json"
    input_path.write_text(json.dumps({
        "path": str(bundle),
        "plugin_name": "MuseFX Chorus",
        "state_kind": "preset_data",
        "state_b64": base64.b64encode(b"before-ui").decode("ascii"),
        "plugin_identifier": plugin.identifier,
    }), encoding="utf-8")

    vst3_editor_process.run(input_path, output_path)
    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert plugin.opened is True
    assert result["ok"] is True
    assert result["state_kind"] == "preset_data"
    assert base64.b64decode(result["state_b64"]) == b"after-ui"
    assert result["plugin_identifier"] == plugin.identifier
    assert result["state_bytes"] == len(b"after-ui")


def test_helper_rejects_state_from_other_plugin(monkeypatch, tmp_path):
    class FakePlugin:
        is_effect = True
        identifier = "actual.plugin"
        preset_data = b""
        raw_state = b""

        def show_editor(self):
            raise AssertionError("editor must not open after identifier mismatch")

    monkeypatch.setattr(vst3_editor_process, "_load_plugin", lambda path, name: FakePlugin())
    bundle = tmp_path / "Plugin.vst3"
    bundle.mkdir()
    input_path = tmp_path / "input.json"
    output_path = tmp_path / "output.json"
    input_path.write_text(json.dumps({
        "path": str(bundle),
        "plugin_name": "Plugin",
        "state_kind": "preset_data",
        "state_b64": base64.b64encode(b"state").decode("ascii"),
        "plugin_identifier": "other.plugin",
    }), encoding="utf-8")

    with pytest.raises(ValueError, match="different plugin identifier"):
        vst3_editor_process.run(input_path, output_path)
