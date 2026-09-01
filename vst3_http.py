from __future__ import annotations

import ipaddress
from typing import Any
from urllib.parse import urlsplit


LOCAL_ACTION_HEADER = "X-M3SS-Local-Action"
LOCAL_ACTION_VALUE = "vst3-ui"
_PROXY_CLIENT_HEADERS = {
    "cf-connecting-ip",
    "client-ip",
    "fastly-client-ip",
    "true-client-ip",
    "via",
    "x-client-ip",
    "x-cluster-client-ip",
    "x-real-ip",
}


def _is_loopback_host(value: Any) -> bool:
    host = str(value or "").strip().rstrip(".").casefold()
    if host == "localhost":
        return True
    if not host:
        return False
    if "%" in host:
        host = host.split("%", 1)[0]
    try:
        address = ipaddress.ip_address(host)
    except ValueError:
        return False
    if address.is_loopback:
        return True
    mapped = getattr(address, "ipv4_mapped", None)
    return bool(mapped and mapped.is_loopback)


def _authority(authority: Any) -> tuple[str | None, int | None]:
    value = str(authority or "").strip()
    if not value:
        return None, None
    try:
        parsed = urlsplit(f"//{value}", allow_fragments=False)
        if parsed.username is not None or parsed.password is not None:
            return None, None
        return parsed.hostname, parsed.port
    except ValueError:
        return None, None


def _effective_port(scheme: str, port: int | None) -> int | None:
    if port is not None:
        return port
    return {"http": 80, "https": 443}.get(scheme.casefold())


def _local_socket_host(request: Any) -> Any:
    transport = getattr(request, "transport", None)
    if transport is None:
        return None
    try:
        socket_name = transport.get_extra_info("sockname")
    except (AttributeError, OSError):
        return None
    if isinstance(socket_name, (tuple, list)) and socket_name:
        return socket_name[0]
    return None


def _has_proxy_headers(headers: Any) -> bool:
    try:
        items = headers.items()
    except AttributeError:
        return True
    for name, value in items:
        normalized = str(name or "").strip().casefold()
        if value and (
            normalized == "forwarded"
            or normalized.startswith("x-forwarded-")
            or normalized in _PROXY_CLIENT_HEADERS
        ):
            return True
    return False


def local_vst3_request_denial(
    request: Any,
    *,
    listen_address: Any,
    require_user_action: bool = False,
) -> str | None:
    """Return a denial reason unless a VST3 HTTP request is strictly local.

    Privileged requests additionally require a same-origin browser POST marked by
    the VST3 UI. Unknown or malformed request metadata is denied rather than
    treated as local.
    """

    if not _is_loopback_host(listen_address):
        return "ComfyUI is not listening on a loopback address."
    if not _is_loopback_host(getattr(request, "remote", None)):
        return "The request peer is not a loopback address."
    if not _is_loopback_host(_local_socket_host(request)):
        return "The request did not arrive on a loopback socket."

    headers = getattr(request, "headers", {}) or {}
    if _has_proxy_headers(headers):
        return "Forwarded VST3 requests are not allowed."
    host_name, host_port = _authority(headers.get("Host"))
    if not _is_loopback_host(host_name):
        return "The request Host is not a loopback address."
    if not require_user_action:
        return None

    content_type = str(headers.get("Content-Type") or "").split(";", 1)[0].strip().casefold()
    if content_type != "application/json":
        return "Privileged VST3 requests must use JSON."
    if str(headers.get(LOCAL_ACTION_HEADER) or "") != LOCAL_ACTION_VALUE:
        return "The explicit local VST3 action marker is missing."

    fetch_site = str(headers.get("Sec-Fetch-Site") or "").strip().casefold()
    if fetch_site != "same-origin":
        return "The browser request is not same-origin."

    origin_text = str(headers.get("Origin") or "").strip()
    if not origin_text:
        return "The browser Origin is missing."
    try:
        origin = urlsplit(origin_text)
        origin_port = origin.port
    except ValueError:
        return "The browser Origin is malformed."
    if (
        origin.username is not None
        or origin.password is not None
        or origin.path not in {"", "/"}
        or origin.query
        or origin.fragment
    ):
        return "The browser Origin is malformed."
    request_scheme = str(getattr(request, "scheme", "") or "").casefold()
    origin_scheme = origin.scheme.casefold()
    if origin_scheme not in {"http", "https"} or origin_scheme != request_scheme:
        return "The browser Origin scheme does not match the request."
    if not _is_loopback_host(origin.hostname):
        return "The browser Origin is not loopback."
    if str(origin.hostname or "").rstrip(".").casefold() != str(host_name or "").rstrip(".").casefold():
        return "The browser Origin host does not match Host."
    if _effective_port(origin_scheme, origin_port) != _effective_port(request_scheme, host_port):
        return "The browser Origin port does not match Host."
    return None
