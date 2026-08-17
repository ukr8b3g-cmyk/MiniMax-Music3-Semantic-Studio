import { app } from "../../scripts/app.js";
import { createStudioWindow } from "./studio_shell.js";
import { getNodeWidget } from "./node_compact.js";
import { installCssSizeDrag, makeVerticalSplitter } from "./layout_splitter.js";
import {
  el, button, field, input, select, semanticOverlay,
} from "./audio_editor_core.js";
import { currentUiLocale, installUiLocalization } from "./ui_i18n.js";

const UNIFIED_STYLE_ID = "m3ss-v2-unified-style";
const WORKSPACE_STYLE_ID = "m3ss-v2-workspace-polish";

const JA = {
  "No source audio": "ソース音声なし",
  "Queue the workflow once to load audio.": "ワークフローを一度Queueして音声を読み込んでください。",
  "Effects": "エフェクト",
  "Edit": "編集",
  "Mixer": "ミキサー",
  "Preview": "プレビュー",
  "No Source": "ソースなし",
  "Zoom": "ズーム",
  "Waveform": "波形表示",
  "Auto L/R": "自動 L/R",
  "Main Track Waveform": "メイントラック波形",
  "Main Track": "メイントラック",
  "Stereo": "ステレオ",
  "Track Gain": "トラックゲイン",
  "Track Pan": "トラックパン",
  "Preview Peak": "プレビューピーク",
  "Save Edits": "編集を保存",
  "Cancel": "キャンセル",
  "No source audio is loaded yet.": "まだソース音声が読み込まれていません。",
  "Audio-dependent editing becomes available after the first Queue.": "最初のQueue後に音声編集機能が利用できます。",
};

const tr = (text) => currentUiLocale() === "ja" ? (JA[text] || text) : text;

function ensureStyles() {
  if (!document.getElementById(UNIFIED_STYLE_ID)) {
    const link = document.createElement("link");
    link.id = UNIFIED_STYLE_ID;
    link.rel = "stylesheet";
    link.href = new URL("./audio_unified.css", import.meta.url).href;
    document.head.appendChild(link);
  }
  if (!document.getElementById(WORKSPACE_STYLE_ID)) {
    const link = document.createElement("link");
    link.id = WORKSPACE_STYLE_ID;
    link.rel = "stylesheet";
    link.href = new URL("./audio_workspace_polish.css", import.meta.url).href;
    document.head.appendChild(link);
  }
}

function emptyTab(label, className = "") {
  return button(tr(label), `m3ssv2-inspector-tab m3ssv2-workspace-tab ${className}`.trim());
}

function semanticStrip(node, host) {
  const sections = semanticOverlay(node);
  const strip = el("div", "m3ssv2-empty-section-strip");
  const duration = sections.reduce((maximum, section) => Math.max(maximum, Number(section.end) || 0), 0);
  if (duration > 0) {
    for (const section of sections) {
      const start = Math.max(0, Number(section.start) || 0) / duration * 100;
      const end = Math.max(start, Number(section.end) || 0) / duration * 100;
      const item = el("div", "m3ssv2-empty-section", section.label || "Section");
      item.style.left = `${start}%`;
      item.style.width = `${Math.max(.2, end - start)}%`;
      strip.appendChild(item);
    }
  }
  host.appendChild(strip);
}

function installEmptyTrackResize(main, waveArea) {
  const handle = el("div", "m3ssv2-track-height-handle");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.tabIndex = 0;
  waveArea.after(handle);
  const defaultHeight = 430;

  const setHeight = (value, persist = true) => {
    const maximum = Math.max(260, Math.min(760, main.clientHeight - 150 || 760));
    const next = Math.max(220, Math.min(maximum, Number(value) || defaultHeight));
    waveArea.classList.add("has-manual-track-height");
    waveArea.style.height = `${next}px`;
    waveArea.style.flexBasis = `${next}px`;
    if (persist) {
      try { localStorage.setItem("m3ss-layout:audio-track-height", String(Math.round(next))); } catch {}
    }
  };

  try {
    const stored = Number(localStorage.getItem("m3ss-layout:audio-track-height"));
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

export function openEmptyAudioEditor(node, compactSummary) {
  ensureStyles();
  const editWidget = getNodeWidget(node, "edit_json");
  let cleanupLocalization = () => {};
  let cleanupSplitter = () => {};

  const shell = createStudioWindow({
    title: "Music3 Semantic Studio Audio Editor",
    subtitle: tr("No source audio"),
    storageKey: "m3ss-audio-window",
    defaultWidth: 1480,
    defaultHeight: 920,
    minWidth: 900,
    minHeight: 620,
    onClose: () => {
      cleanupLocalization();
      cleanupSplitter();
    },
  });
  shell.window.classList.add("m3ssv2-dialog", "m3ssv2-phase-b", "m3ssv2-unified", "m3ssv2-mockup-ui", "m3ssv2-empty-editor");
  shell.window.dataset.m3ssEmptyEditor = "1";

  const root = el("div", "m3ssv2-root");
  const toolbar = el("div", "m3ssv2-toolbar m3ssv2-meta-toolbar");
  const workspace = el("div", "m3ssv2-workspace");
  const main = el("main", "m3ssv2-main");
  const paneSplitter = makeVerticalSplitter("m3ssv2-pane-splitter");
  const side = el("aside", "m3ssv2-side");
  const footer = el("footer", "m3ssv2-footer");
  root.append(toolbar, workspace, footer);
  workspace.append(main, paneSplitter, side);
  shell.content.appendChild(root);

  const preview = select([{ value: "none", label: tr("No Source") }], "none");
  preview.disabled = true;
  const undo = button("Undo"); undo.disabled = true;
  const redo = button("Redo"); redo.disabled = true;
  const fit = button("Fit"); fit.disabled = true;
  const zoom = input("range", 28, 8, 120, 1); zoom.disabled = true;
  const displayMode = select([{ value: "auto", label: tr("Auto L/R") }], "auto"); displayMode.disabled = true;
  const trackInfo = el("span", "m3ssv2-track-info", tr("No source audio"));
  const renderState = el("span", "m3ssv2-render-state", tr("Queue the workflow once to load audio."));
  toolbar.append(
    field(tr("Preview"), preview), undo, redo, fit, field(tr("Zoom"), zoom), field(tr("Waveform"), displayMode), trackInfo, renderState,
  );

  const commandDock = el("div", "m3ssv2-command-dock");
  const transport = el("div", "m3ssv2-command-group is-transport");
  const tools = el("div", "m3ssv2-command-group is-tools");
  const edits = el("div", "m3ssv2-command-group is-edit");
  for (const label of ["|◀", "▶", "Ⅱ", "■", "▶|"]) { const control = button(label, "m3ssv2-command-button"); control.disabled = true; transport.appendChild(control); }
  for (const label of ["▸ Select", "⌁ Envelope"]) { const control = button(label, "m3ssv2-command-button"); control.disabled = true; tools.appendChild(control); }
  for (const label of ["✂ Cut", "▣ Copy", "▤ Paste", "⋈ Split", "⌫ Delete", "╫ Silence"]) { const control = button(label, "m3ssv2-command-button"); control.disabled = true; edits.appendChild(control); }
  commandDock.append(transport, tools, edits);
  main.appendChild(commandDock);

  const waveHead = el("div", "m3ssv2-wave-head");
  waveHead.append(el("strong", "", tr("Main Track Waveform")), el("span", "m3ssv2-wave-note", tr("Queue the workflow once to load audio.")));
  main.appendChild(waveHead);

  const waveArea = el("div", "m3ssv2-wave-area");
  const trackStrip = el("aside", "m3ssv2-track-strip");
  trackStrip.append(el("strong", "m3ssv2-track-name", tr("Main Track")), el("span", "m3ssv2-channel-badge", tr("Stereo")));
  const row = el("div", "m3ssv2-track-button-row");
  for (const label of ["M", "S"]) { const control = button(label, "m3ssv2-track-mini-button"); control.disabled = true; row.appendChild(control); }
  const gain = input("range", 0, -24, 12, .1); gain.disabled = true;
  const pan = input("range", 0, -1, 1, .01); pan.disabled = true;
  trackStrip.append(row, el("span", "m3ssv2-track-mini-label", tr("Track Gain")), gain, el("span", "m3ssv2-track-value", "0.0 dB"), el("span", "m3ssv2-track-mini-label", tr("Track Pan")), pan, el("span", "m3ssv2-track-value", "C"));
  const meter = el("div", "m3ssv2-empty-meter");
  meter.append(el("div", "m3ssv2-empty-meter-rail"), el("div", "m3ssv2-empty-meter-rail"));
  trackStrip.append(el("strong", "m3ssv2-peak-title", tr("Preview Peak")), meter);

  const emptyWave = el("section", "m3ssv2-empty-wave");
  semanticStrip(node, emptyWave);
  const center = el("div", "m3ssv2-empty-center");
  center.append(el("strong", "", tr("No source audio is loaded yet.")), el("span", "", tr("Queue the workflow once to load audio.")));
  emptyWave.appendChild(center);
  waveArea.append(trackStrip, emptyWave);
  main.appendChild(waveArea);
  installEmptyTrackResize(main, waveArea);

  const statusDock = el("div", "m3ssv2-time-dock");
  const position = el("section", "m3ssv2-time-panel");
  position.append(el("strong", "m3ssv2-time-panel-title", "POSITION"), el("output", "m3ssv2-position-time", "00:00:00.000"));
  const selection = el("section", "m3ssv2-time-panel");
  selection.append(el("strong", "m3ssv2-time-panel-title", "SELECTION"), el("output", "m3ssv2-selection-length", "00:00:00.000"));
  statusDock.append(position, selection);
  main.appendChild(statusDock);

  const tabs = el("nav", "m3ssv2-inspector-tabs is-workspace-polished");
  const body = el("div", "m3ssv2-inspector-body");
  const effects = emptyTab("Effects", "is-effects");
  const edit = emptyTab("Edit", "is-edit");
  const mixer = emptyTab("Mixer", "is-mixer");
  tabs.append(effects, edit, mixer);
  side.append(tabs, body);

  const show = (mode) => {
    for (const [buttonNode, id] of [[effects, "effects"], [edit, "edit"], [mixer, "mixer"]]) buttonNode.classList.toggle("is-active", id === mode);
    body.replaceChildren();
    const note = el("div", "m3ssv2-empty-inspector-note");
    if (mode === "effects") note.textContent = tr("Audio-dependent editing becomes available after the first Queue.");
    else if (mode === "edit") note.textContent = tr("No source audio is loaded yet.");
    else note.textContent = tr("Audio-dependent editing becomes available after the first Queue.");
    body.appendChild(note);
  };
  effects.onclick = () => show("effects");
  edit.onclick = () => show("edit");
  mixer.onclick = () => show("mixer");
  show("effects");

  cleanupSplitter = installCssSizeDrag({
    handle: paneSplitter,
    target: workspace,
    cssVariable: "--m3ssv2-inspector-width",
    storageKey: "audio-inspector-width",
    defaultSize: 360,
    minSize: 290,
    maxSize: 680,
    invert: true,
  });

  const status = el("div", "m3ssv2-empty-status", tr("Queue the workflow once to load audio."));
  const actions = el("div", "m3ssv2-footer-actions");
  const cancel = button(tr("Cancel"));
  const save = button(tr("Save Edits"), "m3ssv2-button primary");
  save.disabled = !editWidget;
  cancel.onclick = () => shell.close();
  save.onclick = () => {
    if (editWidget) {
      compactSummary?.update?.(tr("No source audio"));
      node.setDirtyCanvas?.(true, true);
      app.graph?.setDirtyCanvas?.(true, true);
    }
    shell.close();
  };
  actions.append(cancel, save);
  footer.append(status, actions);

  shell.mount();
  cleanupLocalization = installUiLocalization(shell.window);
}
