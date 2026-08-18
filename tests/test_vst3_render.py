import json

import torch

import vst3_host
from audio_edit_project import DEFAULT_EDIT_JSON
from audio_render import render_audio_edit


class FakeEffect:
    is_effect = True

    def __init__(self, factor=0.5):
        self.factor = factor

    def __call__(self, audio, sample_rate, buffer_size=8192, reset=True):
        return audio * self.factor


def make_audio():
    return {
        "waveform": torch.tensor([[[0.4, 0.4, 0.4, 0.4]]], dtype=torch.float32),
        "sample_rate": 4,
    }


def make_project(plugin_path):
    project = json.loads(DEFAULT_EDIT_JSON)
    project["tracks"][0]["clips"] = [{
        "id": "clip",
        "source_id": "take-1",
        "source_in": 0,
        "source_out": 1,
        "timeline_start": 0,
        "gain_db": 0,
        "pan": 0,
        "muted": False,
        "reverse": False,
        "fade_in": {"duration": 0, "curve": "linear"},
        "fade_out": {"duration": 0, "curve": "linear"},
        "gain_envelope": [],
    }]
    project["tracks"][0]["effects"] = [{
        "id": "track-vst",
        "type": "vst3",
        "enabled": True,
        "params": {
            "path": str(plugin_path),
            "plugin_name": "Queue Test FX",
            "name": "Queue Test FX",
        },
    }]
    project["master"]["effects"] = [{
        "id": "master-vst",
        "type": "vst3",
        "enabled": True,
        "params": {
            "path": str(plugin_path),
            "plugin_name": "Queue Test FX",
            "name": "Queue Test FX",
        },
    }]
    return project


def test_queue_renderer_applies_track_and_master_vst3(monkeypatch, tmp_path):
    bundle = tmp_path / "QueueTest.vst3"
    bundle.mkdir()
    loaded = []

    def loader(path, plugin_name):
        loaded.append((path, plugin_name))
        return FakeEffect(0.5)

    monkeypatch.setattr(vst3_host, "_default_loader", loader)
    result = render_audio_edit(make_audio(), make_project(bundle))

    assert loaded == [(str(bundle), "Queue Test FX"), (str(bundle), "Queue Test FX")]
    assert torch.allclose(result.audio["waveform"], torch.full((1, 1, 4), 0.1), atol=1e-6)
