from __future__ import annotations

import torch

from comfy_api.latest import io
from comfy.ldm.minimax_music.ar import (
    AUDIO_FRAMES_PER_SECOND,
    CFG_SCALE,
    CFG_TOP_K,
    C0_VOCAB_SIZE,
    MAX_AUDIO_FRAMES,
)

from .semantic_project import DEFAULT_PROJECT_JSON, compile_project


class MiniMaxMusic3SemanticStudio(io.ComfyNode):
    """V1 semantic timeline compiler + MiniMax Music3 conditioning encoder.

    The node intentionally leaves the sampler, diffusion model, latent creation,
    and VAE decode path untouched. V2/V3 can extend the project JSON without
    changing the V1 conditioning contract.
    """

    @classmethod
    def define_schema(cls) -> io.Schema:
        max_seconds = MAX_AUDIO_FRAMES / AUDIO_FRAMES_PER_SECOND
        return io.Schema(
            node_id="MiniMaxMusic3SemanticStudio",
            display_name="Music3 Semantic Studio",
            category="model/conditioning/minimax music",
            description=(
                "Design MiniMax Music 3 structure, lyrics, arrangement, vocal intent, and energy on a semantic timeline. "
                "V1 compiles the project into MiniMax Music3 caption/lyrics conditioning without patching ComfyUI core."
            ),
            inputs=[
                io.Clip.Input("clip"),
                io.String.Input(
                    "project_json",
                    display_name="Studio Project JSON",
                    default=DEFAULT_PROJECT_JSON,
                    multiline=True,
                    dynamic_prompts=False,
                    advanced=True,
                    tooltip="Versioned Semantic Studio project. Normally edited with the Open Semantic Studio button.",
                ),
                io.Int.Input(
                    "seed",
                    default=0,
                    min=0,
                    max=0xFFFFFFFFFFFFFFFF,
                    control_after_generate=True,
                ),
                io.Float.Input(
                    "max_duration",
                    default=160.0,
                    min=0.04,
                    max=max_seconds,
                    step=0.04,
                    tooltip="Hard generation ceiling. Saving the Studio timeline synchronizes this to the section-duration total.",
                ),
                io.Float.Input(
                    "cfg_scale",
                    default=CFG_SCALE,
                    min=0.0,
                    max=100.0,
                    step=0.1,
                    round=0.01,
                    advanced=True,
                ),
                io.Int.Input(
                    "top_k",
                    default=CFG_TOP_K,
                    min=1,
                    max=C0_VOCAB_SIZE,
                    advanced=True,
                ),
            ],
            outputs=[
                io.Conditioning.Output(),
                io.Float.Output(display_name="seconds"),
            ],
        )

    @classmethod
    def validate_inputs(cls, project_json, **kwargs) -> bool | str:
        try:
            compile_project(project_json)
        except ValueError as exc:
            return str(exc)
        return True

    @classmethod
    def execute(cls, clip, project_json, seed, max_duration, cfg_scale, top_k) -> io.NodeOutput:
        compiled = compile_project(project_json)

        max_audio_frames = min(
            MAX_AUDIO_FRAMES,
            max(1, round(max_duration * AUDIO_FRAMES_PER_SECOND)),
        )
        tokens = clip.tokenize(
            compiled.caption,
            lyrics=compiled.lyrics,
            seed=seed,
            max_audio_frames=max_audio_frames,
            cfg_scale=cfg_scale,
            top_k=top_k,
        )
        conditioning = clip.encode_from_tokens_scheduled(tokens)

        for cond in conditioning:
            hidden = cond[0]
            cond[1]["conditioning_scale"] = torch.ones(
                (hidden.shape[0], 1, 1),
                device=hidden.device,
                dtype=hidden.dtype,
            )
        seconds = conditioning[0][0].shape[1] / AUDIO_FRAMES_PER_SECOND
        return io.NodeOutput(conditioning, seconds)
