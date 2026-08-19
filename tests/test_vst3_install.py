from types import SimpleNamespace

from vst3_install import PEDALBOARD_SPEC, install_command, install_vst3_host, optional_host_status


def test_optional_status_offers_install_only_for_missing_windows_host():
    missing = optional_host_status({"ready": False, "platform": "nt", "message": "old"})
    assert missing["install_available"] is True
    assert "Install VST3 Host" in missing["message"]

    ready = optional_host_status({"ready": True, "platform": "nt", "message": "ready"})
    assert ready["install_available"] is False
    assert ready["message"] == "ready"

    other = optional_host_status({"ready": False, "platform": "posix", "message": "unsupported"})
    assert other["install_available"] is False


def test_install_command_is_fixed_to_current_comfyui_python():
    command = install_command("C:/ComfyUI/python.exe")
    assert command == [
        "C:/ComfyUI/python.exe",
        "-m",
        "pip",
        "install",
        "--disable-pip-version-check",
        "--no-input",
        "--only-binary=:all:",
        PEDALBOARD_SPEC,
    ]


def test_windows_install_uses_no_shell_and_accepts_no_arbitrary_package():
    captured = {}

    def runner(command, **kwargs):
        captured["command"] = command
        captured["kwargs"] = kwargs
        return SimpleNamespace(returncode=0, stdout="installed", stderr="")

    result = install_vst3_host(
        runner=runner,
        executable="C:/ComfyUI/python.exe",
        platform_name="nt",
    )
    assert result["ok"] is True
    assert captured["command"][-1] == PEDALBOARD_SPEC
    assert captured["kwargs"]["shell"] is False
    assert captured["kwargs"]["check"] is False
    assert captured["kwargs"]["timeout"] == 300


def test_non_windows_install_is_refused_without_spawning_process():
    called = False

    def runner(*args, **kwargs):
        nonlocal called
        called = True
        raise AssertionError("runner must not be called")

    result = install_vst3_host(runner=runner, platform_name="posix")
    assert result["ok"] is False
    assert result["busy"] is False
    assert called is False


def test_failed_pip_install_returns_actionable_error():
    def runner(command, **kwargs):
        return SimpleNamespace(returncode=1, stdout="", stderr="wheel unavailable")

    result = install_vst3_host(runner=runner, platform_name="nt")
    assert result["ok"] is False
    assert "wheel unavailable" in result["message"]
