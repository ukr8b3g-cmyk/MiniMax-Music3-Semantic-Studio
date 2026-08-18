import { app } from "../../scripts/app.js";
import { NODE_ID, nodeClass } from "./audio_editor_core.js";
import { createVst3BrowserPanel } from "./vst3_browser.js";

const STYLE_ID = "m3ss-vst3-browser-style";
const BRIDGE_EXTENSION = "minimax.music3.vst3.phase2c.bridge";
let pendingNode = null;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./vst3_browser.css", import.meta.url).href;
  document.head.appendChild(link);
}

function installOpenHook(node, attempt = 0) {
  if (!node || node._m3ssVst3OpenHookInstalled) return;
  const widget = node.widgets?.find((item) => item?.name === "Open Audio Editor" || item?.label === "Open Audio Editor");
  if (!widget?.callback) {
    if (attempt < 12) requestAnimationFrame(() => installOpenHook(node, attempt + 1));
    return;
  }
  const original = widget.callback;
  widget.callback = function (...args) {
    pendingNode = node;
    return original.apply(this, args);
  };
  node._m3ssVst3OpenHookInstalled = true;
}

function resolveDialogNode() {
  if (pendingNode) {
    const node = pendingNode;
    pendingNode = null;
    return node;
  }
  const matches = (app.graph?._nodes || []).filter((node) => nodeClass(node) === NODE_ID);
  return matches.length === 1 ? matches[0] : null;
}

function nativeEditorIsOpen(panel) {
  return panel?.dataset?.m3ssVst3EditorOpen === "1";
}

function mountPanel(dialog) {
  const side = dialog?.querySelector?.(".m3ssv2-side");
  const tabs = side?.querySelector?.(".m3ssv2-inspector-tabs");
  const inspectorBody = side?.querySelector?.(".m3ssv2-inspector-body");
  if (!side || !tabs || !inspectorBody || side.dataset.m3ssVst3Phase2cMounted === "1") return;
  side.dataset.m3ssVst3Phase2cMounted = "1";
  ensureStyles();

  const node = resolveDialogNode();
  const panel = createVst3BrowserPanel({ node });
  panel.classList.add("m3ssv2-vst3-tab-panel");
  panel.hidden = true;
  side.appendChild(panel);

  const vstTab = document.createElement("button");
  vstTab.type = "button";
  vstTab.className = "m3ssv2-inspector-tab m3ssv2-workspace-tab m3ssv2-vst3-tab";
  vstTab.dataset.m3ssMode = "vst3";
  vstTab.setAttribute("role", "tab");
  vstTab.setAttribute("aria-selected", "false");
  vstTab.textContent = "VST3";
  vstTab.title = "Installed VST3 effects";
  tabs.appendChild(vstTab);

  const placeVstTab = () => {
    const effectsTab = tabs.querySelector('.m3ssv2-workspace-tab[data-m3ss-mode="effects"]');
    if (effectsTab && effectsTab.nextElementSibling !== vstTab) effectsTab.after(vstTab);
  };
  placeVstTab();
  const tabObserver = new MutationObserver(placeVstTab);
  tabObserver.observe(tabs, { childList: true });

  const showVst3 = () => {
    for (const tab of tabs.querySelectorAll(".m3ssv2-workspace-tab")) {
      const active = tab === vstTab;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    dialog.dataset.m3ssWorkspaceMode = "vst3";
    inspectorBody.hidden = true;
    panel.hidden = false;
    if (panel.dataset.m3ssVst3Scanned !== "1") {
      panel.dataset.m3ssVst3Scanned = "1";
      panel.runScan?.();
    }
  };

  const showCoreInspector = () => {
    vstTab.classList.remove("is-active");
    vstTab.setAttribute("aria-selected", "false");
    panel.hidden = true;
    inspectorBody.hidden = false;
  };

  vstTab.addEventListener("click", showVst3);
  tabs.addEventListener("click", (event) => {
    const tab = event.target?.closest?.(".m3ssv2-workspace-tab");
    if (!tab || tab === vstTab) return;
    showCoreInspector();
  });

  // Save is blocked before the core handler if a native VST3 editor is still
  // open. Otherwise the core editor saves first, then the VST3 state is merged
  // in a microtask so Cancel continues to discard unsaved VST3 changes.
  dialog.addEventListener("click", (event) => {
    const target = event.target?.closest?.("button");
    if (!target || String(target.textContent || "").trim() !== "Save Edits") return;
    if (!nativeEditorIsOpen(panel)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    alert("Use Close UI in the VST3 rack first. The plugin state is captured when the native window closes.");
  }, true);

  dialog.addEventListener("click", (event) => {
    const target = event.target?.closest?.("button");
    if (!target || String(target.textContent || "").trim() !== "Save Edits") return;
    queueMicrotask(() => panel.persistVst3State?.());
  });
}

function scanRoot(root = document) {
  for (const dialog of root.querySelectorAll?.(".m3ssv2-dialog") || []) mountPanel(dialog);
  if (root.matches?.(".m3ssv2-dialog")) mountPanel(root);
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(".m3ssv2-dialog") || node.querySelector?.(".m3ssv2-dialog")) scanRoot(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
scanRoot();

app.registerExtension({
  name: BRIDGE_EXTENSION,
  async nodeCreated(node) {
    if (nodeClass(node) !== NODE_ID) return;
    installOpenHook(node);
  },
});
