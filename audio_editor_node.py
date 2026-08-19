from __future__ import annotations

from comfy_api.latest import io

from .audio_edit_project import DEFAULT_EDIT_JSON


class MiniMaxMusic3SemanticStudioAudioEditor(io.ComfyNode):
    """Non-destructive unified single-audio editor for Music3 Semantic Studio V1.0."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MiniMaxMusic3SemanticStudioAudioEditor",
            display_name="Music3 Semantic Studio Audio Editor",
            category="audio/minimax music",
            essentials_category="Audio/Editing",
            description=(
                "V1.0 diagnostic pure-pass-through build. Connect decoded AUDIO and Queue normally. "
                "The node returns the connected AUDIO unchanged so Python audio processing is fully isolated from the freeze investigation."
            ),
            inputs=[
                io.Audio.Input("audio", tooltip="Source audio."),
                io.String.Input(
                    "edit_json",
                    display_name="Audio Edit JSON",
                    default=DEFAULT_EDIT_JSON,
                    multiline=True,
                    dynamic_prompts=False,
                    advanced=True,
                    tooltip="Stored non-destructive edit state. Ignored only by this diagnostic pure-pass-through Queue path.",
                ),
                io.Boolean.Input(
                    "bypass",
                    default=False,
                    label_on="Bypass",
                    label_off="Edited",
                    tooltip="Ignored only by this diagnostic pure-pass-through Queue path.",
                ),
            ],
            outputs=[io.Audio.Output("audio", display_name="AUDIO")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, audio, edit_json, bypass=False) -> io.NodeOutput:
        # Diagnostic isolation: no collect_sources, JSON normalization, tensor clone,
        # edit render, DSP/VST3, preview save, or custom UI payload. The exact AUDIO
        # object received from ComfyUI is forwarded unchanged.
        return io.NodeOutput(audio)
