from __future__ import annotations

from typing import Any

from comfy_api.latest import io, ui

from .audio_edit_project import DEFAULT_EDIT_JSON, EDIT_SCHEMA_VERSION, normalize_edit_project, project_timeline_duration
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
                "V1.0 diagnostic preview/meta-only build. Connect decoded AUDIO and Queue normally. "
                "The node restores editor loading metadata while returning the connected audio unchanged and skipping final edit rendering."
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
                    tooltip="Stored non-destructive edit state. Validated for editor metadata, but not rendered in this diagnostic Queue path.",
                ),
                io.Boolean.Input(
                    "bypass",
                    default=False,
                    label_on="Bypass",
                    label_off="Edited",
                    tooltip="Recorded in diagnostic metadata; Queue output remains the connected source audio in this preview/meta-only build.",
                ),
            ],
            outputs=[io.Audio.Output("audio", display_name="AUDIO")],
            is_output_node=True,
        )

    @staticmethod
    def _save_temp_audio(audio: dict[str, Any], prefix: str, cls: type[io.ComfyNode]) -> list[dict[str, Any]]:
        results = ui.AudioSaveHelper.save_audio(
            audio,
            filename_prefix=prefix,
            folder_type=io.FolderType.temp,
            cls=cls,
            format="flac",
            quality="128k",
        )
        return [dict(item) for item in results]

    @classmethod
    def execute(cls, audio, edit_json, bypass=False) -> io.NodeOutput:
        # Diagnostic isolation: keep the PR #33-stable source/normalization path,
        # restore only preview files + m3ss_v2 metadata, and do not invoke the renderer.
        sources, infos = collect_sources(audio)
        project = normalize_edit_project(edit_json, infos)
        rendered_audio = {
            "waveform": sources["take-1"]["waveform"],
            "sample_rate": infos[0].sample_rate,
        }

        source_previews: list[dict[str, Any]] = []
        for info in infos:
            source_audio = sources[info.id]
            refs = cls._save_temp_audio(source_audio, f"m3ss_v2_{info.id}_", cls)
            source_previews.append(
                {
                    "id": info.id,
                    "input": info.input_name,
                    "name": "Audio" if info.id == "take-1" else info.name,
                    "sample_rate": info.sample_rate,
                    "channels": info.channels,
                    "batch_size": info.batch_size,
                    "num_samples": info.num_samples,
                    "duration": info.duration,
                    "audio": refs,
                }
            )

        # The diagnostic output is exactly the primary source, so reuse the same
        # preview reference instead of encoding identical audio a second time.
        rendered_refs = list(source_previews[0]["audio"])
        rendered_waveform = rendered_audio["waveform"]
        rendered_duration = rendered_waveform.shape[-1] / rendered_audio["sample_rate"]

        metadata = {
            "edit_schema_version": EDIT_SCHEMA_VERSION,
            "bypass": bool(bypass),
            "interactive_supported": infos[0].batch_size == 1,
            "takes": source_previews,
            "rendered": {
                "sample_rate": int(rendered_audio["sample_rate"]),
                "channels": int(rendered_waveform.shape[1]),
                "batch_size": int(rendered_waveform.shape[0]),
                "num_samples": int(rendered_waveform.shape[-1]),
                "duration": float(rendered_duration),
                "audio": rendered_refs,
            },
            "timeline_duration": float(project_timeline_duration(project)),
        }

        ui_payload = {
            "audio": rendered_refs,
            "m3ss_v2": [metadata],
        }
        return io.NodeOutput(rendered_audio, ui=ui_payload)
