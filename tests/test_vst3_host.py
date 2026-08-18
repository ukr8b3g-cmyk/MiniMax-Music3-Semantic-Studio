import torch

from vst3_host import apply_effect_chain, apply_vst3_effect, effect_chain_tail_samples


class FakeEffect:
    is_effect = True

    def __init__(self, factor=0.5):
        self.factor = factor
        self.calls = 0

    def __call__(self, audio, sample_rate, buffer_size=8192, reset=True):
        self.calls += 1
        assert sample_rate > 0
        assert buffer_size == 8192
        assert reset is True
        return audio * self.factor


def fake_loader(path, plugin_name):
    assert path.endswith('.vst3')
    assert plugin_name == 'Test FX'
    return FakeEffect(0.5)


def vst_effect(enabled=True):
    return {
        'id': 'vst-1',
        'type': 'vst3',
        'enabled': enabled,
        'params': {
            'path': 'C:/VST3/TestFX.vst3',
            'plugin_name': 'Test FX',
            'name': 'Test FX',
        },
    }


def test_vst3_effect_preserves_shape_device_and_dtype():
    audio = torch.ones((2, 2, 32), dtype=torch.float32)
    result = apply_vst3_effect(audio, 48000, vst_effect(), owner='Track', loader=fake_loader)
    assert result.shape == audio.shape
    assert result.device == audio.device
    assert result.dtype == audio.dtype
    assert torch.allclose(result, audio * 0.5)


def test_disabled_vst3_effect_is_bypassed_without_loading():
    audio = torch.randn((1, 2, 16))

    def should_not_load(path, name):
        raise AssertionError('disabled VST3 must not load')

    result = apply_vst3_effect(audio, 44100, vst_effect(False), owner='Master', loader=should_not_load)
    assert result is audio


def test_mixed_builtin_and_vst3_chain_keeps_rack_order():
    audio = torch.full((1, 1, 8), 0.25)
    effects = [
        {'id': 'gain-1', 'type': 'gain', 'enabled': True, 'params': {'gain_db': 6.020599913}},
        vst_effect(),
        {'id': 'gain-2', 'type': 'gain', 'enabled': True, 'params': {'gain_db': 6.020599913}},
    ]
    result = apply_effect_chain(audio, 48000, effects, owner='Track', vst3_loader=fake_loader)
    # x2 -> x0.5 -> x2 = original x2
    assert torch.allclose(result, torch.full_like(audio, 0.5), atol=1e-5)


def test_builtin_tail_estimation_ignores_unknown_vst3_tail():
    effects = [
        vst_effect(),
        {'id': 'delay', 'type': 'delay', 'enabled': True, 'params': {'delay_ms': 100, 'feedback_percent': 0}},
    ]
    assert effect_chain_tail_samples(effects, 1000) == 100


def test_vst3_rejects_instrument_plugin():
    class FakeInstrument(FakeEffect):
        is_effect = False

    audio = torch.ones((1, 1, 8))
    try:
        apply_vst3_effect(audio, 44100, vst_effect(), owner='Track', loader=lambda *_: FakeInstrument())
    except ValueError as exc:
        assert 'not an audio effect' in str(exc)
    else:
        raise AssertionError('instrument VST3 should be rejected')
