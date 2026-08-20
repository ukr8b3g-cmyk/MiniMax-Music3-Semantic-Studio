from __future__ import annotations

from dataclasses import dataclass
from threading import RLock
from typing import Any

import torch


@dataclass(frozen=True)
class FrozenAudioInfo:
    sample_rate: int
    batch_size: int
    channels: int
    num_samples: int


_CACHE: dict[str, dict[str, Any]] = {}
_LOCK = RLock()


def _cache_key(unique_id: object) -> str:
    key = str(unique_id or "").strip()
    if not key:
        raise ValueError("Capture / Freeze Audio requires a stable ComfyUI node id.")
    return key


def snapshot_audio(audio: dict[str, Any]) -> dict[str, Any]:
    if not isinstance(audio, dict):
        raise ValueError("Capture / Freeze Audio expected an AUDIO value.")

    waveform = audio.get("waveform")
    sample_rate = audio.get("sample_rate")
    if not isinstance(waveform, torch.Tensor):
        raise ValueError("Capture / Freeze Audio expected AUDIO.waveform to be a torch.Tensor.")
    if waveform.ndim != 3:
        raise ValueError("Capture / Freeze Audio expected waveform shape [batch, channels, samples].")

    try:
        sample_rate = int(sample_rate)
    except (TypeError, ValueError) as exc:
        raise ValueError("Capture / Freeze Audio expected a valid integer sample_rate.") from exc
    if sample_rate <= 0:
        raise ValueError("Capture / Freeze Audio expected sample_rate > 0.")

    # Own the buffer and move it off GPU. This prevents the frozen take from
    # retaining generator VRAM and isolates it from in-place downstream edits.
    frozen_waveform = waveform.detach().to(device="cpu").contiguous().clone()
    return {"waveform": frozen_waveform, "sample_rate": sample_rate}


def clone_snapshot(audio: dict[str, Any]) -> dict[str, Any]:
    return {
        "waveform": audio["waveform"].clone(),
        "sample_rate": int(audio["sample_rate"]),
    }


def capture_audio(unique_id: object, audio: dict[str, Any]) -> dict[str, Any]:
    key = _cache_key(unique_id)
    frozen = snapshot_audio(audio)
    with _LOCK:
        _CACHE[key] = frozen
    return clone_snapshot(frozen)


def retrieve_audio(unique_id: object) -> dict[str, Any]:
    key = _cache_key(unique_id)
    with _LOCK:
        frozen = _CACHE.get(key)
        if frozen is None:
            raise RuntimeError(
                "No captured audio is available for this node. Switch Mode to Capture, "
                "queue once to capture the generated take, then switch back to Frozen."
            )
        return clone_snapshot(frozen)


def clear_audio(unique_id: object) -> None:
    key = _cache_key(unique_id)
    with _LOCK:
        _CACHE.pop(key, None)


def clear_all_audio() -> None:
    with _LOCK:
        _CACHE.clear()


def frozen_audio_info(unique_id: object) -> FrozenAudioInfo | None:
    key = _cache_key(unique_id)
    with _LOCK:
        frozen = _CACHE.get(key)
        if frozen is None:
            return None
        waveform = frozen["waveform"]
        return FrozenAudioInfo(
            sample_rate=int(frozen["sample_rate"]),
            batch_size=int(waveform.shape[0]),
            channels=int(waveform.shape[1]),
            num_samples=int(waveform.shape[2]),
        )
