from __future__ import annotations

import math
from functools import lru_cache
from typing import Any

import torch

try:  # Optional acceleration; core editor still loads without torchaudio.
    from torchaudio.functional import lfilter as _torchaudio_lfilter
except Exception:  # pragma: no cover - depends on host environment
    _torchaudio_lfilter = None

SUPPORTED_EFFECTS = frozenset({
    "gain", "compressor", "limiter", "eq3", "high_pass", "low_pass",
    "stereo_width", "reverb", "delay",
})

_DEFAULTS: dict[str, dict[str, Any]] = {
    "gain": {"gain_db": 0.0},
    "compressor": {
        "threshold_db": -18.0,
        "ratio": 4.0,
        "attack_ms": 10.0,
        "release_ms": 80.0,
        "makeup_db": 0.0,
    },
    "limiter": {
        "input_gain_db": 0.0,
        "ceiling_db": -1.0,
        "release_ms": 100.0,
        "lookahead_ms": 1.0,
    },
    "eq3": {"low_db": 0.0, "mid_db": 0.0, "high_db": 0.0},
    "high_pass": {"cutoff_hz": 120.0, "slope_db_oct": 24.0},
    "low_pass": {"cutoff_hz": 16000.0, "slope_db_oct": 24.0},
    "stereo_width": {"width_percent": 100.0},
    "reverb": {
        "room_size": 75.0,
        "pre_delay_ms": 10.0,
        "reverberance": 50.0,
        "damping": 50.0,
        "tone_low": 100.0,
        "tone_high": 100.0,
        "wet_db": -1.0,
        "dry_db": -1.0,
        "wet_only": False,
    },
    "delay": {
        "delay_ms": 350.0,
        "feedback_percent": 35.0,
        "wet_db": -6.0,
        "dry_db": 0.0,
        "ping_pong": False,
    },
}

# STK FreeVerb delay tuning (MIT, Perry R. Cook / Gary P. Scavone; port by
# Gregory Burlet). We reuse only the established delay-spacing idea here; the
# renderer below is a deterministic Schroeder-style implementation tailored to
# offline Music3 editing rather than a source copy of STK FreeVerb.
_REVERB_COMB_DELAYS_44K = (1617, 1557, 1491, 1422, 1356, 1277, 1188, 1116)
_REVERB_COMB_SIGNS = (1.0, -1.0, 1.0, 1.0, -1.0, 1.0, -1.0, 1.0)
_REVERB_STEREO_SPREAD_44K = 23
_MAX_REVERB_TAIL_SECONDS = 12.0
_MAX_DELAY_TAIL_SECONDS = 30.0
_MAX_CHAIN_TAIL_SECONDS = 45.0
_REVERB_INPUT_SCALE = 0.12
_REVERB_EARLY_FRACTIONS = (0.17, 0.29, 0.43, 0.61, 0.79)
_REVERB_EARLY_GAINS = (0.26, -0.20, 0.16, -0.13, 0.10)


def _clamp(value: Any, minimum: float, maximum: float, fallback: float) -> float:
    try:
        number = float(value)
    except (TypeError, ValueError):
        number = fallback
    if not math.isfinite(number):
        number = fallback
    return max(minimum, min(maximum, number))


def _param(effect: dict[str, Any], key: str, minimum: float, maximum: float) -> float:
    effect_type = str(effect.get("type") or "")
    fallback = float(_DEFAULTS.get(effect_type, {}).get(key, 0.0))
    return _clamp((effect.get("params") or {}).get(key), minimum, maximum, fallback)


def _bool_param(effect: dict[str, Any], key: str) -> bool:
    effect_type = str(effect.get("type") or "")
    fallback = bool(_DEFAULTS.get(effect_type, {}).get(key, False))
    value = (effect.get("params") or {}).get(key, fallback)
    return bool(value)


def _db_to_amp(db: float) -> float:
    return math.pow(10.0, float(db) / 20.0)


def _reverb_decay_seconds(effect: dict[str, Any]) -> float:
    reverberance = _param(effect, "reverberance", 0.0, 100.0) / 100.0
    # Perceptually useful nonlinear range: short ambience at 0%, long hall at 100%.
    return 0.35 + math.pow(reverberance, 1.55) * (_MAX_REVERB_TAIL_SECONDS - 0.35)


def effect_tail_samples(effect: Any, sample_rate: int) -> int:
    if not isinstance(effect, dict) or effect.get("enabled", True) is False:
        return 0
    sample_rate = max(1, int(sample_rate))
    effect_type = str(effect.get("type") or "")
    if effect_type == "reverb":
        pre_delay = _param(effect, "pre_delay_ms", 0.0, 200.0) / 1000.0
        seconds = min(_MAX_REVERB_TAIL_SECONDS + 0.2, pre_delay + _reverb_decay_seconds(effect))
        return max(1, int(math.ceil(seconds * sample_rate)))
    if effect_type == "delay":
        delay_seconds = _param(effect, "delay_ms", 10.0, 2000.0) / 1000.0
        feedback = _param(effect, "feedback_percent", 0.0, 90.0) / 100.0
        if feedback <= 1e-9:
            repeats = 1
        else:
            # Stop when the repeat envelope has fallen below -60 dB (0.001 amplitude).
            repeats = max(1, int(math.ceil(math.log(0.001) / math.log(feedback))) + 1)
        seconds = min(_MAX_DELAY_TAIL_SECONDS, delay_seconds * repeats)
        return max(1, int(math.ceil(seconds * sample_rate)))
    return 0


def effect_chain_tail_samples(effects: Any, sample_rate: int) -> int:
    if not isinstance(effects, list):
        return 0
    limit = max(1, int(math.ceil(_MAX_CHAIN_TAIL_SECONDS * max(1, int(sample_rate)))))
    total = 0
    for effect in effects:
        total += effect_tail_samples(effect, sample_rate)
        if total >= limit:
            return limit
    return total


def _normalized_biquad(
    kind: str,
    sample_rate: int,
    frequency: float,
    *,
    q: float = 1 / math.sqrt(2),
    gain_db: float = 0.0,
) -> tuple[float, float, float, float, float]:
    nyquist = max(1.0, sample_rate / 2.0)
    frequency = max(5.0, min(nyquist * 0.95, float(frequency)))
    omega = 2.0 * math.pi * frequency / sample_rate
    cos_w = math.cos(omega)
    sin_w = math.sin(omega)
    alpha = sin_w / (2.0 * max(0.05, q))

    if kind == "low_pass":
        b0 = (1.0 - cos_w) / 2.0
        b1 = 1.0 - cos_w
        b2 = b0
        a0 = 1.0 + alpha
        a1 = -2.0 * cos_w
        a2 = 1.0 - alpha
    elif kind == "high_pass":
        b0 = (1.0 + cos_w) / 2.0
        b1 = -(1.0 + cos_w)
        b2 = b0
        a0 = 1.0 + alpha
        a1 = -2.0 * cos_w
        a2 = 1.0 - alpha
    elif kind == "peaking":
        amp = math.pow(10.0, gain_db / 40.0)
        b0 = 1.0 + alpha * amp
        b1 = -2.0 * cos_w
        b2 = 1.0 - alpha * amp
        a0 = 1.0 + alpha / amp
        a1 = -2.0 * cos_w
        a2 = 1.0 - alpha / amp
    elif kind in {"low_shelf", "high_shelf"}:
        amp = math.pow(10.0, gain_db / 40.0)
        shelf_alpha = sin_w / 2.0 * math.sqrt(2.0)
        beta = 2.0 * math.sqrt(amp) * shelf_alpha
        if kind == "low_shelf":
            b0 = amp * ((amp + 1.0) - (amp - 1.0) * cos_w + beta)
            b1 = 2.0 * amp * ((amp - 1.0) - (amp + 1.0) * cos_w)
            b2 = amp * ((amp + 1.0) - (amp - 1.0) * cos_w - beta)
            a0 = (amp + 1.0) + (amp - 1.0) * cos_w + beta
            a1 = -2.0 * ((amp - 1.0) + (amp + 1.0) * cos_w)
            a2 = (amp + 1.0) + (amp - 1.0) * cos_w - beta
        else:
            b0 = amp * ((amp + 1.0) + (amp - 1.0) * cos_w + beta)
            b1 = -2.0 * amp * ((amp - 1.0) + (amp + 1.0) * cos_w)
            b2 = amp * ((amp + 1.0) + (amp - 1.0) * cos_w - beta)
            a0 = (amp + 1.0) - (amp - 1.0) * cos_w + beta
            a1 = 2.0 * ((amp - 1.0) - (amp + 1.0) * cos_w)
            a2 = (amp + 1.0) - (amp - 1.0) * cos_w - beta
    else:
        raise ValueError(f"Unknown biquad kind: {kind}")

    return b0 / a0, b1 / a0, b2 / a0, a1 / a0, a2 / a0


def _lfilter_fallback(
    waveform: torch.Tensor,
    coeffs: tuple[float, float, float, float, float],
) -> torch.Tensor:
    b0, b1, b2, a1, a2 = coeffs
    out = torch.empty_like(waveform)
    state_shape = waveform.shape[:-1]
    x1 = torch.zeros(state_shape, device=waveform.device, dtype=waveform.dtype)
    x2 = torch.zeros_like(x1)
    y1 = torch.zeros_like(x1)
    y2 = torch.zeros_like(x1)
    for index in range(waveform.shape[-1]):
        x0 = waveform[..., index]
        y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2
        out[..., index] = y0
        x2, x1 = x1, x0
        y2, y1 = y1, y0
    return out


def _apply_biquad(
    waveform: torch.Tensor,
    coeffs: tuple[float, float, float, float, float],
) -> torch.Tensor:
    b0, b1, b2, a1, a2 = coeffs
    if _torchaudio_lfilter is None:
        return _lfilter_fallback(waveform, coeffs)
    a = torch.tensor([1.0, a1, a2], device=waveform.device, dtype=waveform.dtype)
    b = torch.tensor([b0, b1, b2], device=waveform.device, dtype=waveform.dtype)
    return _torchaudio_lfilter(waveform, a, b, clamp=False)


def _apply_filter(
    waveform: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
    kind: str,
) -> torch.Tensor:
    cutoff = _param(effect, "cutoff_hz", 20.0, max(20.0, sample_rate * 0.475))
    slope = int(round(_param(effect, "slope_db_oct", 12.0, 48.0) / 12.0) * 12)
    stages = max(1, min(4, slope // 12))
    result = waveform
    coeffs = _normalized_biquad(kind, sample_rate, cutoff)
    for _ in range(stages):
        result = _apply_biquad(result, coeffs)
    return result


def _apply_eq3(
    waveform: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
) -> torch.Tensor:
    low = _param(effect, "low_db", -12.0, 12.0)
    mid = _param(effect, "mid_db", -12.0, 12.0)
    high = _param(effect, "high_db", -12.0, 12.0)
    result = waveform
    if abs(low) > 1e-9:
        result = _apply_biquad(
            result,
            _normalized_biquad(
                "low_shelf", sample_rate, min(200.0, sample_rate * 0.18), gain_db=low
            ),
        )
    if abs(mid) > 1e-9:
        result = _apply_biquad(
            result,
            _normalized_biquad(
                "peaking", sample_rate, min(1000.0, sample_rate * 0.28), q=0.8, gain_db=mid
            ),
        )
    if abs(high) > 1e-9:
        result = _apply_biquad(
            result,
            _normalized_biquad(
                "high_shelf", sample_rate, min(5000.0, sample_rate * 0.40), gain_db=high
            ),
        )
    return result


def _block_peaks(waveform: torch.Tensor, block_size: int) -> torch.Tensor:
    length = waveform.shape[-1]
    blocks = max(1, math.ceil(length / block_size))
    padded = blocks * block_size
    if padded != length:
        waveform = torch.nn.functional.pad(waveform, (0, padded - length))
    return waveform.abs().reshape(
        waveform.shape[0], waveform.shape[1], blocks, block_size
    ).amax(dim=(1, 3))


def _expand_block_gains(
    gains: list[list[float]],
    block_size: int,
    length: int,
    device: torch.device,
    dtype: torch.dtype,
) -> torch.Tensor:
    tensor = torch.tensor(gains, device=device, dtype=dtype)
    return tensor.repeat_interleave(block_size, dim=1)[:, :length].unsqueeze(1)


def _apply_compressor(
    waveform: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
) -> torch.Tensor:
    threshold = _param(effect, "threshold_db", -60.0, 0.0)
    ratio = _param(effect, "ratio", 1.0, 20.0)
    attack_ms = _param(effect, "attack_ms", 1.0, 200.0)
    release_ms = _param(effect, "release_ms", 10.0, 1000.0)
    makeup_db = _param(effect, "makeup_db", 0.0, 24.0)
    block_size = max(1, round(sample_rate * 0.002))
    block_seconds = block_size / sample_rate
    attack = math.exp(-block_seconds / max(attack_ms / 1000.0, 1e-6))
    release = math.exp(-block_seconds / max(release_ms / 1000.0, 1e-6))
    peaks = _block_peaks(waveform, block_size).detach().float().cpu().tolist()
    gain_rows: list[list[float]] = []
    for row in peaks:
        current_db = 0.0
        values: list[float] = []
        for peak in row:
            level_db = 20.0 * math.log10(max(float(peak), 1e-12))
            over = max(0.0, level_db - threshold)
            desired_db = -(over - over / ratio) if over > 0.0 else 0.0
            coeff = attack if desired_db < current_db else release
            current_db = coeff * current_db + (1.0 - coeff) * desired_db
            values.append(_db_to_amp(current_db + makeup_db))
        gain_rows.append(values)
    gain = _expand_block_gains(
        gain_rows, block_size, waveform.shape[-1], waveform.device, waveform.dtype
    )
    return waveform * gain


def _future_peak_blocks(peaks: torch.Tensor, lookahead_blocks: int) -> torch.Tensor:
    result = peaks.clone()
    for shift in range(1, lookahead_blocks + 1):
        shifted = torch.nn.functional.pad(peaks[:, shift:], (0, shift))
        result = torch.maximum(result, shifted)
    return result


def _apply_limiter(
    waveform: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
) -> torch.Tensor:
    input_gain_db = _param(effect, "input_gain_db", 0.0, 24.0)
    ceiling_db = _param(effect, "ceiling_db", -20.0, 0.0)
    release_ms = _param(effect, "release_ms", 10.0, 1000.0)
    lookahead_ms = _param(effect, "lookahead_ms", 0.0, 10.0)
    driven = waveform * _db_to_amp(input_gain_db)
    block_size = max(1, round(sample_rate * 0.001))
    block_ms = block_size / sample_rate * 1000.0
    lookahead_blocks = max(
        0, min(12, math.ceil(lookahead_ms / max(block_ms, 1e-6)))
    )
    peaks = _block_peaks(driven, block_size)
    future = _future_peak_blocks(peaks, lookahead_blocks).detach().float().cpu().tolist()
    ceiling_amp = _db_to_amp(ceiling_db)
    release = math.exp(
        -(block_size / sample_rate) / max(release_ms / 1000.0, 1e-6)
    )
    gain_rows: list[list[float]] = []
    for row in future:
        current = 1.0
        values: list[float] = []
        for peak in row:
            desired = min(1.0, ceiling_amp / max(float(peak), 1e-12))
            if desired < current:
                current = desired
            else:
                current = release * current + (1.0 - release) * desired
            values.append(current)
        gain_rows.append(values)
    gain = _expand_block_gains(
        gain_rows, block_size, driven.shape[-1], driven.device, driven.dtype
    )
    limited = driven * gain
    return torch.clamp(limited, min=-ceiling_amp, max=ceiling_amp)


def _apply_stereo_width(
    waveform: torch.Tensor,
    effect: dict[str, Any],
) -> torch.Tensor:
    if waveform.shape[1] < 2:
        return waveform
    width = _param(effect, "width_percent", 0.0, 200.0) / 100.0
    left = waveform[:, 0]
    right = waveform[:, 1]
    mid = (left + right) * 0.5
    side = (left - right) * 0.5 * width
    result = waveform.clone()
    result[:, 0] = mid + side
    result[:, 1] = mid - side
    return result


def _apply_delay(
    waveform: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
) -> torch.Tensor:
    delay_samples = max(1, int(round(sample_rate * _param(effect, "delay_ms", 10.0, 2000.0) / 1000.0)))
    feedback = _param(effect, "feedback_percent", 0.0, 90.0) / 100.0
    wet_gain = _db_to_amp(_param(effect, "wet_db", -60.0, 6.0))
    dry_gain = _db_to_amp(_param(effect, "dry_db", -60.0, 6.0))
    ping_pong = _bool_param(effect, "ping_pong") and waveform.shape[1] >= 2

    wet = torch.zeros_like(waveform)
    length = waveform.shape[-1]
    for start in range(delay_samples, length, delay_samples):
        end = min(length, start + delay_samples)
        previous_start = start - delay_samples
        previous_end = previous_start + (end - start)
        if ping_pong:
            wet[:, 0, start:end] = (
                waveform[:, 1, previous_start:previous_end]
                + feedback * wet[:, 1, previous_start:previous_end]
            )
            wet[:, 1, start:end] = (
                waveform[:, 0, previous_start:previous_end]
                + feedback * wet[:, 0, previous_start:previous_end]
            )
        else:
            wet[..., start:end] = (
                waveform[..., previous_start:previous_end]
                + feedback * wet[..., previous_start:previous_end]
            )
    return waveform * dry_gain + wet * wet_gain


def _reverb_room_scale(room_size: float) -> float:
    return 0.65 + (room_size / 100.0) * 0.85


def _reverb_damping_cutoff(sample_rate: int, damping: float) -> float:
    # 0% damping -> nearly open; 100% -> dark room around 2.4 kHz at 48 kHz.
    nyquist_safe = sample_rate * 0.45
    open_hz = min(18000.0, nyquist_safe)
    dark_hz = min(2400.0, nyquist_safe)
    return max(40.0, open_hz * math.pow(max(dark_hz / max(open_hz, 1.0), 1e-4), damping / 100.0))


def _reverb_tone_gain(percent: float) -> float:
    # Existing UI uses 100% as neutral. Lower values progressively attenuate the band.
    return -12.0 * (1.0 - percent / 100.0)


@lru_cache(maxsize=24)
def _cached_reverb_ir(
    sample_rate: int,
    room_size_q: int,
    pre_delay_q: int,
    reverberance_q: int,
) -> torch.Tensor:
    sample_rate = max(1, int(sample_rate))
    room_size = room_size_q / 100.0
    pre_delay_ms = pre_delay_q / 100.0
    reverberance = reverberance_q / 100.0
    effect = {
        "type": "reverb",
        "enabled": True,
        "params": {
            "room_size": room_size,
            "pre_delay_ms": pre_delay_ms,
            "reverberance": reverberance,
        },
    }
    tail_samples = effect_tail_samples(effect, sample_rate)
    decay_samples = max(1, int(round(_reverb_decay_seconds(effect) * sample_rate)))
    pre_delay_samples = max(0, int(round(pre_delay_ms * sample_rate / 1000.0)))
    room_scale = _reverb_room_scale(room_size)
    fs_scale = sample_rate / 44100.0
    spread = max(1, int(round(_REVERB_STEREO_SPREAD_44K * fs_scale * room_scale)))

    ir = torch.zeros((2, tail_samples + 1), dtype=torch.float32)

    # Deterministic early reflections inspired by compact FDN/room designs.
    early_span = max(1, int(round(sample_rate * (0.012 + 0.085 * room_size / 100.0))))
    for index, (fraction, gain) in enumerate(zip(_REVERB_EARLY_FRACTIONS, _REVERB_EARLY_GAINS)):
        position = pre_delay_samples + max(1, int(round(early_span * fraction)))
        if position <= tail_samples:
            left_gain = gain * (1.0 if index % 2 == 0 else 0.72)
            right_gain = gain * (0.72 if index % 2 == 0 else 1.0)
            ir[0, position] += left_gain
            ir[1, position] += right_gain

    # Parallel feedback-comb impulse trains. Delay lengths reuse STK FreeVerb's
    # proven spacing; feedback is derived directly from the requested -60 dB decay.
    for comb_index, base_delay in enumerate(_REVERB_COMB_DELAYS_44K):
        delay_l = max(1, int(round(base_delay * fs_scale * room_scale)))
        delay_r = max(1, delay_l + spread)
        sign = _REVERB_COMB_SIGNS[comb_index]
        for channel, delay in ((0, delay_l), (1, delay_r)):
            feedback = math.pow(0.001, delay / decay_samples)
            amplitude = _REVERB_INPUT_SCALE * sign
            position = pre_delay_samples + delay
            while position <= tail_samples and abs(amplitude) > 1e-5:
                ir[channel, position] += amplitude
                amplitude *= feedback
                position += delay

    # Keep wet level predictable across room/decay settings without normalizing away
    # their tonal shape. RMS-energy normalization is deterministic and mild.
    energy = torch.sqrt(torch.clamp(ir.square().sum(dim=1, keepdim=True), min=1e-12))
    ir = ir * (0.45 / energy)
    return ir


def _reverb_ir(sample_rate: int, effect: dict[str, Any]) -> torch.Tensor:
    room_size = _param(effect, "room_size", 0.0, 100.0)
    pre_delay = _param(effect, "pre_delay_ms", 0.0, 200.0)
    reverberance = _param(effect, "reverberance", 0.0, 100.0)
    # Quantization exactly matches UI precision and keeps the cache bounded.
    return _cached_reverb_ir(
        int(sample_rate),
        int(round(room_size * 100.0)),
        int(round(pre_delay * 100.0)),
        int(round(reverberance * 100.0)),
    )


def _next_power_of_two(value: int) -> int:
    return 1 << max(0, int(value - 1).bit_length())


def _fft_convolve_truncated(signal: torch.Tensor, impulse: torch.Tensor, length: int) -> torch.Tensor:
    """Linear convolution for [batch, samples], truncated to ``length`` samples."""
    if signal.ndim != 2:
        raise ValueError("FFT reverb source must have shape [batch, samples].")
    length = max(0, min(int(length), signal.shape[-1]))
    if length == 0 or impulse.numel() == 0:
        return torch.zeros((signal.shape[0], length), device=signal.device, dtype=signal.dtype)

    work = signal.float()
    ir = impulse.to(device=signal.device, dtype=torch.float32)
    ir_length = int(ir.numel())
    # Large blocks amortize FFT cost for multi-minute songs while keeping peak
    # working memory bounded even with long reverb tails.
    target_block = max(262144, _next_power_of_two(ir_length))
    block_size = min(max(1, work.shape[-1]), min(target_block, 1048576))
    fft_size = _next_power_of_two(block_size + ir_length - 1)
    ir_fft = torch.fft.rfft(ir, n=fft_size)
    output = torch.zeros(
        (work.shape[0], min(work.shape[-1] + ir_length - 1, length + ir_length - 1)),
        device=work.device,
        dtype=torch.float32,
    )

    for start in range(0, work.shape[-1], block_size):
        chunk = work[:, start : start + block_size]
        chunk_length = chunk.shape[-1]
        spectrum = torch.fft.rfft(chunk, n=fft_size)
        convolved = torch.fft.irfft(spectrum * ir_fft, n=fft_size)[
            :, : chunk_length + ir_length - 1
        ]
        end = min(output.shape[-1], start + convolved.shape[-1])
        if end > start:
            output[:, start:end] += convolved[:, : end - start]

    return output[:, :length].to(dtype=signal.dtype)


def _apply_reverb_tone(
    wet: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
) -> torch.Tensor:
    damping = _param(effect, "damping", 0.0, 100.0)
    tone_low = _param(effect, "tone_low", 0.0, 100.0)
    tone_high = _param(effect, "tone_high", 0.0, 100.0)
    result = wet
    cutoff = _reverb_damping_cutoff(sample_rate, damping)
    if cutoff < sample_rate * 0.44:
        result = _apply_biquad(result, _normalized_biquad("low_pass", sample_rate, cutoff, q=0.707))
    low_gain = _reverb_tone_gain(tone_low)
    high_gain = _reverb_tone_gain(tone_high)
    if abs(low_gain) > 1e-9:
        result = _apply_biquad(
            result,
            _normalized_biquad("low_shelf", sample_rate, min(250.0, sample_rate * 0.18), gain_db=low_gain),
        )
    if abs(high_gain) > 1e-9:
        result = _apply_biquad(
            result,
            _normalized_biquad("high_shelf", sample_rate, min(6000.0, sample_rate * 0.40), gain_db=high_gain),
        )
    return result


def _apply_reverb(
    waveform: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
) -> torch.Tensor:
    impulse = _reverb_ir(sample_rate, effect)
    mono_source = waveform.mean(dim=1)
    length = waveform.shape[-1]
    wet_left = _fft_convolve_truncated(mono_source, impulse[0], length)
    wet_right = _fft_convolve_truncated(mono_source, impulse[1], length)
    if waveform.shape[1] == 1:
        wet = ((wet_left + wet_right) * 0.5).unsqueeze(1)
    else:
        wet = torch.stack((wet_left, wet_right), dim=1)
    wet = _apply_reverb_tone(wet, sample_rate, effect)

    wet_gain = _db_to_amp(_param(effect, "wet_db", -24.0, 6.0))
    dry_gain = 0.0 if _bool_param(effect, "wet_only") else _db_to_amp(_param(effect, "dry_db", -24.0, 6.0))
    return waveform * dry_gain + wet * wet_gain


def apply_effect_chain(
    waveform: torch.Tensor,
    sample_rate: int,
    effects: Any,
    *,
    owner: str,
) -> torch.Tensor:
    result = waveform
    for raw in effects if isinstance(effects, list) else []:
        if not isinstance(raw, dict) or raw.get("enabled", True) is False:
            continue
        effect_type = str(raw.get("type") or "")
        if effect_type not in SUPPORTED_EFFECTS:
            label = effect_type or str(raw.get("id") or "unknown")
            print(
                f"[MiniMax Music3 Semantic Studio] {owner}: bypassing unsupported effect {label!r}."
            )
            continue
        if effect_type == "gain":
            result = result * _db_to_amp(_param(raw, "gain_db", -24.0, 24.0))
        elif effect_type == "high_pass":
            result = _apply_filter(result, sample_rate, raw, "high_pass")
        elif effect_type == "low_pass":
            result = _apply_filter(result, sample_rate, raw, "low_pass")
        elif effect_type == "eq3":
            result = _apply_eq3(result, sample_rate, raw)
        elif effect_type == "compressor":
            result = _apply_compressor(result, sample_rate, raw)
        elif effect_type == "limiter":
            result = _apply_limiter(result, sample_rate, raw)
        elif effect_type == "stereo_width":
            result = _apply_stereo_width(result, raw)
        elif effect_type == "delay":
            result = _apply_delay(result, sample_rate, raw)
        elif effect_type == "reverb":
            result = _apply_reverb(result, sample_rate, raw)
    return result
