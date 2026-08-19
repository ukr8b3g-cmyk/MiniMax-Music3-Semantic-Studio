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

async function installHost() {
  const response = await api.fetchApi("/m3ss/vst3/install-host", { method: "POST" });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || !result?.ok) {
    throw new Error(result?.message || `VST3 host installation failed: HTTP ${response.status}`);
  }
  return result;
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
  const install = document.createElement("button");
  install.type = "button";
  install.className = "m3ssv2-button m3ssv2-vst3-host-install-button";
  install.textContent = tr("Install VST3 Host", "VST3 Hostをインストール");
  bar.append(detail, install);

  const utility = panel.querySelector(".m3ssv2-vst3-utility");
  utility?.after(bar);
  if (!bar.isConnected) panel.prepend(bar);

  let refreshing = false;
  let installing = false;

  async function refresh() {
    if (refreshing || installing || !dialog.isConnected) return;
    refreshing = true;
    try {
      const status = await readHostStatus();
      const ready = !!status?.ready;
      const available = !!status?.install_available;
      bar.hidden = ready || !available;
      detail.textContent = String(status?.message || tr(
        "VST3 Host is optional. Install it only if you want to use VST3 effects.",
        "VST3 Hostは任意です。VST3を使用する場合だけインストールしてください。",
      ));
      install.disabled = !available;
      install.title = detail.textContent;
    } catch (error) {
      bar.hidden = false;
      detail.textContent = String(error);
      install.disabled = true;
    } finally {
      refreshing = false;
    }
  }

  install.onclick = async () => {
    if (installing) return;
    installing = true;
    install.disabled = true;
    install.textContent = tr("Installing…", "インストール中…");
    detail.textContent = tr(
      "Installing Pedalboard into the Python environment currently running ComfyUI…",
      "現在ComfyUIを実行しているPython環境へPedalboardをインストールしています…",
    );
    try {
      const result = await installHost();
      detail.textContent = String(result?.message || tr("VST3 Host installed.", "VST3 Hostをインストールしました。"));
      await panel.runScan?.();
    } catch (error) {
      detail.textContent = String(error);
    } finally {
      installing = false;
      install.textContent = tr("Install VST3 Host", "VST3 Hostをインストール");
      await refresh();
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
