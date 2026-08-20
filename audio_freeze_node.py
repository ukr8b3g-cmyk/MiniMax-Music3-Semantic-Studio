from __future__ import annotations

from comfy_api.latest import io

from .audio_freeze_core import capture_audio, retrieve_audio


class MiniMaxMusic3AudioFreeze(io.ComfyNode):
    """Capture one generated AUDIO value and reuse it without re-evaluating upstream."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MiniMaxMusic3AudioFreeze",
            display_name="Capture / Freeze Audio",
            category="audio/minimax music",
            essentials_category="Audio/Editing",
            description=(
                "Capture stores the connected AUDIO as a CPU-RAM snapshot. Frozen reuses that snapshot "
                "without requesting the lazy AUDIO input, so upstream Music3 generation is not needed. "
                "Captured audio is session-only and is lost when ComfyUI restarts."
            ),
            inputs=[
                io.Audio.Input(
                    "audio",
                    lazy=True,
                    tooltip="Generated AUDIO to capture. In Frozen mode this lazy input is not requested.",
                ),
                io.Combo.Input(
                    "mode",
                    options=["Capture", "Frozen"],
                    default="Capture",
                    tooltip="Capture refreshes the stored take. Frozen returns the stored take without evaluating upstream AUDIO.",
                ),
            ],
            hidden=[io.Hidden.unique_id],
            outputs=[io.Audio.Output("audio", display_name="AUDIO")],
        )

    @classmethod
    def check_lazy_status(cls, audio=None, mode="Capture"):
        if mode == "Capture" and audio is None:
            return ["audio"]
        return []

    @classmethod
    def _node_id(cls):
        # ComfyUI's v3 node API exposes requested hidden values through the
        # per-execution cloned class (`cls.hidden`) rather than forwarding them
        # as normal execute/check_lazy_status keyword arguments.
        hidden = getattr(cls, "hidden", None)
        return getattr(hidden, "unique_id", None) if hidden is not None else None

    @classmethod
    def execute(cls, audio=None, mode="Capture") -> io.NodeOutput:
        unique_id = cls._node_id()
        if mode == "Capture":
            if audio is None:
                raise RuntimeError("Capture mode requires connected AUDIO to be evaluated.")
            output = capture_audio(unique_id, audio)
        elif mode == "Frozen":
            output = retrieve_audio(unique_id)
        else:
            raise ValueError(f"Unsupported Capture / Freeze Audio mode: {mode!r}")
        return io.NodeOutput(output)
