from __future__ import annotations

WEB_DIRECTORY = "./web"


async def comfy_entrypoint():
    # Import ComfyUI only when ComfyUI discovers the extension. Keeping package
    # import side effects minimal lets the pure semantic/audio project code be
    # tested with an ordinary Python environment.
    from aiohttp import web
    from comfy_api.latest import ComfyExtension, io
    from server import PromptServer
    from typing_extensions import override

    from .audio_editor_node import MiniMaxMusic3SemanticStudioAudioEditor
    from .nodes import MiniMaxMusic3SemanticStudio
    from .vst3_scan import scan_vst3_plugins

    route_path = "/m3ss/vst3/scan"
    if not getattr(PromptServer.instance, "_m3ss_vst3_scan_registered", False):
        @PromptServer.instance.routes.get(route_path)
        async def get_m3ss_vst3_plugins(request):
            return web.json_response(scan_vst3_plugins())

        PromptServer.instance._m3ss_vst3_scan_registered = True

    class MiniMaxMusic3SemanticStudioExtension(ComfyExtension):
        @override
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [
                MiniMaxMusic3SemanticStudio,
                MiniMaxMusic3SemanticStudioAudioEditor,
            ]

    return MiniMaxMusic3SemanticStudioExtension()


__all__ = ["comfy_entrypoint", "WEB_DIRECTORY"]
