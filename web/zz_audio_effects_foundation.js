import { app } from "../../scripts/app.js";
import { NODE_ID, nodeClass } from "./audio_editor_core.js";
import { createEffectsRackState, renderEffectsRack } from "./audio_effects.js";
import { currentUiLocale } from "./ui_i18n.js";
import { openEmptyAudioEditor } from "./audio_empty_editor.js";

const DIALOG_INSTALLED = "m3ssWorkspacePolished";
const NODE_WRAPPED = "_m3ssEmptyEditorWrapped";
const STYLE_ID = "m3ss-v2-workspace-polish";
const TRACK_HEIGHT_KEY = "m3ss-layout:audio-track-height";

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

function installTrackHeightResize(dialog) {
  const main = dialog.querySelector(".m3ssv2-main");
  const waveArea = dialog.querySelector(".m3ssv2-wave-area");
  if (!main || !waveArea || waveArea.dataset.m3ssTrackResize === "1") return;
  waveArea.dataset.m3ssTrackResize = "1";
  const handle = document.createElement("div");
  handle.className = "m3ssv2-track-height-handle";
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.tabIndex = 0;
  waveArea.after(handle);

  const defaultHeight = 430;
  const setHeight = (value, persist = true) => {
    const available = main.clientHeight || 760;
    const maximum = Math.max(260, Math.min(760, available - 150));
    const next = Math.max(220, Math.min(maximum, Number(value) || defaultHeight));
    waveArea.classList.add("has-manual-track-height");
    waveArea.style.height = `${next}px`;
    waveArea.style.flexBasis = `${next}px`;
    handle.setAttribute("aria-valuenow", String(Math.round(next)));
    if (persist) {
      try { localStorage.setItem(TRACK_HEIGHT_KEY, String(Math.round(next))); } catch {}
    }
    window.dispatchEvent(new Event("resize"));
  };

  try {
    const stored = Number(localStorage.getItem(TRACK_HEIGHT_KEY));
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

function installDialog(dialog) {
  if (!dialog || dialog.dataset.m3ssEmptyEditor === "1" || dialog.dataset[DIALOG_INSTALLED] === "1") return;
  const tabs = dialog.querySelector(".m3ssv2-inspector-tabs");
  const body = dialog.querySelector(".m3ssv2-inspector-body");
  if (!tabs || !body) return;
  const originals = [...tabs.querySelectorAll(".m3ssv2-inspector-tab")].slice(0, 5);
  if (originals.length < 5) return;

  ensureStyles();
  dialog.dataset[DIALOG_INSTALLED] = "1";
  installTrackHeightResize(dialog);

  const [trackTab, clipTab, envelopeTab, masterTab, takesTab] = originals;
  for (const tab of originals) tab.hidden = true;

  const state = {
    mode: "effects",
    rendering: false,
    effects: createEffectsRackState(),
  };

  const makeTab = (id, label, className) => {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = `m3ssv2-inspector-tab m3ssv2-workspace-tab ${className}`;
    tab.textContent = label;
    tab.onclick = () => {
      state.mode = id;
      renderActive();
    };
    tabs.appendChild(tab);
    return tab;
  };

  const effectsTab = makeTab("effects", tr("Effects", "エフェクト"), "is-effects");
  const editTab = makeTab("edit", tr("Edit", "編集"), "is-edit");
  const mixerTab = makeTab("mixer", tr("Mixer", "ミキサー"), "is-mixer");
  const sourcesTab = previewTakeCount(dialog) > 1
    ? makeTab("sources", tr("Sources", "ソース"), "is-sources")
    : null;
  tabs.classList.add("is-workspace-polished");

  const visibleTabs = new Map([
    ["effects", effectsTab],
    ["edit", editTab],
    ["mixer", mixerTab],
    ...(sourcesTab ? [["sources", sourcesTab]] : []),
  ]);

  const syncTabState = () => {
    for (const [id, tab] of visibleTabs) tab.classList.toggle("is-active", id === state.mode);
  };

  const officialClick = (tab) => {
    tab?.click();
  };

  const renderEffects = () => {
    if (!body._m3ssEffectsContext?.project) officialClick(masterTab);
    const context = body._m3ssEffectsContext;
    if (!context?.project || typeof context.commit !== "function") {
      body.replaceChildren();
      const note = document.createElement("div");
      note.className = "m3ssv2-empty";
      note.textContent = tr("Effects are not available yet.", "エフェクトをまだ利用できません。");
      body.appendChild(note);
      return;
    }
    renderEffectsRack(body, context.project, context.commit, state.effects);
  };

  const renderEdit = () => {
    const envelopeButton = [...dialog.querySelectorAll(".m3ssv2-command-button")]
      .find((button) => String(button.title || "").startsWith("Envelope Tool"));
    officialClick(envelopeButton?.classList.contains("is-active") ? envelopeTab : clipTab);
  };

  const renderMixer = () => {
    officialClick(trackTab);
    const trackSection = document.createElement("section");
    trackSection.className = "m3ssv2-mixer-section";
    const trackTitle = document.createElement("h3");
    trackTitle.textContent = tr("Track", "トラック");
    trackSection.append(trackTitle, ...body.childNodes);

    officialClick(masterTab);
    const masterSection = document.createElement("section");
    masterSection.className = "m3ssv2-mixer-section";
    const masterTitle = document.createElement("h3");
    masterTitle.textContent = tr("Master", "マスター");
    masterSection.append(masterTitle, ...body.childNodes);

    const stack = document.createElement("div");
    stack.className = "m3ssv2-mixer-stack";
    stack.append(trackSection, masterSection);
    body.replaceChildren(stack);
  };

  const renderSources = () => officialClick(takesTab);

  function renderActive() {
    if (state.rendering || !dialog.isConnected) return;
    state.rendering = true;
    syncTabState();
    try {
      if (state.mode === "effects") renderEffects();
      else if (state.mode === "edit") renderEdit();
      else if (state.mode === "mixer") renderMixer();
      else renderSources();
    } finally {
      state.rendering = false;
    }
  }

  const observer = new MutationObserver(() => {
    if (!dialog.isConnected) {
      observer.disconnect();
      return;
    }
    if (state.rendering) return;
    if (state.mode === "effects" && !body.querySelector(".m3ssv2-effects-root")) queueMicrotask(renderActive);
    else if (state.mode === "mixer" && !body.querySelector(".m3ssv2-mixer-stack")) queueMicrotask(renderActive);
  });
  observer.observe(body, { childList: true, subtree: false });

  const envelopeButton = [...dialog.querySelectorAll(".m3ssv2-command-button")]
    .find((button) => String(button.title || "").startsWith("Envelope Tool"));
  const selectButton = [...dialog.querySelectorAll(".m3ssv2-command-button")]
    .find((button) => String(button.title || "").startsWith("Select Tool"));

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
