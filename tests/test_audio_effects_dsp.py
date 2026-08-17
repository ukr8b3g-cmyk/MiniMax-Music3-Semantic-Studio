import math

import pytest
import torch

from audio_effects_dsp import apply_effect_chain


def effect(effect_type, params=None, enabled=True):
    return {"id": f"fx-{effect_type}", "type": effect_type, "enabled": enabled, "params": params or {}}


def test_gain_and_stereo_width_are_deterministic():
    mono = torch.tensor([[[0.25, -0.25]]], dtype=torch.float32)
    gained = apply_effect_chain(mono, 48000, [effect("gain", {"gain_db": 6.020599913})], owner="Track")
    assert torch.allclose(gained, torch.tensor([[[0.5, -0.5]]]), atol=1e-6)

    stereo = torch.tensor([[[1.0, 0.0], [0.0, 1.0]]], dtype=torch.float32)
    narrowed = apply_effect_chain(stereo, 48000, [effect("stereo_width", {"width_percent": 0})], owner="Track")
    assert torch.allclose(narrowed[0, 0], torch.tensor([0.5, 0.5]), atol=1e-6)
    assert torch.allclose(narrowed[0, 1], torch.tensor([0.5, 0.5]), atol=1e-6)


def test_filters_attenuate_rejection_bands():
    dc = torch.ones((1, 1, 48000), dtype=torch.float32)
    high_passed = apply_effect_chain(dc, 48000, [effect("high_pass", {"cutoff_hz": 120, "slope_db_oct": 24})], owner="Track")
    assert float(high_passed[..., -1000:].abs().mean()) < 1e-3

    alternating = torch.tensor([1.0, -1.0] * 24000, dtype=torch.float32).view(1, 1, -1)
    low_passed = apply_effect_chain(alternating, 48000, [effect("low_pass", {"cutoff_hz": 1000, "slope_db_oct": 24})], owner="Track")
    assert float(low_passed.abs().max()) < 0.1


def test_compressor_reduces_sustained_level_and_limiter_respects_ceiling():
    loud = torch.full((1, 1, 48000), 0.9, dtype=torch.float32)
    compressed = apply_effect_chain(loud, 48000, [effect("compressor", {
        "threshold_db": -12, "ratio": 4, "attack_ms": 10, "release_ms": 100, "makeup_db": 0,
    })], owner="Track")
    assert float(compressed[..., -1000:].abs().mean()) < 0.5

    hot = torch.tensor(([0.2, 2.0, -2.0, 0.5] * 1000), dtype=torch.float32).view(1, 1, -1)
    limited = apply_effect_chain(hot, 48000, [effect("limiter", {
        "input_gain_db": 0, "ceiling_db": -1, "release_ms": 100, "lookahead_ms": 1,
    })], owner="Master")
    ceiling = math.pow(10.0, -1.0 / 20.0)
    assert float(limited.abs().max()) <= ceiling + 1e-6


def test_disabled_effects_are_neutral_and_future_effects_fail_closed():
    source = torch.tensor([[[0.1, 0.2]]], dtype=torch.float32)
    disabled = apply_effect_chain(source, 48000, [effect("gain", {"gain_db": 12}, enabled=False)], owner="Track")
    assert disabled is source

    with pytest.raises(ValueError, match="unsupported effect"):
        apply_effect_chain(source, 48000, [effect("reverb")], owner="Track")
