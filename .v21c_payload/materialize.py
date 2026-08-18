from pathlib import Path
import base64
import zlib

TARGETS = [
    "audio_effects_dsp.py",
    "audio_render.py",
    "web/audio_effects_core.js",
    "web/audio_effects_dsp.js",
    "web/audio_draft_core.js",
    "tests/test_audio_effects_dsp.py",
    "tests/test_audio_render.py",
    "tests/js/audio_effects_core.test.mjs",
    "tests/js/audio_effects_dsp.test.mjs",
    "tests/js/audio_draft_core.test.mjs",
    "docs/V2_1C_DSP_NOTES.md",
]

for index, target in enumerate(TARGETS):
    encoded = Path(f".v21c_payload/{index:02d}.txt").read_text(encoding="utf-8").strip()
    data = zlib.decompress(base64.b64decode(encoded))
    path = Path(target)
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_bytes(data)

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
    if old not in text:
        raise RuntimeError(f"V2_SPEC expected text not found: {old[:80]}")
    text = text.replace(old, new, 1)
spec.write_text(text, encoding="utf-8")
