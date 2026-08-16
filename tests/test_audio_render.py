import json
import math

import pytest
import torch

from audio_edit_project import DEFAULT_EDIT_JSON
from audio_render import collect_sources, render_audio_edit


def audio(values, sample_rate=10):
    tensor = torch.tensor(values, dtype=torch.float32)
    if tensor.ndim == 1:
        tensor = tensor.view(1, 1, -1)
    elif tensor.ndim == 2:
        tensor = tensor.unsqueeze(0)
    return {"waveform": tensor, "sample_rate": sample_rate}


def project_with_clips(clips, *, master=None):
    data = json.loads(DEFAULT_EDIT_JSON)
    data["tracks"][0]["clips"] = clips
    if master:
        data["master"].update(master)
    return data


def clip(source_id="take-1", source_in=0, source_out=1, timeline_start=0, **kwargs):
    value = {
        "id": kwargs.pop("id", "clip"),
        "source_id": source_id,
        "source_in": source_in,
        "source_out": source_out,
        "timeline_start": timeline_start,
        "gain_db": 0,
        "pan": 0,
        "muted": False,
        "reverse": False,
        "fade_in": {"duration": 0, "curve": "linear"},
        "fade_out": {"duration": 0, "curve": "linear"},
        "gain_envelope": [],
    }
    value.update(kwargs)
    return value


def test_default_edit_is_identity():
    source = audio([[0.1, 0.2, 0.3], [0.4, 0.5, 0.6]], sample_rate=3)
    result = render_audio_edit(source, DEFAULT_EDIT_JSON)

    assert result.audio["sample_rate"] == 3
    assert torch.allclose(result.audio["waveform"], source["waveform"])


def test_split_style_clips_can_leave_silence_gap():
    source = audio([1, 2, 3, 4], sample_rate=1)
    edit = project_with_clips([
        clip(source_in=0, source_out=2, timeline_start=0, id="a"),
        clip(source_in=2, source_out=4, timeline_start=3, id="b"),
    ])

    rendered = render_audio_edit(source, edit).audio["waveform"][0, 0]

    assert torch.equal(rendered, torch.tensor([1.0, 2.0, 0.0, 3.0, 4.0]))


def test_reverse_and_gain_are_applied():
    source = audio([1, 2], sample_rate=2)
    edit = project_with_clips([
        clip(source_out=1, reverse=True, gain_db=20 * math.log10(0.5))
    ])

    rendered = render_audio_edit(source, edit).audio["waveform"][0, 0]

    assert torch.allclose(rendered, torch.tensor([1.0, 0.5]), atol=1e-6)


def test_linear_fades_are_applied():
    source = audio([1, 1, 1, 1], sample_rate=4)
    edit = project_with_clips([
        clip(
            source_out=1,
            fade_in={"duration": 0.5, "curve": "linear"},
            fade_out={"duration": 0.5, "curve": "linear"},
        )
    ])

    rendered = render_audio_edit(source, edit).audio["waveform"][0, 0]

    assert torch.allclose(rendered, torch.tensor([0.0, 1.0, 1.0, 0.0]), atol=1e-6)


def test_gain_envelope_interpolates_in_db():
    source = audio([1, 1, 1, 1], sample_rate=4)
    edit = project_with_clips([
        clip(source_out=1, gain_envelope=[{"time": 0.5, "gain_db": -6.020599913}])
    ])

    rendered = render_audio_edit(source, edit).audio["waveform"][0, 0]

    assert rendered[0] == pytest.approx(1.0, abs=1e-5)
    assert rendered[1] == pytest.approx(0.5, abs=1e-4)
    assert rendered[-1] > 0.5


def test_take_comping_uses_explicit_connected_take():
    take1 = audio([1, 1, 1, 1], sample_rate=4)
    take2 = audio([2, 2, 2, 2], sample_rate=4)
    edit = project_with_clips([
        clip("take-1", 0, 0.5, 0, id="a"),
        clip("take-2", 0.5, 1.0, 0.5, id="b"),
    ])

    rendered = render_audio_edit(take1, edit, take_2=take2).audio["waveform"][0, 0]

    assert torch.equal(rendered, torch.tensor([1.0, 1.0, 2.0, 2.0]))


def test_incompatible_take_layout_has_clear_error():
    primary = audio([[1, 2], [1, 2]], sample_rate=2)
    second = audio([1, 2], sample_rate=2)

    with pytest.raises(ValueError, match="channels"):
        collect_sources(primary, take_2=second)


def test_stereo_pan_balance_and_channel_modes():
    source = audio([[1, 1], [1, 1]], sample_rate=2)
    edit = project_with_clips([clip(source_out=1, pan=1.0)], master={"channel_mode": "preserve"})
    rendered = render_audio_edit(source, edit).audio["waveform"][0]
    assert torch.allclose(rendered[0], torch.zeros(2))
    assert torch.allclose(rendered[1], torch.ones(2))

    mono_edit = project_with_clips([clip(source_out=1)], master={"channel_mode": "mono"})
    mono = render_audio_edit(source, mono_edit).audio["waveform"]
    assert mono.shape[1] == 1
    assert torch.allclose(mono[0, 0], torch.ones(2))


def test_peak_normalization_targets_requested_level():
    source = audio([0.25, -0.5], sample_rate=2)
    edit = project_with_clips(
        [clip(source_out=1)],
        master={"normalize": {"enabled": True, "target_peak_dbfs": -6.020599913}},
    )

    rendered = render_audio_edit(source, edit).audio["waveform"]

    assert float(rendered.abs().max()) == pytest.approx(0.5, abs=1e-5)


def test_overlapping_clips_are_summed():
    source = audio([1, 1, 1, 1], sample_rate=4)
    edit = project_with_clips([
        clip(source_in=0, source_out=0.5, timeline_start=0, id="a"),
        clip(source_in=0, source_out=0.5, timeline_start=0.25, id="b"),
    ])

    rendered = render_audio_edit(source, edit).audio["waveform"][0, 0]

    assert torch.equal(rendered, torch.tensor([1.0, 2.0, 1.0]))


def test_muted_clip_preserves_timeline_length_as_silence():
    source = audio([1, 1, 1, 1], sample_rate=4)
    edit = project_with_clips([clip(source_out=1, muted=True)])
    rendered = render_audio_edit(source, edit).audio["waveform"]
    assert rendered.shape[-1] == 4
    assert torch.equal(rendered, torch.zeros_like(rendered))


def test_equal_power_fade_endpoints():
    source = audio([1, 1, 1, 1, 1], sample_rate=5)
    edit = project_with_clips([
        clip(source_out=1, fade_in={"duration": 1, "curve": "equal_power"})
    ])
    rendered = render_audio_edit(source, edit).audio["waveform"][0, 0]
    assert rendered[0] == pytest.approx(0.0, abs=1e-6)
    assert rendered[-1] == pytest.approx(1.0, abs=1e-6)
