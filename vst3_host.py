from __future__ import annotations

import base64
import importlib.metadata
import os
from pathlib import Path
from typing import Any, Callable

import torch

try:
    from .audio_effects_dsp import apply_effect_chain as _apply_builtin_chain
    from .audio_effects_dsp import effect_chain_tail_samples as _builtin_tail_samples
except ImportError:  # Allows pure-module tests outside ComfyUI package loading.
    from audio_effects_dsp import apply_effect_chain as _apply_builtin_chain
    from audio_effects_dsp import effect_chain_tail_samples as _builtin_tail_samples

VST3_EFFECT_TYPE = "vst3"
MAX_STATE_BYTES = 32 * 1024 * 1024


def host_status() -> dict[str, Any]:
    if os.name != "nt":
        return {
            "ready": False,
            "platform": os.name,
            "backend": "pedalboard",
            "version": "",
            "message": "VST3 hosting and native plugin UI are currently enabled for Windows only.",
        }
    try:
        version = importlib.metadata.version("pedalboard")
        from pedalboard import load_plugin  # noqa: F401
    except Exception as exc:
        return {
            "ready": False,
            "platform": os.name,
            "backend": "pedalboard",
            "version": "",
            "message": (
                "VST3 host is missing. On Windows it is installed automatically from requirements.txt "
                "when the custom node is installed/updated through ComfyUI Manager. "
                f"Reinstall dependencies if needed. ({exc})"
            ),
        }
    return {
        "ready": True,
        "platform": os.name,
        "backend": "pedalboard",
        "version": version,
        "native_ui": True,
        "message": f"Pedalboard {version} is available for queued VST3 rendering and native plugin UI.",
    }


def _plugin_identity(effect: dict[str, Any]) -> tuple[str, str]:
    params = effect.get("params") if isinstance(effect.get("params"), dict) else {}
    path = str(params.get("path") or "").strip()
    plugin_name = str(params.get("plugin_name") or params.get("name") or "").strip()
    return path, plugin_name


def _default_loader(path: str, plugin_name: str):
    try:
        from pedalboard import load_plugin
    except Exception as exc:  # pragma: no cover - environment dependent
        raise RuntimeError(
            "VST3 effect is enabled but Pedalboard is unavailable. On Windows, reinstall/update "
            "the custom node dependencies so requirements.txt is applied."
        ) from exc

    kwargs: dict[str, Any] = {"initialization_timeout": 10.0}
    if plugin_name:
        kwargs["plugin_name"] = plugin_name
    try:
        return load_plugin(path, **kwargs)
    except Exception as first:
        if plugin_name:
            try:
                return load_plugin(path, initialization_timeout=10.0)
            except Exception:
                pass
        raise RuntimeError(f"Could not load VST3 plugin {plugin_name or Path(path).stem!r}: {first}") from first


def _decode_effect_state(effect: dict[str, Any]) -> tuple[str, bytes, str]:
    params = effect.get("params") if isinstance(effect.get("params"), dict) else {}
    encoded = str(params.get("state_b64") or "")
    if not encoded:
        return "", b"", ""
    try:
        data = base64.b64decode(encoded, validate=True)
    except Exception as exc:
        raise ValueError("Stored VST3 plugin state is not valid base64 data.") from exc
    if len(data) > MAX_STATE_BYTES:
        raise ValueError(f"Stored VST3 plugin state exceeds the {MAX_STATE_BYTES // (1024 * 1024)} MiB safety limit.")
    kind = str(params.get("state_kind") or "preset_data")
    identifier = str(params.get("plugin_identifier") or "").strip()
    return kind, data, identifier


def _restore_plugin_state(plugin: Any, effect: dict[str, Any], label: str) -> None:
    kind, data, expected_identifier = _decode_effect_state(effect)
    if not data:
        return
    actual_identifier = str(getattr(plugin, "identifier", "") or "").strip()
    if expected_identifier and actual_identifier and expected_identifier != actual_identifier:
        raise ValueError(
            f"Stored state for VST3 plugin {label!r} no longer matches the installed plugin identifier; "
            "open the native Plugin UI and save fresh state."
        )
    try:
        if kind == "raw_state":
            plugin.raw_state = data
        else:
            plugin.preset_data = data
    except Exception as exc:
        raise RuntimeError(f"Could not restore saved VST3 state for {label!r}: {exc}") from exc


def _normalize_plugin_output(array: Any, channels: int, samples: int):
    import numpy as np

    output = np.asarray(array, dtype=np.float32)
    if output.ndim == 1:
        output = output.reshape(1, -1)
    if output.ndim != 2:
        raise RuntimeError(f"VST3 plugin returned unsupported audio shape {output.shape!r}.")
    if output.shape[0] != channels and output.shape[1] == channels:
        output = output.T
    if output.shape[0] != channels:
        raise RuntimeError(
            f"VST3 plugin changed channel count from {channels} to {output.shape[0]}; "
            "Phase 2B requires channel-preserving effects."
        )
    if output.shape[1] < samples:
        output = np.pad(output, ((0, 0), (0, samples - output.shape[1])))
    elif output.shape[1] > samples:
        output = output[:, :samples]
    return output


def apply_vst3_effect(
    waveform: torch.Tensor,
    sample_rate: int,
    effect: dict[str, Any],
    *,
    owner: str,
    loader: Callable[[str, str], Any] | None = None,
) -> torch.Tensor:
    if effect.get("enabled", True) is False:
        return waveform
    path, plugin_name = _plugin_identity(effect)
    label = plugin_name or Path(path).stem or str(effect.get("id") or "VST3")
    if not path:
        raise ValueError(f"{owner} VST3 effect {label!r} has no plugin path.")
    plugin_path = Path(path)
    if plugin_path.suffix.lower() != ".vst3":
        raise ValueError(f"{owner} VST3 effect {label!r} does not reference a .vst3 bundle.")
    if loader is None and not plugin_path.exists():
        raise ValueError(f"{owner} VST3 plugin was not found: {path}")

    plugin = (loader or _default_loader)(path, plugin_name)
    if not bool(getattr(plugin, "is_effect", False)):
        raise ValueError(f"{owner} plugin {label!r} is not an audio effect.")
    _restore_plugin_state(plugin, effect, label)

    import numpy as np

    original_device = waveform.device
    original_dtype = waveform.dtype
    work = waveform.detach().to(device="cpu", dtype=torch.float32).contiguous()
    batch_size, channels, samples = work.shape
    rendered: list[torch.Tensor] = []
    for batch_index in range(batch_size):
        input_array = np.asarray(work[batch_index].numpy(), dtype=np.float32)
        try:
            output = plugin(input_array, float(sample_rate), buffer_size=8192, reset=True)
        except Exception as exc:
            raise RuntimeError(f"VST3 processing failed for {label!r}: {exc}") from exc
        normalized = _normalize_plugin_output(output, channels, samples)
        rendered.append(torch.from_numpy(normalized.copy()))
    result = torch.stack(rendered, dim=0)
    return result.to(device=original_device, dtype=original_dtype)


def effect_chain_tail_samples(effects: Any, sample_rate: int) -> int:
    builtins = [
        effect for effect in (effects if isinstance(effects, list) else [])
        if not isinstance(effect, dict) or str(effect.get("type") or "") != VST3_EFFECT_TYPE
    ]
    return _builtin_tail_samples(builtins, sample_rate)


def apply_effect_chain(
    waveform: torch.Tensor,
    sample_rate: int,
    effects: Any,
    *,
    owner: str,
    vst3_loader: Callable[[str, str], Any] | None = None,
) -> torch.Tensor:
    """Apply the chain permissively.

    Low-level VST3 helpers remain strict for diagnostics and direct callers, but a
    queued Audio Editor render bypasses an individual VST3 that cannot load,
    restore, or process. One broken optional effect must not discard usable audio.
    """

    result = waveform
    pending_builtin: list[dict[str, Any]] = []

    def flush_builtin() -> None:
        nonlocal result, pending_builtin
        if pending_builtin:
            result = _apply_builtin_chain(result, sample_rate, pending_builtin, owner=owner)
            pending_builtin = []

    for raw in effects if isinstance(effects, list) else []:
        if not isinstance(raw, dict):
            pending_builtin.append(raw)
            continue
        if str(raw.get("type") or "") == VST3_EFFECT_TYPE:
            flush_builtin()
            if raw.get("enabled", True) is not False:
                path, plugin_name = _plugin_identity(raw)
                label = plugin_name or Path(path).stem or str(raw.get("id") or "VST3")
                try:
                    result = apply_vst3_effect(
                        result,
                        sample_rate,
                        raw,
                        owner=owner,
                        loader=vst3_loader,
                    )
                except Exception as exc:
                    print(
                        f"[MiniMax Music3 Semantic Studio] {owner}: bypassing VST3 {label!r} after render error: {exc}"
                    )
        else:
            pending_builtin.append(raw)
    flush_builtin()
    return result
