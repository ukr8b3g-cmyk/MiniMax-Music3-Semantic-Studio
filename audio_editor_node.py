from __future__ import annotations

from comfy_api.latest import io

from .audio_edit_project import DEFAULT_EDIT_JSON, normalize_edit_project
from .audio_render import collect_sources, render_audio_edit


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
                "V1.0 non-destructive single-audio editor. Connect decoded AUDIO and Queue normally. "
                "This diagnostic build keeps Queue completion to plain AUDIO only so editor preview/UI work is isolated from generation."
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
                    tooltip="Non-destructive edit state. Known fields from future schemas are interpreted where possible; malformed JSON still fails at execution to protect stored edits.",
                ),
                io.Boolean.Input(
                    "bypass",
                    default=False,
                    label_on="Bypass",
                    label_off="Edited",
                    tooltip="Return the source audio unchanged after validating the stored edit state.",
                ),
            ],
            outputs=[io.Audio.Output("audio", display_name="AUDIO")],
            is_output_node=True,
        )

    @classmethod
    def execute(cls, audio, edit_json, bypass=False) -> io.NodeOutput:
        # Diagnostic isolation: Queue execution performs audio work only. Do not save
        # source/render previews and do not return custom UI metadata on completion.
        # If the workflow no longer freezes, the regression is in the removed
        # preview/UI completion path rather than in rendering or Semantic Studio.
        if bypass:
            sources, infos = collect_sources(audio)
            normalize_edit_project(edit_json, infos)
            rendered_audio = {
                "waveform": sources["take-1"]["waveform"].clone(),
                "sample_rate": infos[0].sample_rate,
            }
        else:
            rendered_audio = render_audio_edit(audio, edit_json).audio

        return io.NodeOutput(rendered_audio)
