import { app } from "../../scripts/app.js";
import { NODE_ID, nodeClass } from "./audio_editor_core.js";
import {
  createSingleEffectsState, renderSingleEffectsRack, renderSingleMixer,
} from "./audio_single_pipeline.js";
import { currentUiLocale } from "./ui_i18n.js";
import { openEmptyAudioEditor } from "./audio_empty_editor.js";

const DIALOG_INSTALLED = "m3ssWorkspacePolished";
const NODE_WRAPPED = "_m3ssEmptyEditorWrapped";
const STYLE_ID = "m3ss-v2-workspace-polish";
const AUDIO_HEIGHT_KEY = "m3ss-layout:audio-track-height";

const tr = (en, ja) => currentUiLocale() === "ja" ? ja : en;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./audio_workspace_polish.css", import.meta.url).href;
  document.head.appendChild(link);
}

function findOpenEditorButton(node) {
  return node?.widgets?.find((widget) => {
    if (widget.type !== "button") return false;
    const text = String(widget.label || widget.name || "");
    return text === "Open Audio Editor" || text === "オーディオエディターを開く";
  }) || null;
}

function wrapEmptyEditor(node) {
  if (!node || nodeClass(node) !== NODE_ID || node[NODE_WRAPPED]) return;
  const open = findOpenEditorButton(node);
  if (!open?.callback) return;
  node[NODE_WRAPPED] = true;
  const original = open.callback;
  open.callback = function (...args) {
    if (node._m3ssV2Output?.takes?.length) return original.apply(this, args);
    return openEmptyAudioEditor(node, node._m3ssV2Compact);
  };
}

function previewTakeCount(dialog) {
  const preview = dialog.querySelector(".m3ssv2-meta-toolbar select");
  return preview ? Math.max(0, preview.options.length - 2) : 0;
}

function installAudioHeightResize(dialog) {
  const main = dialog.querySelector(".m3ssv2-main");
  const waveArea = dialog.querySelector(".m3ssv2-wave-area");
  if (!main || !waveArea || waveArea.dataset.m3ssTrackResize === "1") return;
  waveArea.dataset.m3ssTrackResize = "1";

  const handle = document.createElement("div");
  handle.className = "m3ssv2-track-height-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-valuemin", "260");
  handle.setAttribute("aria-valuemax", "760");
  handle.title = tr("Drag to resize audio height · double-click to reset", "ドラッグでオーディオの高さを変更 · ダブルクリックでリセット");
  handle.tabIndex = 0;
  waveArea.after(handle);

  const defaultHeight = 430;
  const setHeight = (value, persist = true) => {
    const available = main.clientHeight || 760;
    const maximum = Math.max(260, Math.min(760, available - 150));
    const next = Math.max(260, Math.min(maximum, Number(value) || defaultHeight));
    waveArea.classList.add("has-manual-track-height");
    waveArea.style.height = `${next}px`;
    waveArea.style.flexBasis = `${next}px`;
    handle.setAttribute("aria-valuenow", String(Math.round(next)));
    if (persist) {
      try { localStorage.setItem(AUDIO_HEIGHT_KEY, String(Math.round(next))); } catch {}
    }
    window.dispatchEvent(new Event("resize"));
  };

  try {
    const stored = Number(localStorage.getItem(AUDIO_HEIGHT_KEY));
    if (Number.isFinite(stored) && stored > 0) setHeight(stored, false);
  } catch {}

  const reset = () => setHeight(defaultHeight);
  handle.ondblclick = reset;
  handle.onkeydown = (event) => {
    if (!["ArrowUp", "ArrowDown", "Home"].includes(event.key)) return;
    event.preventDefault();
    if (event.key === "Home") return reset();
    const current = waveArea.getBoundingClientRect().height || defaultHeight;
    setHeight(current + (event.key === "ArrowDown" ? 24 : -24));
  };
  handle.onpointerdown = (event) => {
    if (event.button !== 0) return;
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = waveArea.getBoundingClientRect().height || defaultHeight;
    handle.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);
    const move = (moveEvent) => setHeight(startHeight + moveEvent.clientY - startY, false);
    const done = (upEvent) => {
      handle.releasePointerCapture?.(upEvent.pointerId);
      handle.classList.remove("is-dragging");
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", done);
      handle.removeEventListener("pointercancel", done);
      setHeight(waveArea.getBoundingClientRect().height || defaultHeight, true);
    };
    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", done);
    handle.addEventListener("pointercancel", done);
  };
}

function polishSingleAudioChrome(dialog) {
  const waveTitle = dialog.querySelector(".m3ssv2-wave-head strong");
  if (waveTitle && waveTitle.textContent !== "Audio Waveform") waveTitle.textContent = "Audio Waveform";
  const waveNote = dialog.querySelector(".m3ssv2-wave-note");
  if (waveNote) waveNote.hidden = true;

  const strip = dialog.querySelector(".m3ssv2-track-strip");
  if (strip) {
    const name = strip.querySelector(".m3ssv2-track-name");
    if (name && name.textContent !== "Audio") name.textContent = "Audio";
    const buttons = [...strip.querySelectorAll(".m3ssv2-track-mini-button")];
    if (buttons[0]) buttons[0].title = "Mute / unmute audio (M)";
    if (buttons[1]) {
      buttons[1].hidden = true;
      buttons[1].tabIndex = -1;
    }
    const labels = [...strip.querySelectorAll(".m3ssv2-track-mini-label")];
    if (labels[0] && labels[0].textContent !== "Input Gain") labels[0].textContent = "Input Gain";
    if (labels[1] && labels[1].textContent !== "Pan") labels[1].textContent = "Pan";
    const ranges = [...strip.querySelectorAll('input[type="range"]')];
    if (ranges[0]) ranges[0].title = "Input Gain";
    if (ranges[1]) ranges[1].title = "Pan";
  }

  const status = dialog.querySelector(".m3ssv2-status");
  if (status?.textContent) {
    const compact = status.textContent.replace(/\s*·\s*schema\s*\d+/gi, "");
    if (compact !== status.textContent) status.textContent = compact;
  }

  const menu = dialog.querySelector(".m3ssv2-context-menu");
  if (menu && !menu.hidden) {
    for (const span of menu.querySelectorAll("button > span:first-child")) {
      if (span.textContent === "Mute Track") span.textContent = "Mute Audio";
      if (span.textContent === "Unmute Track") span.textContent = "Unmute Audio";
    }
  }
}

function installDialog(dialog) {
  if (!dialog || dialog.dataset.m3ssEmptyEditor === "1" || dialog.dataset[DIALOG_INSTALLED] === "1") return;
  const tabs = dialog.querySelector(".m3ssv2-inspector-tabs");
  const body = dialog.querySelector(".m3ssv2-inspector-body");
  if (!tabs || !body) return;

  const originals = [...tabs.querySelectorAll(".m3ssv2-inspector-tab")].slice(0, 5);
  if (originals.length < 5) return;
  const [trackTab, clipTab, envelopeTab, masterTab] = originals;

  ensureStyles();
  dialog.dataset[DIALOG_INSTALLED] = "1";
  dialog.dataset.m3ssSingleAudio = "1";
  installAudioHeightResize(dialog);
  polishSingleAudioChrome(dialog);

  if (previewTakeCount(dialog) <= 1) {
    const useTake = [...dialog.querySelectorAll(".m3ssv2-secondary-commands button")]
      .find((item) => /Use Preview Take|プレビューテイクを使用/.test(String(item.textContent || "")));
    if (useTake) useTake.hidden = true;
  }

  for (const tab of originals) tab.hidden = true;

  const state = {
    mode: "edit",
    rendering: false,
    effects: createSingleEffectsState(),
  };

  const makeTab = (id, label, className) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `m3ssv2-inspector-tab m3ssv2-workspace-tab ${className}`;
    tab.dataset.m3ssMode = id;
    tab.setAttribute("role", "tab");
    tab.textContent = label;
    tab.onclick = () => {
      state.mode = id;
      renderActive();
    };
    tabs.appendChild(tab);
    return tab;
  };

  const editTab = makeTab("edit", tr("Edit", "編集"), "is-edit");
  const mixerTab = makeTab("mixer", tr("Mixer", "ミキサー"), "is-mixer");
  const effectsTab = makeTab("effects", tr("Effects", "エフェクト"), "is-effects");
  tabs.classList.add("is-workspace-polished");
  tabs.setAttribute("role", "tablist");

  const visibleTabs = new Map([
    ["edit", editTab],
    ["mixer", mixerTab],
    ["effects", effectsTab],
  ]);

  const syncTabState = () => {
    const previous = dialog.dataset.m3ssWorkspaceMode || "";
    dialog.dataset.m3ssWorkspaceMode = state.mode;
    for (const [id, tab] of visibleTabs) {
      const active = id === state.mode;
      tab.classList.toggle("is-active", active);
      tab.setAttribute("aria-selected", active ? "true" : "false");
    }
    if (previous !== state.mode) {
      dialog.dispatchEvent(new CustomEvent("m3ss-workspace-mode-change", { detail: { mode: state.mode } }));
    }
  };

  const officialClick = (tab) => tab?.click();
  const projectContext = () => {
    if (!body._m3ssEffectsContext?.project) officialClick(masterTab);
    return body._m3ssEffectsContext;
  };

  const renderEdit = () => {
    const envelopeButton = [...dialog.querySelectorAll(".m3ssv2-command-button")]
      .find((item) => String(item.title || "").startsWith("Envelope Tool"));
    officialClick(envelopeButton?.classList.contains("is-active") ? envelopeTab : clipTab);
  };

  const renderMixer = () => {
    const context = projectContext();
    if (!context?.project || typeof context.commit !== "function") {
      body.replaceChildren(el("div", "m3ssv2-empty", tr("Mixer is unavailable.", "ミキサーを利用できません。")));
      return;
    }
    renderSingleMixer(body, context.project, context.commit);
  };

  const renderEffects = () => {
    const context = projectContext();
    if (!context?.project || typeof context.commit !== "function") {
      body.replaceChildren(el("div", "m3ssv2-empty", tr("Effects are unavailable.", "エフェクトを利用できません。")));
      return;
    }
    renderSingleEffectsRack(body, context.project, context.commit, state.effects);
  };

  function renderActive() {
    if (state.rendering || !dialog.isConnected) return;
    state.rendering = true;
    syncTabState();
    try {
      if (state.mode === "vst3") {
        polishSingleAudioChrome(dialog);
        return;
      }
      if (state.mode === "mixer") renderMixer();
      else if (state.mode === "effects") renderEffects();
      else renderEdit();
      polishSingleAudioChrome(dialog);
    } finally {
      state.rendering = false;
    }
  }

  const bodyObserver = new MutationObserver(() => {
    if (!dialog.isConnected) {
      bodyObserver.disconnect();
      return;
    }
    polishSingleAudioChrome(dialog);
    if (state.rendering || state.mode === "vst3") return;
    if (state.mode === "effects" && !body.querySelector(".m3ssv2-single-effects")) queueMicrotask(renderActive);
    else if (state.mode === "mixer" && !body.querySelector(".m3ssv2-single-mixer")) queueMicrotask(renderActive);
  });
  bodyObserver.observe(body, { childList: true, subtree: false });

  const chromeObserver = new MutationObserver(() => polishSingleAudioChrome(dialog));
  for (const target of [
    dialog.querySelector(".m3ssv2-track-strip"),
    dialog.querySelector(".m3ssv2-status"),
    dialog.querySelector(".m3ssv2-context-menu"),
  ].filter(Boolean)) {
    chromeObserver.observe(target, { childList: true, subtree: true, characterData: true });
  }

  const envelopeButton = [...dialog.querySelectorAll(".m3ssv2-command-button")]
    .find((item) => String(item.title || "").startsWith("Envelope Tool"));
  const selectButton = [...dialog.querySelectorAll(".m3ssv2-command-button")]
    .find((item) => String(item.title || "").startsWith("Select Tool"));

  envelopeButton?.addEventListener("click", () => {
    state.mode = "edit";
    queueMicrotask(renderActive);
  });
  selectButton?.addEventListener("click", () => {
    if (state.mode === "edit") queueMicrotask(renderActive);
  });
  dialog.addEventListener("click", (event) => {
    if (!event.target.closest?.(".m3ssv2-wave-clip")) return;
    state.mode = "edit";
    queueMicrotask(renderActive);
  }, true);

  dialog._m3ssSingleAudioContext = () => projectContext();
  dialog._m3ssSingleAudioRefresh = () => queueMicrotask(renderActive);
  dialog._m3ssSetWorkspaceMode = (mode) => {
    state.mode = ["edit", "mixer", "effects", "vst3"].includes(mode) ? mode : "edit";
    renderActive();
  };

  queueMicrotask(renderActive);
}

function scanDialogs() {
  for (const dialog of document.querySelectorAll(".m3ssv2-dialog")) installDialog(dialog);
}

if (typeof document !== "undefined") {
  ensureStyles();
  scanDialogs();
  const observer = new MutationObserver(scanDialogs);
  observer.observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
  name: "minimax.music3.semantic.studio.audio-workspace-polish",
  async nodeCreated(node) {
    if (nodeClass(node) !== NODE_ID) return;
    queueMicrotask(() => wrapEmptyEditor(node));
    setTimeout(() => wrapEmptyEditor(node), 80);
  },
});
