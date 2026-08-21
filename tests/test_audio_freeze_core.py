from __future__ import annotations

import pytest
import torch

from audio_freeze_core import (
    SOURCE_IDENTITY_KEY,
    capture_audio,
    clear_all_audio,
    frozen_audio_info,
    retrieve_audio,
    snapshot_audio,
)


@pytest.fixture(autouse=True)
def _clear_freeze_cache():
    clear_all_audio()
    yield
    clear_all_audio()


def _audio(value: float = 1.0, *, samples: int = 16, sample_rate: int = 44100):
    return {
        "waveform": torch.full((1, 2, samples), value, dtype=torch.float32),
        "sample_rate": sample_rate,
    }


def test_snapshot_is_cpu_owned_and_detached():
    source = _audio()
    source["waveform"].requires_grad_(True)
    frozen = snapshot_audio(source)

    assert frozen["waveform"].device.type == "cpu"
    assert not frozen["waveform"].requires_grad
    assert frozen["waveform"].is_contiguous()
    assert frozen["waveform"].data_ptr() != source["waveform"].data_ptr()


def test_capture_and_retrieve_are_isolated_from_downstream_mutation():
    captured = capture_audio("node-1", _audio(0.25))
    captured["waveform"].fill_(9.0)

    retrieved = retrieve_audio("node-1")
    assert torch.allclose(retrieved["waveform"], torch.full_like(retrieved["waveform"], 0.25))
    assert retrieved[SOURCE_IDENTITY_KEY] == captured[SOURCE_IDENTITY_KEY]

    retrieved["waveform"].zero_()
    again = retrieve_audio("node-1")
    assert torch.allclose(again["waveform"], torch.full_like(again["waveform"], 0.25))
    assert again[SOURCE_IDENTITY_KEY] == captured[SOURCE_IDENTITY_KEY]


def test_recapture_replaces_previous_take_for_same_node_only():
    first_a = capture_audio("node-a", _audio(1.0))
    first_b = capture_audio("node-b", _audio(2.0))
    second_a = capture_audio("node-a", _audio(3.0))

    assert float(retrieve_audio("node-a")["waveform"].mean()) == pytest.approx(3.0)
    assert float(retrieve_audio("node-b")["waveform"].mean()) == pytest.approx(2.0)
    assert second_a[SOURCE_IDENTITY_KEY] != first_a[SOURCE_IDENTITY_KEY]
    assert retrieve_audio("node-a")[SOURCE_IDENTITY_KEY] == second_a[SOURCE_IDENTITY_KEY]
    assert retrieve_audio("node-b")[SOURCE_IDENTITY_KEY] == first_b[SOURCE_IDENTITY_KEY]


def test_recapture_gets_new_identity_even_when_audio_shape_matches():
    first = capture_audio("node-same", _audio(1.0))
    second = capture_audio("node-same", _audio(1.0))

    assert first[SOURCE_IDENTITY_KEY]
    assert second[SOURCE_IDENTITY_KEY]
    assert first[SOURCE_IDENTITY_KEY] != second[SOURCE_IDENTITY_KEY]


def test_missing_frozen_take_fails_instead_of_falling_back_to_upstream():
    with pytest.raises(RuntimeError, match="No captured audio"):
        retrieve_audio("node-missing")


def test_frozen_info_reports_audio_shape_without_exposing_buffer():
    capture_audio("node-info", _audio(samples=123, sample_rate=48000))
    info = frozen_audio_info("node-info")
    assert info is not None
    assert info.sample_rate == 48000
    assert info.batch_size == 1
    assert info.channels == 2
    assert info.num_samples == 123


def test_invalid_audio_is_rejected():
    with pytest.raises(ValueError, match="waveform"):
        snapshot_audio({"sample_rate": 44100})
    with pytest.raises(ValueError, match="sample_rate"):
        snapshot_audio({"waveform": torch.zeros((1, 2, 8)), "sample_rate": 0})
