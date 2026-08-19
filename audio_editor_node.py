from __future__ import annotations

from comfy_api.latest import io

from .audio_edit_project import DEFAULT_EDIT_JSON, normalize_edit_project
from .audio_render import collect_sources


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
                "V1.0 diagnostic no-clone build. Connect decoded AUDIO and Queue normally. "
                "The node validates the source/edit state but returns the original connected AUDIO unchanged."
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
                    tooltip="Stored non-destructive edit state. Validated in this diagnostic Queue path without rendering or cloning audio.",
                ),
                io.Boolean.Input(
                    "bypass",
                    default=False,
                    label_on="Bypass",
                    label_off="Edited",
                    tooltip="Ignored only by this diagnostic no-clone Queue path.",
                ),
            ],
            outputs=[io.Audio.Output("audio", display_name="AUDIO")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, audio, edit_json, bypass=False) -> io.NodeOutput:
        # Diagnostic isolation: restore source collection and edit-state normalization,
        # but do not clone the waveform and do not render edits/DSP/VST3 or emit preview UI.
        # If this remains stable, the previous bypass freeze is isolated to waveform cloning.
        _, infos = collect_sources(audio)
        normalize_edit_project(edit_json, infos)
        return io.NodeOutput(audio)
