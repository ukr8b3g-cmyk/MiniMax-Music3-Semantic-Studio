import json
import os
from threading import Event

import vst3_editor_process
import vst3_window


def test_default_upper_left_editor_is_recentered():
    work = (0, 0, 1920, 1040)
    assert vst3_window.should_recenter_editor_window((0, 0, 460, 510), work) is True
    assert vst3_window.should_recenter_editor_window((240, 120, 700, 630), work) is False


def test_offscreen_editor_is_recentered_and_origin_is_bounded():
    work = (1920, 0, 3840, 1040)
    assert vst3_window.should_recenter_editor_window((3800, 900, 4300, 1450), work) is True
    assert vst3_window.centered_editor_origin(500, 550, work) == (2630, 245)


def test_window_manager_is_dependency_free_noop_off_windows():
    if os.name == "nt":
        return
    assert vst3_window.start_native_editor_window_manager("Test FX", Event()) is None


def test_windows_api_bindings_initialize_without_an_editor():
    if os.name != "nt":
        return
    stop = Event()
    stop.set()
    vst3_window._manage_windows_editor("Test FX", stop)


def test_windows_manager_frames_and_centres_borderless_window():
    if os.name != "nt":
        return

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    kernel32 = ctypes.WinDLL("kernel32", use_last_error=True)
    WS_POPUP = 0x80000000
    WS_VISIBLE = 0x10000000
    WS_CAPTION = 0x00C00000
    GWL_STYLE = -16

    class RECT(ctypes.Structure):
        _fields_ = [
            ("left", wintypes.LONG),
            ("top", wintypes.LONG),
            ("right", wintypes.LONG),
            ("bottom", wintypes.LONG),
        ]

    kernel32.GetModuleHandleW.argtypes = [wintypes.LPCWSTR]
    kernel32.GetModuleHandleW.restype = wintypes.HMODULE
    user32.CreateWindowExW.argtypes = [
        wintypes.DWORD,
        wintypes.LPCWSTR,
        wintypes.LPCWSTR,
        wintypes.DWORD,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.HWND,
        wintypes.HMENU,
        wintypes.HINSTANCE,
        wintypes.LPVOID,
    ]
    user32.CreateWindowExW.restype = wintypes.HWND
    user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowLongPtrW.restype = ctypes.c_ssize_t
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    user32.GetClientRect.restype = wintypes.BOOL
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.DestroyWindow.argtypes = [wintypes.HWND]
    user32.DestroyWindow.restype = wintypes.BOOL

    hwnd = user32.CreateWindowExW(
        0,
        "STATIC",
        "Pedalboard",
        WS_POPUP | WS_VISIBLE,
        0,
        0,
        460,
        510,
        0,
        0,
        kernel32.GetModuleHandleW(None),
        None,
    )
    assert hwnd

    old_timeout = vst3_window.WINDOW_SEARCH_TIMEOUT_SECONDS
    old_interval = vst3_window.WINDOW_SEARCH_INTERVAL_SECONDS
    try:
        vst3_window.WINDOW_SEARCH_TIMEOUT_SECONDS = 1.0
        vst3_window.WINDOW_SEARCH_INTERVAL_SECONDS = 0.02
        vst3_window._manage_windows_editor("Test FX", Event())

        style = int(user32.GetWindowLongPtrW(hwnd, GWL_STYLE))
        assert style & WS_CAPTION == WS_CAPTION

        title = ctypes.create_unicode_buffer(256)
        user32.GetWindowTextW(hwnd, title, len(title))
        assert title.value == "Test FX — VST3"

        rect = RECT()
        assert user32.GetWindowRect(hwnd, ctypes.byref(rect))
        assert int(rect.left) > 24 or int(rect.top) > 24

        client = RECT()
        assert user32.GetClientRect(hwnd, ctypes.byref(client))
        assert int(client.right - client.left) == 460
        assert int(client.bottom - client.top) == 510
    finally:
        vst3_window.WINDOW_SEARCH_TIMEOUT_SECONDS = old_timeout
        vst3_window.WINDOW_SEARCH_INTERVAL_SECONDS = old_interval
        user32.DestroyWindow(hwnd)


def test_editor_helper_stops_window_manager_after_native_ui(monkeypatch, tmp_path):
    class FakePlugin:
        is_effect = True
        name = "Test FX"
        identifier = "test.fx"
        version = "1.0"
        manufacturer_name = "Test"
        preset_data = b"state"
        raw_state = b""

        def show_editor(self, close_event):
            assert close_event.is_set() is False
            assert manager_stop.is_set() is False

    class FakeManager:
        def __init__(self):
            self.joined = False

        def join(self, timeout=None):
            assert timeout == 0.75
            self.joined = True

    manager = FakeManager()
    manager_stop = Event()

    def start_manager(plugin_name, stop_event):
        assert plugin_name == "Test FX"
        assert stop_event.is_set() is False
        nonlocal manager_stop
        manager_stop = stop_event
        return manager

    monkeypatch.setattr(vst3_editor_process, "_load_plugin", lambda path, name: FakePlugin())
    monkeypatch.setattr(vst3_editor_process, "_start_close_watcher", lambda event, stream=None: None)
    monkeypatch.setattr(vst3_editor_process, "start_native_editor_window_manager", start_manager)

    bundle = tmp_path / "Test FX.vst3"
    bundle.mkdir()
    input_path = tmp_path / "input.json"
    output_path = tmp_path / "output.json"
    input_path.write_text(json.dumps({
        "path": str(bundle),
        "plugin_name": "Test FX",
        "state_kind": "preset_data",
        "state_b64": "",
    }), encoding="utf-8")

    vst3_editor_process.run(input_path, output_path)
    result = json.loads(output_path.read_text(encoding="utf-8"))
    assert result["ok"] is True
    assert manager_stop.is_set() is True
    assert manager.joined is True
