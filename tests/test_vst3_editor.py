import asyncio
import base64
import json
from io import StringIO
from threading import Event

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


def test_close_watcher_sets_pedalboard_event():
    close_event = Event()
    thread = vst3_editor_process._start_close_watcher(close_event, StringIO("noop\nclose\n"))
    thread.join(timeout=1.0)
    assert close_event.is_set()


def test_server_close_request_signals_active_helper(monkeypatch):
    class FakeStdin:
        def __init__(self):
            self.writes = []

        def write(self, data):
            self.writes.append(data)

        async def drain(self):
            return None

    class FakeProcess:
        def __init__(self):
            self.stdin = FakeStdin()
            self.returncode = None

        async def wait(self):
            self.returncode = 0
            return 0

        def terminate(self):
            raise AssertionError("normal close should not terminate the helper")

        def kill(self):
            raise AssertionError("normal close should not kill the helper")

    process = FakeProcess()
    monkeypatch.setattr(vst3_editor, "_ACTIVE_PROCESS", process)
    result = asyncio.run(vst3_editor.close_native_editor())
    assert result["ok"] is True
    assert result["forced"] is False
    assert process.stdin.writes == [b"close\n"]


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
            self.close_event = None

        def show_editor(self, close_event):
            assert self.preset_data == b"before-ui"
            assert hasattr(close_event, "is_set")
            assert close_event.is_set() is False
            self.close_event = close_event
            self.opened = True
            self.preset_data = b"after-ui"

    plugin = FakePlugin()
    monkeypatch.setattr(vst3_editor_process, "_load_plugin", lambda path, name: plugin)
    monkeypatch.setattr(vst3_editor_process, "_start_close_watcher", lambda event, stream=None: None)
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
    assert plugin.close_event is not None
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

        def show_editor(self, close_event):
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
