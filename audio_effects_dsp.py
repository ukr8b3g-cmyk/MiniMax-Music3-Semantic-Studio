from __future__ import annotations

import math
from typing import Any

import torch

try:  # Optional acceleration; core editor still loads without torchaudio.
    from torchaudio.functional import lfilter as _torchaudio_lfilter
except Exception:  # pragma: no cover - depends on host environment
    _torchaudio_lfilter = None

SUPPORTED_EFFECTS = frozenset({
    "gain", "compressor", "limiter", "eq3", "high_pass", "low_pass", "stereo_width"
})

_DEFAULTS: dict[str, dict[str, float]] = {
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
}


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
    fallback = _DEFAULTS.get(effect_type, {}).get(key, 0.0)
    return _clamp((effect.get("params") or {}).get(key), minimum, maximum, fallback)


def _db_to_amp(db: float) -> float:
    return math.pow(10.0, float(db) / 20.0)


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
            raise ValueError(
                f"{owner} has enabled unsupported effect {label!r}; "
                "V2.1-B supports Gain, Filters, EQ, Compressor, Limiter, and Stereo Width."
            )
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
    return result
