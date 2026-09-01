import { api } from "../../scripts/api.js";
import { currentUiLocale } from "./ui_i18n.js";

const INSTALLED = "m3ssVst3HostInstallerInstalled";
const STYLE_ID = "m3ss-vst3-host-installer-style";
const tr = (en, ja) => currentUiLocale() === "ja" ? ja : en;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./vst3_host_installer.css", import.meta.url).href;
  document.head.appendChild(link);
}

async function readHostStatus() {
  const response = await api.fetchApi("/m3ss/vst3/host-status");
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok) throw new Error(result?.message || `VST3 host status failed: HTTP ${response.status}`);
  return result || {};
}

function powerShellCommand(parts) {
  const values = Array.isArray(parts) ? parts : [];
  if (!values.length) return "";
  const quoted = values.map((part) => `'${String(part).replaceAll("'", "''")}'`);
  return `& ${quoted.join(" ")}`;
}

function installIntoDialog(dialog) {
  const panel = dialog?.querySelector?.(".m3ssv2-vst3-release");
  if (!panel || panel.dataset[INSTALLED] === "1") return false;
  panel.dataset[INSTALLED] = "1";
  ensureStyles();

  const bar = document.createElement("div");
  bar.className = "m3ssv2-vst3-host-install-bar";
  bar.hidden = true;

  const detail = document.createElement("span");
  detail.className = "m3ssv2-vst3-host-install-detail";
  const copy = document.createElement("button");
  copy.type = "button";
  copy.className = "m3ssv2-button m3ssv2-vst3-host-install-button";
  copy.textContent = tr("Copy Install Command", "インストールコマンドをコピー");
  bar.append(detail, copy);

  const utility = panel.querySelector(".m3ssv2-vst3-utility");
  utility?.after(bar);
  if (!bar.isConnected) panel.prepend(bar);

  let refreshing = false;
  let command = "";

  async function refresh() {
    if (refreshing || !dialog.isConnected) return;
    refreshing = true;
    try {
      const status = await readHostStatus();
      const ready = !!status?.ready;
      const manualInstallRequired = !!status?.manual_install_required;
      command = powerShellCommand(status?.manual_install_command);
      bar.hidden = ready || !manualInstallRequired;
      detail.textContent = String(status?.message || tr(
        "VST3 Host is optional. Install it manually only if you want to use VST3 effects.",
        "VST3 Hostは任意です。VST3を使用する場合のみ手動でインストールしてください。",
      ));
      copy.disabled = !command;
      copy.title = command || detail.textContent;
    } catch (error) {
      bar.hidden = false;
      detail.textContent = String(error);
      command = "";
      copy.disabled = true;
    } finally {
      refreshing = false;
    }
  }

  copy.onclick = async () => {
    if (!command) return;
    try {
      await navigator.clipboard.writeText(command);
      copy.textContent = tr("Copied", "コピーしました");
      setTimeout(() => {
        copy.textContent = tr("Copy Install Command", "インストールコマンドをコピー");
      }, 1600);
    } catch {
      globalThis.prompt?.(tr(
        "Copy and run this command in a local PowerShell terminal, then restart ComfyUI:",
        "このコマンドをコピーしてローカルのPowerShellで実行し、ComfyUIを再起動してください:",
      ), command);
    }
  };

  const workspaceChange = (event) => {
    if (event.detail?.mode === "vst3") void refresh();
  };
  dialog.addEventListener("m3ss-workspace-mode-change", workspaceChange);
  dialog.addEventListener("m3ss-shell-close", () => {
    dialog.removeEventListener("m3ss-workspace-mode-change", workspaceChange);
  }, { once: true });

  panel.refreshVst3HostInstaller = refresh;
  void refresh();
  return true;
}

if (typeof document !== "undefined") {
  document.addEventListener("m3ss-audio-workspace-ready", (event) => {
    const dialog = event.target?.closest?.(".m3ssv2-dialog") || event.target;
    if (!dialog?.matches?.(".m3ssv2-dialog")) return;
    queueMicrotask(() => installIntoDialog(dialog));
  });

  document.addEventListener("m3ss-workspace-mode-change", (event) => {
    if (event.detail?.mode !== "vst3") return;
    const dialog = event.target?.closest?.(".m3ssv2-dialog") || event.target;
    if (dialog?.matches?.(".m3ssv2-dialog")) installIntoDialog(dialog);
  });
}
