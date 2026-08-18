from pathlib import Path
import base64
import hashlib
import zlib

PAYLOAD_TARGETS = {
    "00": "audio_effects_dsp.py",
    "02": "web/audio_effects_core.js",
    "03": "web/audio_effects_dsp.js",
    "04": "web/audio_draft_core.js",
    "05": "tests/test_audio_effects_dsp.py",
    "06": "tests/test_audio_render.py",
    "07": "tests/js/audio_effects_core.test.mjs",
    "08": "tests/js/audio_effects_dsp.test.mjs",
    "09": "tests/js/audio_draft_core.test.mjs",
    "10": "docs/V2_1C_DSP_NOTES.md",
}

EXPECTED_SHA256 = {
    "audio_effects_dsp.py": "bf88a1a51b0836bc19ff2583a32164cdb96e2df89309895aafc4b2afab8536c9",
    "audio_render.py": "07af4a3f31fff814e815d6de0d61b960812efad1be0885933e5400eb19b322ce",
    "web/audio_effects_core.js": "8cf8ef8ff5857d1e3a03bc71f583ea0536f886ca6a1c483bb390d8e7102f4cdc",
    "web/audio_effects_dsp.js": "ee2ac4d00ec2f3b96e5f4c1121acdb74aa3b9f6ab351400ff4f9720a0b74ea12",
    "web/audio_draft_core.js": "65e690943382dd3daeac9af78519b2e34b8add77584131542b69b957e2ca1315",
    "tests/test_audio_effects_dsp.py": "c45ade1fcf49b6992f2ef21de14bbba85c792ab1fd2251cfa5b2ebd45051ce63",
    "tests/test_audio_render.py": "57e8bdb9ac4f8a66e2678b72af45f2003c1747582bc5370a701032149db8a2ee",
    "tests/js/audio_effects_core.test.mjs": "31ce63b78461ae540f14d8b97419bcb3539f9029dcb55244f5bcfe731bde1b8f",
    "tests/js/audio_effects_dsp.test.mjs": "d4170f49083a5e3801756b3049230f3143ab086569038a122c4caaeeec9a188c",
    "tests/js/audio_draft_core.test.mjs": "c5a510110b5922877fe714f503267a43b07b75bfff1aa6910586e46c41f6010d",
    "docs/V2_1C_DSP_NOTES.md": "7ae05c4ce1f5149140cf8aff4b538481fd46d4bad3c0e0f8c6e7b8c168ec38a8",
}


def replace_once(text: str, old: str, new: str, label: str) -> str:
    if old not in text:
        raise RuntimeError(f"Expected source fragment not found while patching {label}")
    return text.replace(old, new, 1)


for payload_id, target in PAYLOAD_TARGETS.items():
    encoded = Path(f".v21c_payload/{payload_id}.txt").read_text(encoding="utf-8").strip()
    data = zlib.decompress(base64.b64decode(encoded))
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

# audio_render.py stays close to the V2.1-B source and is patched by exact,
# bounded replacements. This avoids transferring/replacing an unrelated full file.
render_path = Path("audio_render.py")
render = render_path.read_text(encoding="utf-8")
render = replace_once(
    render,
    "    from .audio_effects_dsp import apply_effect_chain\n",
    "    from .audio_effects_dsp import apply_effect_chain, effect_chain_tail_samples\n",
    "audio_render.py package import",
)
render = replace_once(
    render,
    "    from audio_effects_dsp import apply_effect_chain\n",
    "    from audio_effects_dsp import apply_effect_chain, effect_chain_tail_samples\n",
    "audio_render.py test import",
)
render = replace_once(
    render,
    "    output_shape: tuple[int, int, int],\n",
    "    base_output_shape: tuple[int, int, int],\n",
    "audio_render.py track shape argument",
)
render = replace_once(
    render,
    "    track_mix = torch.zeros(output_shape, device=primary.device, dtype=primary.dtype)\n",
    "    track_mix = torch.zeros(base_output_shape, device=primary.device, dtype=primary.dtype)\n",
    "audio_render.py track allocation",
)
render = replace_once(
    render,
    "    track_envelope = _envelope_amplitude(\n",
    "    # Track automation and controls happen before effects. The effect tail is\n"
    "    # therefore created by padding silence only after these controls are applied.\n"
    "    track_envelope = _envelope_amplitude(\n",
    "audio_render.py track order comment",
)
render = replace_once(
    render,
    '''    return apply_effect_chain(\n        track_mix,\n        sample_rate,\n        track.get("effects", []),\n        owner=f"Track {track.get('name') or track.get('id')}",\n    )\n''',
    '''    effects = track.get("effects", [])\n    tail_samples = effect_chain_tail_samples(effects, sample_rate)\n    if tail_samples > 0:\n        track_mix = torch.nn.functional.pad(track_mix, (0, tail_samples))\n    return apply_effect_chain(\n        track_mix,\n        sample_rate,\n        effects,\n        owner=f"Track {track.get('name') or track.get('id')}",\n    )\n''',
    "audio_render.py track tail",
)
render = replace_once(
    render,
    '''    timeline_duration = project_timeline_duration(project)\n    output_samples = max(1, _seconds_to_sample(timeline_duration, sample_rate))\n    output_shape = (primary.batch_size, primary.channels, output_samples)\n    mixed = torch.zeros(output_shape, device=primary_waveform.device, dtype=primary_waveform.dtype)\n\n    tracks = project["tracks"]\n    any_solo = any(bool(track.get("solo")) for track in tracks)\n    for track in tracks:\n        if bool(track.get("muted")) or (any_solo and not bool(track.get("solo"))):\n            continue\n        mixed += _render_track(track, sources, sample_rate, output_shape)\n\n    master = project["master"]\n    mixed = apply_effect_chain(mixed, sample_rate, master.get("effects", []), owner="Master")\n''',
    '''    timeline_duration = project_timeline_duration(project)\n    base_samples = max(1, _seconds_to_sample(timeline_duration, sample_rate))\n    base_shape = (primary.batch_size, primary.channels, base_samples)\n\n    tracks = project["tracks"]\n    any_solo = any(bool(track.get("solo")) for track in tracks)\n    rendered_tracks: list[torch.Tensor] = []\n    for track in tracks:\n        if bool(track.get("muted")) or (any_solo and not bool(track.get("solo"))):\n            continue\n        rendered_tracks.append(_render_track(track, sources, sample_rate, base_shape))\n\n    mix_samples = max([base_samples, *(track.shape[-1] for track in rendered_tracks)])\n    mixed = torch.zeros(\n        (primary.batch_size, primary.channels, mix_samples),\n        device=primary_waveform.device,\n        dtype=primary_waveform.dtype,\n    )\n    for track in rendered_tracks:\n        mixed[..., : track.shape[-1]] += track\n\n    master = project["master"]\n    master_effects = master.get("effects", [])\n    master_tail = effect_chain_tail_samples(master_effects, sample_rate)\n    if master_tail > 0:\n        mixed = torch.nn.functional.pad(mixed, (0, master_tail))\n    mixed = apply_effect_chain(mixed, sample_rate, master_effects, owner="Master")\n''',
    "audio_render.py mix and master tail",
)
render_path.write_text(render, encoding="utf-8")

spec = Path("docs/V2_SPEC.md")
text = spec.read_text(encoding="utf-8")
replacements = [
    (
        "Status: **schema 2 unified waveform editor, V2.1-B basic DSP, Effects Rack, and selection-loop audition implemented; ComfyUI integration verification pending**.",
        "Status: **schema 2 unified waveform editor, V2.1-C spatial DSP (Reverb + Stereo Delay), Effects Rack, and selection-loop audition implemented; ComfyUI integration verification pending**.",
    ),
    ("### V2.1-B supported DSP", "### V2.1-C supported DSP"),
    (
        "- **Stereo Width** — mid/side width control for stereo material",
        "- **Stereo Width** — mid/side width control for stereo material\n- **Reverb** — deterministic Schroeder/FreeVerb-inspired stereo room response with pre-delay, decay, damping, tone and wet/dry controls\n- **Stereo Delay** — feedback delay with wet/dry gain and optional Ping-Pong cross-feedback",
    ),
    (
        "Python filtering uses `torchaudio.functional.lfilter` when available and retains a PyTorch fallback so importing the custom node does not depend on an optional DSP package import succeeding.",
        "Python filtering uses `torchaudio.functional.lfilter` when available and retains a PyTorch fallback so importing the custom node does not depend on an optional DSP package import succeeding. Reverb uses deterministic IR generation plus PyTorch FFT overlap-add convolution; Delay uses bounded feedback processing. Both report effect tails so Track and Master spatial effects are not cut off at the timeline boundary.",
    ),
    (
        "Reverb remains present in the authoring catalog for the next phase but is not executed by V2.1-B. An enabled Reverb or any unknown future effect raises a clear unsupported-effect error in both Draft and authoritative rendering.",
        "Reverb and Stereo Delay execute in V2.1-C. Any unknown future enabled effect still raises a clear unsupported-effect error in both Draft and authoritative rendering.",
    ),
    (
        "- supported basic DSP behavior for Gain, Filters, EQ, Compressor, Limiter and Stereo Width",
        "- supported DSP behavior for Gain, Filters, EQ, Compressor, Limiter, Stereo Width, Reverb and Stereo Delay",
    ),
    ("- Browser Draft support for enabled V2.1-B effects", "- Browser Draft support for enabled V2.1-C effects"),
    ("- Save Edits -> Queue -> Rendered A comparison for each V2.1-B effect", "- Save Edits -> Queue -> Rendered A comparison for each V2.1-C effect"),
]
for old, new in replacements:
    text = replace_once(text, old, new, "docs/V2_SPEC.md")
spec.write_text(text, encoding="utf-8")

for target, expected in EXPECTED_SHA256.items():
    actual = hashlib.sha256(Path(target).read_bytes()).hexdigest()
    if actual != expected:
        raise RuntimeError(f"SHA-256 mismatch for {target}: {actual} != {expected}")
