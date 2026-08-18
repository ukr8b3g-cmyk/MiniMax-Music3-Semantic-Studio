from __future__ import annotations

import os
import time
from threading import Event, Thread
from typing import Final

WINDOW_SEARCH_TIMEOUT_SECONDS: Final[float] = 12.0
WINDOW_SEARCH_INTERVAL_SECONDS: Final[float] = 0.075


def _rect_size(rect: tuple[int, int, int, int]) -> tuple[int, int]:
    left, top, right, bottom = rect
    return max(0, right - left), max(0, bottom - top)


def _window_intersection_area(
    rect: tuple[int, int, int, int],
    work_area: tuple[int, int, int, int],
) -> int:
    left = max(rect[0], work_area[0])
    top = max(rect[1], work_area[1])
    right = min(rect[2], work_area[2])
    bottom = min(rect[3], work_area[3])
    return max(0, right - left) * max(0, bottom - top)


def should_recenter_editor_window(
    rect: tuple[int, int, int, int],
    work_area: tuple[int, int, int, int],
) -> bool:
    """Return True for the Pedalboard/JUCE upper-left default or off-screen windows."""

    width, height = _rect_size(rect)
    if width < 80 or height < 80:
        return False
    near_default_origin = rect[0] <= work_area[0] + 24 and rect[1] <= work_area[1] + 24
    visible_area = _window_intersection_area(rect, work_area)
    mostly_offscreen = visible_area < int(width * height * 0.45)
    return near_default_origin or mostly_offscreen


def centered_editor_origin(
    width: int,
    height: int,
    work_area: tuple[int, int, int, int],
) -> tuple[int, int]:
    work_left, work_top, work_right, work_bottom = work_area
    available_width = max(1, work_right - work_left)
    available_height = max(1, work_bottom - work_top)
    left = work_left + max(0, (available_width - width) // 2)
    top = work_top + max(0, (available_height - height) // 2)
    return left, top


def _window_title(plugin_name: str) -> str:
    name = str(plugin_name or "").strip()
    return f"{name} — VST3" if name else "VST3 Plugin"


def _manage_windows_editor(plugin_name: str, stop_event: Event) -> None:
    if os.name != "nt":
        return

    import ctypes
    from ctypes import wintypes

    user32 = ctypes.WinDLL("user32", use_last_error=True)
    current_pid = os.getpid()

    GWL_STYLE = -16
    GWL_EXSTYLE = -20
    WS_CAPTION = 0x00C00000
    WS_SYSMENU = 0x00080000
    WS_MINIMIZEBOX = 0x00020000
    SWP_NOZORDER = 0x0004
    SWP_NOACTIVATE = 0x0010
    SWP_FRAMECHANGED = 0x0020
    SWP_SHOWWINDOW = 0x0040
    MONITOR_DEFAULTTONEAREST = 2
    SW_SHOWNORMAL = 1

    class RECT(ctypes.Structure):
        _fields_ = [
            ("left", wintypes.LONG),
            ("top", wintypes.LONG),
            ("right", wintypes.LONG),
            ("bottom", wintypes.LONG),
        ]

    class MONITORINFO(ctypes.Structure):
        _fields_ = [
            ("cbSize", wintypes.DWORD),
            ("rcMonitor", RECT),
            ("rcWork", RECT),
            ("dwFlags", wintypes.DWORD),
        ]

    WNDENUMPROC = ctypes.WINFUNCTYPE(wintypes.BOOL, wintypes.HWND, wintypes.LPARAM)
    LONG_PTR = ctypes.c_ssize_t

    user32.EnumWindows.argtypes = [WNDENUMPROC, wintypes.LPARAM]
    user32.EnumWindows.restype = wintypes.BOOL
    user32.IsWindowVisible.argtypes = [wintypes.HWND]
    user32.IsWindowVisible.restype = wintypes.BOOL
    user32.GetWindowThreadProcessId.argtypes = [wintypes.HWND, ctypes.POINTER(wintypes.DWORD)]
    user32.GetWindowThreadProcessId.restype = wintypes.DWORD
    user32.GetWindowRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    user32.GetWindowRect.restype = wintypes.BOOL
    user32.GetClientRect.argtypes = [wintypes.HWND, ctypes.POINTER(RECT)]
    user32.GetClientRect.restype = wintypes.BOOL
    user32.GetWindowTextLengthW.argtypes = [wintypes.HWND]
    user32.GetWindowTextLengthW.restype = ctypes.c_int
    user32.GetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetWindowTextW.restype = ctypes.c_int
    user32.GetClassNameW.argtypes = [wintypes.HWND, wintypes.LPWSTR, ctypes.c_int]
    user32.GetClassNameW.restype = ctypes.c_int
    user32.GetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.GetWindowLongPtrW.restype = LONG_PTR
    user32.SetWindowLongPtrW.argtypes = [wintypes.HWND, ctypes.c_int, LONG_PTR]
    user32.SetWindowLongPtrW.restype = LONG_PTR
    user32.SetWindowTextW.argtypes = [wintypes.HWND, wintypes.LPCWSTR]
    user32.SetWindowTextW.restype = wintypes.BOOL
    user32.AdjustWindowRectEx.argtypes = [ctypes.POINTER(RECT), wintypes.DWORD, wintypes.BOOL, wintypes.DWORD]
    user32.AdjustWindowRectEx.restype = wintypes.BOOL
    user32.MonitorFromWindow.argtypes = [wintypes.HWND, wintypes.DWORD]
    user32.MonitorFromWindow.restype = wintypes.HANDLE
    user32.GetMonitorInfoW.argtypes = [wintypes.HANDLE, ctypes.POINTER(MONITORINFO)]
    user32.GetMonitorInfoW.restype = wintypes.BOOL
    user32.SetWindowPos.argtypes = [
        wintypes.HWND,
        wintypes.HWND,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        ctypes.c_int,
        wintypes.UINT,
    ]
    user32.SetWindowPos.restype = wintypes.BOOL
    user32.ShowWindow.argtypes = [wintypes.HWND, ctypes.c_int]
    user32.ShowWindow.restype = wintypes.BOOL

    def window_text(hwnd: int) -> str:
        length = max(0, int(user32.GetWindowTextLengthW(hwnd)))
        buffer = ctypes.create_unicode_buffer(length + 1)
        user32.GetWindowTextW(hwnd, buffer, len(buffer))
        return buffer.value

    def class_name(hwnd: int) -> str:
        buffer = ctypes.create_unicode_buffer(256)
        user32.GetClassNameW(hwnd, buffer, len(buffer))
        return buffer.value

    def rect_tuple(value: RECT) -> tuple[int, int, int, int]:
        return int(value.left), int(value.top), int(value.right), int(value.bottom)

    def work_area_for(hwnd: int, fallback: tuple[int, int, int, int]) -> tuple[int, int, int, int]:
        monitor = user32.MonitorFromWindow(hwnd, MONITOR_DEFAULTTONEAREST)
        if not monitor:
            return fallback
        info = MONITORINFO()
        info.cbSize = ctypes.sizeof(MONITORINFO)
        if not user32.GetMonitorInfoW(monitor, ctypes.byref(info)):
            return fallback
        return rect_tuple(info.rcWork)

    def enumerate_candidates() -> list[tuple[int, int, str, str, tuple[int, int, int, int]]]:
        candidates: list[tuple[int, int, str, str, tuple[int, int, int, int]]] = []

        @WNDENUMPROC
        def callback(hwnd: int, _lparam: int) -> bool:
            if not user32.IsWindowVisible(hwnd):
                return True
            pid = wintypes.DWORD()
            user32.GetWindowThreadProcessId(hwnd, ctypes.byref(pid))
            if int(pid.value) != current_pid:
                return True
            rect = RECT()
            if not user32.GetWindowRect(hwnd, ctypes.byref(rect)):
                return True
            value = rect_tuple(rect)
            width, height = _rect_size(value)
            if width < 120 or height < 100:
                return True
            title = window_text(hwnd)
            cls = class_name(hwnd)
            score = width * height
            folded_title = title.casefold()
            folded_plugin = plugin_name.casefold().strip()
            if folded_title == "pedalboard":
                score += 2_000_000_000
            if folded_plugin and folded_plugin in folded_title:
                score += 3_000_000_000
            if "juce" in cls.casefold():
                score += 1_000_000_000
            candidates.append((score, int(hwnd), title, cls, value))
            return True

        user32.EnumWindows(callback, 0)
        candidates.sort(reverse=True, key=lambda item: item[0])
        return candidates

    def configure(hwnd: int, original_rect: tuple[int, int, int, int]) -> bool:
        client = RECT()
        if not user32.GetClientRect(hwnd, ctypes.byref(client)):
            return False
        client_width = max(1, int(client.right - client.left))
        client_height = max(1, int(client.bottom - client.top))

        style = int(user32.GetWindowLongPtrW(hwnd, GWL_STYLE))
        exstyle = int(user32.GetWindowLongPtrW(hwnd, GWL_EXSTYLE))
        new_style = style | WS_CAPTION | WS_SYSMENU | WS_MINIMIZEBOX
        if new_style != style:
            ctypes.set_last_error(0)
            previous = user32.SetWindowLongPtrW(hwnd, GWL_STYLE, new_style)
            if previous == 0 and ctypes.get_last_error() != 0:
                return False

        frame = RECT(0, 0, client_width, client_height)
        if user32.AdjustWindowRectEx(ctypes.byref(frame), new_style, False, exstyle):
            outer_width = max(1, int(frame.right - frame.left))
            outer_height = max(1, int(frame.bottom - frame.top))
        else:
            outer_width, outer_height = _rect_size(original_rect)

        work_area = work_area_for(hwnd, original_rect)
        if should_recenter_editor_window(original_rect, work_area):
            left, top = centered_editor_origin(outer_width, outer_height, work_area)
        else:
            left, top = original_rect[0], original_rect[1]

        user32.SetWindowTextW(hwnd, _window_title(plugin_name))
        moved = user32.SetWindowPos(
            hwnd,
            0,
            int(left),
            int(top),
            int(outer_width),
            int(outer_height),
            SWP_NOZORDER | SWP_NOACTIVATE | SWP_FRAMECHANGED | SWP_SHOWWINDOW,
        )
        user32.ShowWindow(hwnd, SW_SHOWNORMAL)
        return bool(moved)

    deadline = time.monotonic() + WINDOW_SEARCH_TIMEOUT_SECONDS
    seen: dict[int, int] = {}
    while not stop_event.is_set() and time.monotonic() < deadline:
        candidates = enumerate_candidates()
        if candidates:
            _score, hwnd, _title, _class, rect = candidates[0]
            seen[hwnd] = seen.get(hwnd, 0) + 1
            if seen[hwnd] >= 2 and configure(hwnd, rect):
                return
        stop_event.wait(WINDOW_SEARCH_INTERVAL_SECONDS)


def start_native_editor_window_manager(plugin_name: str, stop_event: Event) -> Thread | None:
    """Ensure Pedalboard's Windows editor has a normal draggable frame.

    Pedalboard owns the actual VST3 editor window. The helper waits until that
    JUCE top-level window appears, adds the standard Windows caption/system
    styles when a plugin presents a borderless editor, and recentres only the
    default upper-left placement. The plugin client size is preserved.
    """

    if os.name != "nt":
        return None
    thread = Thread(
        target=_manage_windows_editor,
        args=(str(plugin_name or ""), stop_event),
        name="m3ss-vst3-window-manager",
        daemon=True,
    )
    thread.start()
    return thread
