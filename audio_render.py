from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Any

import torch

try:
    from .audio_edit_project import SourceInfo, normalize_edit_project, project_timeline_duration
    from .vst3_host import apply_effect_chain, effect_chain_tail_samples
except ImportError:  # Allows pure-module tests outside ComfyUI package loading.
    from audio_edit_project import SourceInfo, normalize_edit_project, project_timeline_duration
    from vst3_host import apply_effect_chain, effect_chain_tail_samples


@dataclass(frozen=True)
class RenderResult:
    audio: dict[str, Any]
    project: dict[str, Any]
    sources: tuple[SourceInfo, ...]


def _normalize_waveform_shape(waveform: torch.Tensor, label: str) -> torch.Tensor:
    if not isinstance(waveform, torch.Tensor):
        raise ValueError(f"{label} waveform must be a torch.Tensor.")
    if waveform.ndim == 2:
        waveform = waveform.unsqueeze(0)
    if waveform.ndim != 3:
        raise ValueError(
            f"{label} waveform must have shape [batch, channels, samples]; got {tuple(waveform.shape)}."
        )
    if waveform.shape[0] < 1 or waveform.shape[1] < 1 or waveform.shape[2] < 1:
        raise ValueError(f"{label} waveform has an empty batch, channel, or sample dimension.")
    if waveform.shape[1] > 2:
        raise ValueError(
            f"{label} has {waveform.shape[1]} channels. V2 supports mono or stereo AUDIO only."
        )
    if not waveform.dtype.is_floating_point:
        waveform = waveform.float()
    return waveform


def _audio_to_source(audio: Any, source_id: str, input_name: str, display_name: str) -> tuple[dict[str, Any], SourceInfo]:
    if not isinstance(audio, dict):
        raise ValueError(f"{display_name} must be a ComfyUI AUDIO object.")
    if "waveform" not in audio or "sample_rate" not in audio:
        raise ValueError(f"{display_name} must contain waveform and sample_rate.")
    waveform = _normalize_waveform_shape(audio["waveform"], display_name)
    try:
        sample_rate = int(audio["sample_rate"])
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{display_name} sample_rate must be a positive integer.") from exc
    if sample_rate <= 0:
        raise ValueError(f"{display_name} sample_rate must be a positive integer.")
    info = SourceInfo(
        id=source_id,
        input_name=input_name,
        name=display_name,
        sample_rate=sample_rate,
        batch_size=int(waveform.shape[0]),
        channels=int(waveform.shape[1]),
        num_samples=int(waveform.shape[2]),
        duration=float(waveform.shape[2] / sample_rate),
    )
    return {"waveform": waveform, "sample_rate": sample_rate}, info


def collect_sources(
    audio: Any,
    take_2: Any = None,
    take_3: Any = None,
    take_4: Any = None,
) -> tuple[dict[str, dict[str, Any]], tuple[SourceInfo, ...]]:
    connected = [
        ("take-1", "audio", "Take 1", audio),
        ("take-2", "take_2", "Take 2", take_2),
        ("take-3", "take_3", "Take 3", take_3),
        ("take-4", "take_4", "Take 4", take_4),
    ]
    sources: dict[str, dict[str, Any]] = {}
    infos: list[SourceInfo] = []
    for source_id, input_name, display_name, value in connected:
        if value is None:
            continue
        source, info = _audio_to_source(value, source_id, input_name, display_name)
        sources[source_id] = source
        infos.append(info)

    if not infos or infos[0].id != "take-1":
        raise ValueError("Music3 Semantic Studio Audio Editor requires the primary audio input.")

    primary = infos[0]
    for info in infos[1:]:
        mismatches: list[str] = []
        if info.sample_rate != primary.sample_rate:
            mismatches.append(f"sample rate {info.sample_rate} != {primary.sample_rate}")
        if info.batch_size != primary.batch_size:
            mismatches.append(f"batch {info.batch_size} != {primary.batch_size}")
        if info.channels != primary.channels:
            mismatches.append(f"channels {info.channels} != {primary.channels}")
        if mismatches:
            raise ValueError(
                f"{info.name} is incompatible with Take 1: " + ", ".join(mismatches) + "."
            )

    primary_waveform = sources["take-1"]["waveform"]
    for source_id, source in sources.items():
        if source_id == "take-1":
            continue
        source["waveform"] = source["waveform"].to(
            device=primary_waveform.device,
            dtype=primary_waveform.dtype,
        )
    return sources, tuple(infos)


def _seconds_to_sample(seconds: float, sample_rate: int) -> int:
    return max(0, int(round(float(seconds) * sample_rate)))


def _db_to_amplitude(db: float, *, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    value = math.pow(10.0, float(db) / 20.0)
    return torch.tensor(value, device=device, dtype=dtype)


def _fade_curve(length: int, fade_in: bool, curve: str, device: torch.device, dtype: torch.dtype) -> torch.Tensor:
    if length <= 0:
        return torch.empty((0,), device=device, dtype=dtype)
    if length == 1:
        return torch.ones((1,), device=device, dtype=dtype) if fade_in else torch.zeros((1,), device=device, dtype=dtype)
    x = torch.linspace(0.0, 1.0, length, device=device, dtype=torch.float32)
    if curve == "equal_power":
        values = torch.sin(x * (math.pi / 2.0)) if fade_in else torch.cos(x * (math.pi / 2.0))
    else:
        values = x if fade_in else 1.0 - x
    return values.to(dtype=dtype)


def _envelope_amplitude(
    num_samples: int,
    sample_rate: int,
    points: list[dict[str, float]],
    device: torch.device,
    dtype: torch.dtype,
    *,
    zero_anchors: bool,
) -> torch.Tensor | None:
    if not points or num_samples <= 0:
        return None

    duration = num_samples / sample_rate
    normalized: list[dict[str, float]] = []
    if zero_anchors:
        normalized.append({"time": 0.0, "gain_db": 0.0})
    normalized.extend(points)
    if zero_anchors:
        normalized.append({"time": duration, "gain_db": 0.0})

    deduped: dict[float, float] = {}
    for point in normalized:
        time = max(0.0, min(duration, float(point["time"])))
        deduped[round(time, 9)] = float(point["gain_db"])
    ordered = sorted(deduped.items())
    if not ordered:
        return None

    envelope_db = torch.empty((num_samples,), device=device, dtype=torch.float32)
    if len(ordered) == 1:
        envelope_db.fill_(ordered[0][1])
    else:
        first_sample = min(num_samples, _seconds_to_sample(ordered[0][0], sample_rate))
        if first_sample > 0:
            envelope_db[:first_sample] = ordered[0][1]

        for index in range(len(ordered) - 1):
            start_t, start_db = ordered[index]
            end_t, end_db = ordered[index + 1]
            start = min(num_samples, _seconds_to_sample(start_t, sample_rate))
            end = min(num_samples, _seconds_to_sample(end_t, sample_rate))
            if end <= start:
                continue
            envelope_db[start:end] = torch.linspace(
                start_db,
                end_db,
                end - start,
                device=device,
                dtype=torch.float32,
            )

        last_sample = min(num_samples, _seconds_to_sample(ordered[-1][0], sample_rate))
        if last_sample < num_samples:
            envelope_db[last_sample:] = ordered[-1][1]

    return torch.pow(torch.tensor(10.0, device=device), envelope_db / 20.0).to(dtype=dtype)


def _apply_pan_balance(waveform: torch.Tensor, pan: float) -> torch.Tensor:
    if abs(pan) < 1e-9 or waveform.shape[1] < 2:
        return waveform

    gains = torch.ones(
        (1, waveform.shape[1], 1),
        device=waveform.device,
        dtype=waveform.dtype,
    )
    if pan > 0:
        gains[:, 0, :] = 1.0 - pan
    else:
        gains[:, 1, :] = 1.0 + pan
    return waveform * gains


def _render_clip(
    source: dict[str, Any],
    clip: dict[str, Any],
    sample_rate: int,
) -> torch.Tensor:
    waveform = source["waveform"]
    start = min(waveform.shape[-1], _seconds_to_sample(clip["source_in"], sample_rate))
    end = min(waveform.shape[-1], _seconds_to_sample(clip["source_out"], sample_rate))
    if end <= start:
        raise ValueError(f"Clip {clip['id']!r} resolves to an empty source sample range.")

    # Keep neutral clips as a view of the immutable source. Allocate a new full-size
    # tensor only when an edit actually requires it; never clone the connected AUDIO.
    rendered = waveform[..., start:end]
    if clip["reverse"]:
        rendered = torch.flip(rendered, dims=(-1,))

    control: torch.Tensor | None = None
    gain_db = float(clip["gain_db"])
    envelope = _envelope_amplitude(
        rendered.shape[-1],
        sample_rate,
        clip["gain_envelope"],
        rendered.device,
        rendered.dtype,
        zero_anchors=True,
    )
    fade_in_samples = min(rendered.shape[-1], _seconds_to_sample(clip["fade_in"]["duration"], sample_rate))
    fade_out_samples = min(rendered.shape[-1], _seconds_to_sample(clip["fade_out"]["duration"], sample_rate))

    if abs(gain_db) >= 1e-9 or envelope is not None or fade_in_samples > 0 or fade_out_samples > 0:
        control = torch.ones((rendered.shape[-1],), device=rendered.device, dtype=rendered.dtype)
        if abs(gain_db) >= 1e-9:
            control *= _db_to_amplitude(gain_db, device=rendered.device, dtype=rendered.dtype)
        if envelope is not None:
            control *= envelope
        if fade_in_samples > 0:
            control[:fade_in_samples] *= _fade_curve(
                fade_in_samples,
                True,
                clip["fade_in"]["curve"],
                rendered.device,
                rendered.dtype,
            )
        if fade_out_samples > 0:
            control[-fade_out_samples:] *= _fade_curve(
                fade_out_samples,
                False,
                clip["fade_out"]["curve"],
                rendered.device,
                rendered.dtype,
            )
        rendered = rendered * control.view(1, 1, -1)

    return _apply_pan_balance(rendered, clip["pan"])


def _render_track(
    track: dict[str, Any],
    sources: dict[str, dict[str, Any]],
    sample_rate: int,
    base_output_shape: tuple[int, int, int],
) -> torch.Tensor:
    primary = sources["take-1"]["waveform"]
    track_mix = torch.zeros(base_output_shape, device=primary.device, dtype=primary.dtype)
    for clip in track["clips"]:
        if clip["muted"]:
            continue
        source = sources[clip["source_id"]]
        rendered = _render_clip(source, clip, sample_rate)
        timeline_start = _seconds_to_sample(clip["timeline_start"], sample_rate)
        timeline_end = timeline_start + rendered.shape[-1]
        if timeline_start >= track_mix.shape[-1]:
            continue
        if timeline_end > track_mix.shape[-1]:
            rendered = rendered[..., : track_mix.shape[-1] - timeline_start]
            timeline_end = track_mix.shape[-1]
        track_mix[..., timeline_start:timeline_end] += rendered

    # Track automation and controls happen before effects. The effect tail is
    # therefore created by padding silence only after these controls are applied.
    track_envelope = _envelope_amplitude(
        track_mix.shape[-1],
        sample_rate,
        track.get("gain_envelope", []),
        track_mix.device,
        track_mix.dtype,
        zero_anchors=False,
    )
    if track_envelope is not None:
        track_mix *= track_envelope.view(1, 1, -1)
    track_mix *= _db_to_amplitude(track.get("gain_db", 0.0), device=track_mix.device, dtype=track_mix.dtype)
    track_mix = _apply_pan_balance(track_mix, track.get("pan", 0.0))
    effects = track.get("effects", [])
    tail_samples = effect_chain_tail_samples(effects, sample_rate)
    if tail_samples > 0:
        track_mix = torch.nn.functional.pad(track_mix, (0, tail_samples))
    return apply_effect_chain(
        track_mix,
        sample_rate,
        effects,
        owner=f"Track {track.get('name') or track.get('id')}",
    )


def _apply_channel_mode(waveform: torch.Tensor, mode: str) -> torch.Tensor:
    channels = waveform.shape[1]
    if mode == "preserve":
        return waveform
    if mode == "mono":
        return waveform.mean(dim=1, keepdim=True)
    if mode == "stereo":
        return waveform if channels == 2 else waveform.repeat(1, 2, 1)
    if mode == "left_only":
        return waveform[:, :1]
    if mode == "right_only":
        return waveform[:, 1:2] if channels >= 2 else waveform[:, :1]
    if mode == "swap_lr":
        if channels < 2:
            return waveform.repeat(1, 2, 1)
        return waveform[:, [1, 0], :]
    return waveform


def _normalize_peak(waveform: torch.Tensor, target_peak_dbfs: float) -> torch.Tensor:
    peak = waveform.detach().abs().amax()
    if not torch.isfinite(peak) or float(peak) <= 0.0:
        return waveform
    target = math.pow(10.0, float(target_peak_dbfs) / 20.0)
    return waveform * (target / peak)


def render_audio_edit(
    audio: Any,
    edit_json: str | dict[str, Any] | None,
    *,
    take_2: Any = None,
    take_3: Any = None,
    take_4: Any = None,
) -> RenderResult:
    sources, infos = collect_sources(audio, take_2, take_3, take_4)
    project = normalize_edit_project(edit_json, infos)
    primary = infos[0]
    primary_waveform = sources["take-1"]["waveform"]
    sample_rate = primary.sample_rate

    timeline_duration = project_timeline_duration(project)
    base_samples = max(1, _seconds_to_sample(timeline_duration, sample_rate))
    base_shape = (primary.batch_size, primary.channels, base_samples)

    tracks = project["tracks"]
    any_solo = any(bool(track.get("solo")) for track in tracks)
    rendered_tracks: list[torch.Tensor] = []
    for track in tracks:
        if bool(track.get("muted")) or (any_solo and not bool(track.get("solo"))):
            continue
        rendered_tracks.append(_render_track(track, sources, sample_rate, base_shape))

    mix_samples = max([base_samples, *(track.shape[-1] for track in rendered_tracks)])
    mixed = torch.zeros(
        (primary.batch_size, primary.channels, mix_samples),
        device=primary_waveform.device,
        dtype=primary_waveform.dtype,
    )
    for track in rendered_tracks:
        mixed[..., : track.shape[-1]] += track

    master = project["master"]
    master_effects = master.get("effects", [])
    master_tail = effect_chain_tail_samples(master_effects, sample_rate)
    if master_tail > 0:
        mixed = torch.nn.functional.pad(mixed, (0, master_tail))
    mixed = apply_effect_chain(mixed, sample_rate, master_effects, owner="Master")
    mixed = _apply_channel_mode(mixed, master["channel_mode"])
    mixed *= _db_to_amplitude(master["gain_db"], device=mixed.device, dtype=mixed.dtype)
    if master["normalize"]["enabled"]:
        mixed = _normalize_peak(mixed, master["normalize"]["target_peak_dbfs"])

    mixed = torch.nan_to_num(mixed, nan=0.0, posinf=1.0, neginf=-1.0)
    result_audio = {"waveform": mixed, "sample_rate": sample_rate}
    return RenderResult(audio=result_audio, project=project, sources=infos)
