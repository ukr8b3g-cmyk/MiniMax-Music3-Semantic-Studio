import vst3_install
from vst3_install import PEDALBOARD_SPEC, install_command, optional_host_status


def test_optional_status_offers_manual_command_only_for_missing_windows_host():
    missing = optional_host_status({"ready": False, "platform": "nt", "message": "old"})
    assert missing["install_available"] is False
    assert missing["manual_install_required"] is True
    assert missing["manual_install_command"][-1] == PEDALBOARD_SPEC
    assert "local PowerShell" in missing["message"]

    ready = optional_host_status({"ready": True, "platform": "nt", "message": "ready"})
    assert ready["install_available"] is False
    assert ready["manual_install_required"] is False
    assert ready["manual_install_command"] == []
    assert ready["message"] == "ready"

    other = optional_host_status({"ready": False, "platform": "posix", "message": "unsupported"})
    assert other["install_available"] is False
    assert other["manual_install_required"] is False
    assert other["manual_install_command"] == []


def test_manual_install_command_is_fixed_to_current_comfyui_python():
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


def test_backend_exposes_no_callable_installer():
    assert not hasattr(vst3_install, "install_vst3_host")
