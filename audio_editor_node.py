from __future__ import annotations

import json
from typing import Any

from comfy_api.latest import io, ui

from .audio_edit_project import DEFAULT_EDIT_JSON, EDIT_SCHEMA_VERSION, normalize_edit_project, project_timeline_duration
from .audio_render import collect_sources, render_audio_edit


class MiniMaxMusic3SemanticStudioAudioEditor(io.ComfyNode):
    """Non-destructive unified waveform editor for Music3 Semantic Studio."""

    @classmethod
    def define_schema(cls) -> io.Schema:
        return io.Schema(
            node_id="MiniMaxMusic3SemanticStudioAudioEditor",
            display_name="Music3 Semantic Studio Audio Editor",
            category="audio/minimax music",
            essentials_category="Audio/Editing",
            description=(
                "Non-destructive unified waveform editor. Connect decoded AUDIO, run once to load previews, "
                "then use Open Audio Editor. Final rendering is derived from source AUDIO plus versioned edit_json."
            ),
            inputs=[
                io.Audio.Input("audio", tooltip="Primary source audio (Take 1)."),
                io.Audio.Input("take_2", display_name="Take 2", optional=True, advanced=True),
                io.Audio.Input("take_3", display_name="Take 3", optional=True, advanced=True),
                io.Audio.Input("take_4", display_name="Take 4", optional=True, advanced=True),
                io.String.Input(
                    "edit_json",
                    display_name="Audio Edit JSON",
                    default=DEFAULT_EDIT_JSON,
                    multiline=True,
                    dynamic_prompts=False,
                    advanced=True,
                    tooltip="Versioned non-destructive edit state. Normally edited with Open Audio Editor.",
                ),
                io.Boolean.Input(
                    "bypass",
                    default=False,
                    label_on="Bypass",
                    label_off="Edited",
                    tooltip="Return Take 1 unchanged while still generating source/render preview metadata.",
                ),
            ],
            outputs=[io.Audio.Output("audio", display_name="AUDIO")],
            is_output_node=True,
        )

    @classmethod
    def validate_inputs(cls, edit_json, **kwargs) -> bool | str:
        try:
            if isinstance(edit_json, str) and edit_json.strip():
                parsed = json.loads(edit_json)
                version = parsed.get("edit_schema_version", 1) if isinstance(parsed, dict) else None
                if version not in {1, EDIT_SCHEMA_VERSION}:
                    return (
                        f"Unsupported audio edit_schema_version={version!r}; "
                        f"this build supports schema 1 migration and schema {EDIT_SCHEMA_VERSION}."
                    )
        except json.JSONDecodeError as exc:
            return f"Semantic Studio audio edit JSON is invalid: {exc.msg} at line {exc.lineno} column {exc.colno}"
        return True

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
    def execute(
        cls,
        audio,
        edit_json,
        bypass=False,
        take_2=None,
        take_3=None,
        take_4=None,
    ) -> io.NodeOutput:
        sources, infos = collect_sources(audio, take_2, take_3, take_4)

        if bypass:
            project = normalize_edit_project(edit_json, infos)
            rendered_audio = {
                "waveform": sources["take-1"]["waveform"].clone(),
                "sample_rate": infos[0].sample_rate,
            }
        else:
            result = render_audio_edit(
                audio,
                edit_json,
                take_2=take_2,
                take_3=take_3,
                take_4=take_4,
            )
            project = result.project
            rendered_audio = result.audio

        take_previews: list[dict[str, Any]] = []
        for info in infos:
            source_audio = sources[info.id]
            refs = cls._save_temp_audio(source_audio, f"m3ss_v2_{info.id}_", cls)
            take_previews.append(
                {
                    "id": info.id,
                    "input": info.input_name,
                    "name": next(
                        (take["name"] for take in project["takes"] if take["id"] == info.id),
                        info.name,
                    ),
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
            "takes": take_previews,
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
