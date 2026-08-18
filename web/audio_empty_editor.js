import { createStudioWindow } from "./studio_shell.js";
import { installCssSizeDrag, makeVerticalSplitter } from "./layout_splitter.js";
import {
  el, button, field, input, select, semanticOverlay,
} from "./audio_editor_core.js";
import { currentUiLocale, installUiLocalization } from "./ui_i18n.js";

const UNIFIED_STYLE_ID = "m3ss-v2-unified-style";
const WORKSPACE_STYLE_ID = "m3ss-v2-workspace-polish";
const PHASE2D_STYLE_ID = "m3ss-audio-phase2d-style";

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
  "Audio Waveform": "オーディオ波形",
  "Audio": "オーディオ",
  "Stereo": "ステレオ",
  "Input Gain": "入力ゲイン",
  "Pan": "パン",
  "Preview Peak": "プレビューピーク",
  "Close": "閉じる",
  "No source audio is loaded yet.": "まだソース音声が読み込まれていません。",
  "Audio-dependent editing becomes available after the first Queue.": "最初のQueue後に音声編集機能が利用できます。",
  "Drag to resize audio height · double-click to reset": "ドラッグでオーディオの高さを変更 · ダブルクリックでリセット",
};

const tr = (text) => currentUiLocale() === "ja" ? (JA[text] || text) : text;

function ensureStyles() {
  for (const [id, file] of [
    [UNIFIED_STYLE_ID, "./audio_unified.css"],
    [WORKSPACE_STYLE_ID, "./audio_workspace_polish.css"],
    [PHASE2D_STYLE_ID, "./audio_phase2d.css"],
  ]) {
    if (document.getElementById(id)) continue;
    const link = document.createElement("link");
    link.id = id;
    link.rel = "stylesheet";
    link.href = new URL(file, import.meta.url).href;
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

function installEmptyAudioResize(main, waveArea) {
  const handle = el("div", "m3ssv2-track-height-handle");
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "horizontal");
  handle.setAttribute("aria-valuemin", "260");
  handle.setAttribute("aria-valuemax", "760");
  handle.title = tr("Drag to resize audio height · double-click to reset");
  handle.tabIndex = 0;
  waveArea.after(handle);
  const defaultHeight = 430;

  const setHeight = (value, persist = true) => {
    const maximum = Math.max(260, Math.min(760, main.clientHeight - 150 || 760));
    const next = Math.max(260, Math.min(maximum, Number(value) || defaultHeight));
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
  shell.window.dataset.m3ssSingleAudio = "1";

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
  const audioInfo = el("span", "m3ssv2-track-info", tr("No source audio"));
  const renderState = el("span", "m3ssv2-render-state", tr("Queue the workflow once to load audio."));
  toolbar.append(
    field(tr("Preview"), preview), undo, redo, fit, field(tr("Zoom"), zoom), field(tr("Waveform"), displayMode), audioInfo, renderState,
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
  waveHead.append(el("strong", "", tr("Audio Waveform")), el("span", "m3ssv2-wave-note", tr("Queue the workflow once to load audio.")));
  main.appendChild(waveHead);

  const waveArea = el("div", "m3ssv2-wave-area");
  const audioStrip = el("aside", "m3ssv2-track-strip");
  audioStrip.append(el("strong", "m3ssv2-track-name", tr("Audio")), el("span", "m3ssv2-channel-badge", tr("Stereo")));
  const row = el("div", "m3ssv2-track-button-row");
  const mute = button("M", "m3ssv2-track-mini-button"); mute.disabled = true; row.appendChild(mute);
  const gain = input("range", 0, -24, 12, .1); gain.disabled = true;
  const pan = input("range", 0, -1, 1, .01); pan.disabled = true;
  audioStrip.append(row, el("span", "m3ssv2-track-mini-label", tr("Input Gain")), gain, el("span", "m3ssv2-track-value", "0.0 dB"), el("span", "m3ssv2-track-mini-label", tr("Pan")), pan, el("span", "m3ssv2-track-value", "C"));
  const meter = el("div", "m3ssv2-empty-meter");
  meter.append(el("div", "m3ssv2-empty-meter-rail"), el("div", "m3ssv2-empty-meter-rail"));
  audioStrip.append(el("strong", "m3ssv2-peak-title", tr("Preview Peak")), meter);

  const emptyWave = el("section", "m3ssv2-empty-wave");
  semanticStrip(node, emptyWave);
  const center = el("div", "m3ssv2-empty-center");
  center.append(el("strong", "", tr("No source audio is loaded yet.")), el("span", "", tr("Queue the workflow once to load audio.")));
  emptyWave.appendChild(center);
  waveArea.append(audioStrip, emptyWave);
  main.appendChild(waveArea);
  installEmptyAudioResize(main, waveArea);

  const statusDock = el("div", "m3ssv2-time-dock");
  const position = el("section", "m3ssv2-time-panel");
  position.append(el("strong", "m3ssv2-time-panel-title", "POSITION"), el("output", "m3ssv2-position-time", "00:00:00.000"));
  const selection = el("section", "m3ssv2-time-panel");
  selection.append(el("strong", "m3ssv2-time-panel-title", "SELECTION"), el("output", "m3ssv2-selection-length", "00:00:00.000"));
  statusDock.append(position, selection);
  main.appendChild(statusDock);

  const tabs = el("nav", "m3ssv2-inspector-tabs is-workspace-polished");
  const body = el("div", "m3ssv2-inspector-body");
  const edit = emptyTab("Edit", "is-edit");
  const mixer = emptyTab("Mixer", "is-mixer");
  const effects = emptyTab("Effects", "is-effects");
  tabs.append(edit, mixer, effects);
  side.append(tabs, body);

  const show = (mode) => {
    for (const [buttonNode, id] of [[edit, "edit"], [mixer, "mixer"], [effects, "effects"]]) buttonNode.classList.toggle("is-active", id === mode);
    body.replaceChildren();
    const note = el("div", "m3ssv2-empty-inspector-note");
    note.textContent = mode === "edit" ? tr("No source audio is loaded yet.") : tr("Audio-dependent editing becomes available after the first Queue.");
    body.appendChild(note);
  };
  edit.onclick = () => show("edit");
  mixer.onclick = () => show("mixer");
  effects.onclick = () => show("effects");
  show("edit");

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
  const close = button(tr("Close"), "m3ssv2-button primary");
  close.onclick = () => shell.close();
  actions.append(close);
  footer.append(status, actions);

  shell.mount();
  cleanupLocalization = installUiLocalization(shell.window);
}
