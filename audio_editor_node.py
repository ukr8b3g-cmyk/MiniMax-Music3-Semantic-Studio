from __future__ import annotations

import json
from typing import Any

from comfy_api.latest import io, ui

from .audio_edit_project import DEFAULT_EDIT_JSON, EDIT_SCHEMA_VERSION, normalize_edit_project, project_timeline_duration
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
                "V1.0 non-destructive single-audio editor. Connect decoded AUDIO, run once to load the preview, "
                "then use Open Audio Editor. Final rendering is derived from the connected AUDIO plus versioned edit_json."
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
                    tooltip="Return the source audio unchanged while still generating source/render preview metadata.",
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
        sources, infos = collect_sources(audio)

        if bypass:
            project = normalize_edit_project(edit_json, infos)
            rendered_audio = {
                "waveform": sources["take-1"]["waveform"].clone(),
                "sample_rate": infos[0].sample_rate,
            }
        else:
            result = render_audio_edit(audio, edit_json)
            project = result.project
            rendered_audio = result.audio

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

        rendered_refs = cls._save_temp_audio(rendered_audio, "m3ss_v2_rendered_", cls)
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
            "normalized_edit_json": json.dumps(project, ensure_ascii=False, separators=(",", ":")),
        }

        ui_payload = {
            "audio": rendered_refs,
            "m3ss_v2": [metadata],
        }
        return io.NodeOutput(rendered_audio, ui=ui_payload)
