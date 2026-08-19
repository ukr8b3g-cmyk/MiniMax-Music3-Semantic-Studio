from __future__ import annotations

WEB_DIRECTORY = "./web"


async def comfy_entrypoint():
    # Import ComfyUI only when ComfyUI discovers the extension. Keeping package
    # import side effects minimal lets the pure semantic/audio project code be
    # tested with an ordinary Python environment.
    import asyncio

    from aiohttp import web
    from comfy_api.latest import ComfyExtension, io
    from server import PromptServer
    from typing_extensions import override

    from .audio_editor_node import MiniMaxMusic3SemanticStudioAudioEditor
    from .nodes import MiniMaxMusic3SemanticStudio
    from .vst3_editor import (
        Vst3EditorBusy,
        Vst3EditorRequestError,
        close_native_editor,
        open_native_editor,
    )
    from .vst3_host import host_status
    from .vst3_install import install_vst3_host, optional_host_status
    from .vst3_scan import scan_vst3_plugins

    scan_route = "/m3ss/vst3/scan"
    status_route = "/m3ss/vst3/host-status"
    install_host_route = "/m3ss/vst3/install-host"
    editor_route = "/m3ss/vst3/open-editor"
    close_editor_route = "/m3ss/vst3/close-editor"
    if not getattr(PromptServer.instance, "_m3ss_vst3_scan_registered", False):
        @PromptServer.instance.routes.get(scan_route)
        async def get_m3ss_vst3_plugins(request):
            return web.json_response(scan_vst3_plugins())

        PromptServer.instance._m3ss_vst3_scan_registered = True

    if not getattr(PromptServer.instance, "_m3ss_vst3_host_status_registered", False):
        @PromptServer.instance.routes.get(status_route)
        async def get_m3ss_vst3_host_status(request):
            return web.json_response(optional_host_status(host_status()))

        PromptServer.instance._m3ss_vst3_host_status_registered = True

    if not getattr(PromptServer.instance, "_m3ss_vst3_host_install_registered", False):
        @PromptServer.instance.routes.post(install_host_route)
        async def post_m3ss_vst3_host_install(request):
            current = optional_host_status(host_status())
            if current.get("ready"):
                return web.json_response({
                    "ok": True,
                    "already_installed": True,
                    "message": current.get("message", "VST3 Host is already ready."),
                    "status": current,
                })
            if not current.get("install_available"):
                return web.json_response({
                    "ok": False,
                    "message": current.get("message", "VST3 Host installation is unavailable."),
                    "status": current,
                }, status=400)

            result = await asyncio.to_thread(install_vst3_host)
            refreshed = optional_host_status(host_status())
            payload = {**result, "status": refreshed}
            if result.get("busy"):
                return web.json_response(payload, status=409)
            if result.get("ok") and refreshed.get("ready"):
                return web.json_response(payload)
            if result.get("ok") and not refreshed.get("ready"):
                payload["ok"] = False
                payload["message"] = (
                    "VST3 Host installation completed, but it could not be loaded in the current "
                    "ComfyUI process. Restart ComfyUI and open the VST3 tab again."
                )
            return web.json_response(payload, status=500)

        PromptServer.instance._m3ss_vst3_host_install_registered = True

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

    if not getattr(PromptServer.instance, "_m3ss_vst3_close_editor_registered", False):
        @PromptServer.instance.routes.post(close_editor_route)
        async def post_m3ss_vst3_close_editor(request):
            try:
                return web.json_response(await close_native_editor())
            except Vst3EditorRequestError as exc:
                return web.json_response({"ok": False, "error": str(exc)}, status=400)
            except Exception as exc:
                return web.json_response(
                    {"ok": False, "error": f"{type(exc).__name__}: {exc}"},
                    status=500,
                )

        PromptServer.instance._m3ss_vst3_close_editor_registered = True

    class MiniMaxMusic3SemanticStudioExtension(ComfyExtension):
        @override
        async def get_node_list(self) -> list[type[io.ComfyNode]]:
            return [
                MiniMaxMusic3SemanticStudio,
                MiniMaxMusic3SemanticStudioAudioEditor,
            ]

    return MiniMaxMusic3SemanticStudioExtension()


__all__ = ["comfy_entrypoint", "WEB_DIRECTORY"]
