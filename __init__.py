from __future__ import annotations

WEB_DIRECTORY = "./web"


async def comfy_entrypoint():
    # Import ComfyUI only when ComfyUI discovers the extension. Keeping package
    # import side effects minimal lets the pure semantic compiler be tested with
    # an ordinary Python environment.
    from comfy_api.latest import ComfyExtension, io
    from typing_extensions import override

    from .nodes import MiniMaxMusic3SemanticStudio

    class MiniMaxMusic3SemanticStudioExtension(ComfyExtension):
        @override
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [MiniMaxMusic3SemanticStudio]

    return MiniMaxMusic3SemanticStudioExtension()


__all__ = ["comfy_entrypoint", "WEB_DIRECTORY"]
