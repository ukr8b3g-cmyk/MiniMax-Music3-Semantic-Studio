from types import SimpleNamespace

from vst3_http import LOCAL_ACTION_HEADER, LOCAL_ACTION_VALUE, local_vst3_request_denial


class Transport:
    def __init__(self, host):
        self.host = host

    def get_extra_info(self, name):
        return (self.host, 8188) if name == "sockname" else None


def request(
    *,
    remote="127.0.0.1",
    socket_host="127.0.0.1",
    host="127.0.0.1:8188",
    origin=None,
    action=False,
):
    headers = {"Host": host}
    if origin is not None:
        headers["Origin"] = origin
    if action:
        headers.update({
            "Content-Type": "application/json",
            LOCAL_ACTION_HEADER: LOCAL_ACTION_VALUE,
            "Sec-Fetch-Site": "same-origin",
        })
    return SimpleNamespace(
        remote=remote,
        scheme="http",
        headers=headers,
        transport=Transport(socket_host),
    )


def denial(candidate, *, listen_address="127.0.0.1", action=False):
    return local_vst3_request_denial(
        candidate,
        listen_address=listen_address,
        require_user_action=action,
    )


def test_local_read_request_is_allowed():
    assert denial(request()) is None
    assert denial(request(remote="::ffff:127.0.0.1", host="localhost:8188")) is None


def test_network_listener_peer_and_host_are_each_denied():
    assert denial(request(), listen_address="0.0.0.0") is not None
    assert denial(request(remote="192.168.1.20")) is not None
    assert denial(request(socket_host="192.168.1.10")) is not None
    assert denial(request(host="comfy.example:8188")) is not None


def test_forwarded_request_is_denied_even_through_loopback_proxy():
    for name, value in (
        ("X-Forwarded-For", "203.0.113.10"),
        ("X-Forwarded-Proto", "https"),
        ("Via", "1.1 reverse-proxy"),
    ):
        proxied = request()
        proxied.headers[name] = value
        assert denial(proxied) is not None


def test_privileged_request_requires_explicit_json_same_origin_action():
    safe = request(origin="http://127.0.0.1:8188", action=True)
    assert denial(safe, action=True) is None

    no_marker = request(origin="http://127.0.0.1:8188")
    no_marker.headers["Content-Type"] = "application/json"
    assert denial(no_marker, action=True) is not None

    no_fetch_metadata = request(origin="http://127.0.0.1:8188", action=True)
    del no_fetch_metadata.headers["Sec-Fetch-Site"]
    assert denial(no_fetch_metadata, action=True) is not None

    form_post = request(origin="http://127.0.0.1:8188", action=True)
    form_post.headers["Content-Type"] = "application/x-www-form-urlencoded"
    assert denial(form_post, action=True) is not None


def test_cross_origin_and_host_alias_mismatches_are_denied():
    cross_site = request(origin="http://evil.example", action=True)
    cross_site.headers["Sec-Fetch-Site"] = "cross-site"
    assert denial(cross_site, action=True) is not None

    alias_mismatch = request(host="localhost:8188", origin="http://127.0.0.1:8188", action=True)
    assert denial(alias_mismatch, action=True) is not None

    port_mismatch = request(origin="http://127.0.0.1:9999", action=True)
    assert denial(port_mismatch, action=True) is not None
