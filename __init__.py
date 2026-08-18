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
    from .vst3_editor import Vst3EditorBusy, Vst3EditorRequestError, open_native_editor
    from .vst3_host import host_status
    from .vst3_scan import scan_vst3_plugins

    scan_route = "/m3ss/vst3/scan"
    status_route = "/m3ss/vst3/host-status"
    editor_route = "/m3ss/vst3/open-editor"
    if not getattr(PromptServer.instance, "_m3ss_vst3_scan_registered", False):
        @PromptServer.instance.routes.get(scan_route)
        async def get_m3ss_vst3_plugins(request):
            return web.json_response(scan_vst3_plugins())

        PromptServer.instance._m3ss_vst3_scan_registered = True

    if not getattr(PromptServer.instance, "_m3ss_vst3_host_status_registered", False):
        @PromptServer.instance.routes.get(status_route)
        async def get_m3ss_vst3_host_status(request):
            return web.json_response(host_status())

        PromptServer.instance._m3ss_vst3_host_status_registered = True

    if not getattr(PromptServer.instance, "_m3ss_vst3_editor_registered", False):
        @PromptServer.instance.routes.post(editor_route)
        async def post_m3ss_vst3_editor(request):
            try:
                payload = await request.json()
                result = await open_native_editor(payload)
                return web.json_response(result)
            except Vst3EditorBusy as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=409)
            except Vst3EditorRequestError as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=400)
            except Exception as exc:
                return web.json_response(
                    {"ok": False, "error": f"{type(exc).__name__}: {exc}"},
                    status=500,
                )

        PromptServer.instance._m3ss_vst3_editor_registered = True

    class MiniMaxMusic3SemanticStudioExtension(ComfyExtension):
        @override
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [
                MiniMaxMusic3SemanticStudio,
                MiniMaxMusic3SemanticStudioAudioEditor,
            ]

    return MiniMaxMusic3SemanticStudioExtension()


__all__ = ["comfy_entrypoint", "WEB_DIRECTORY"]
