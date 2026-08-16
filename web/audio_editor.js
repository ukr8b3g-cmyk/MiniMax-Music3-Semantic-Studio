import { app } from "../../scripts/app.js";
import { createStudioWindow } from "./studio_shell.js";
import { hideNodeWidgets, installNodeSummary, getNodeWidget } from "./node_compact.js";
import { installCssSizeDrag, makeVerticalSplitter, readLayoutNumber, writeLayoutNumber } from "./layout_splitter.js";
import {
  NODE_ID, EXTENSION_NAME, ensureStyles, clone, uid, nodeClass, el, button, input, select, field,
  clamp, fmtTime, clipDuration, clipEnd, timelineDuration, previewUrl, firstPreviewRef, extractMeta,
  defaultProject, normalizeProject, mainTrack, semanticOverlay, snapshot, parseSnapshot, splitClip,
  deleteTimelineRange,
} from "./audio_editor_core.js";
import { WaveformView } from "./audio_waveform.js";
import { renderTimeline } from "./audio_timeline.js";
import { renderInspector, renderEnvelope, renderMaster, renderTakes } from "./audio_panels.js";

const WAVE_DISPLAY_KEY = "m3ss-layout:audio-wave-display";
const WAVE_DISPLAY_MODES = new Set(["auto", "split", "overlay", "mono"]);

function readWaveDisplayMode() {
  try {
    const value = localStorage.getItem(WAVE_DISPLAY_KEY);
    return WAVE_DISPLAY_MODES.has(value) ? value : "auto";
  } catch {
    return "auto";
  }
}

function writeWaveDisplayMode(value) {
  try { localStorage.setItem(WAVE_DISPLAY_KEY, value); } catch {}
}

function summaryFromMeta(meta) {
  if (!meta?.takes?.length) return "Run once to load audio";
  const primary = meta.takes[0];
  const layout = Number(primary?.channels) >= 2 ? "Stereo" : "Mono";
  return `${meta.takes.length} take${meta.takes.length === 1 ? "" : "s"} · ${layout} · ${Number(meta.rendered?.duration || primary?.duration || 0).toFixed(1)} s · ${meta.bypass ? "Bypassed" : "Edited"}`;
}

function openEditor(node, compactSummary) {
  ensureStyles();
  const editWidget = getNodeWidget(node, "edit_json");
  const meta = node._m3ssV2Output;
  let cleanup = () => {};
  const shell = createStudioWindow({
    title: "Music3 Semantic Studio Audio Editor",
    subtitle: meta?.takes?.length
      ? `Phase 2 / V2.0 UX Final · ${summaryFromMeta(meta)} · backend render authoritative`
      : "Phase 2 / V2.0 · run once to load source audio",
    storageKey: "m3ss-audio-window",
    defaultWidth: 1480,
    defaultHeight: 900,
    minWidth: 900,
    minHeight: 600,
    onClose: () => cleanup(),
  });
  shell.window.classList.add("m3ssv2-dialog");

  if (!editWidget) {
    shell.content.appendChild(el("div", "m3ssv2-first-run", "edit_json widget was not found. Restart ComfyUI and reload the workflow."));
    shell.mount();
    return;
  }
  if (!meta?.takes?.length) {
    shell.content.appendChild(el("div", "m3ssv2-first-run", "Run the workflow once to load source audio, then reopen the Audio Editor."));
    shell.mount();
    return;
  }

  let raw = {};
  try { raw = JSON.parse(editWidget.value || "{}"); } catch { raw = {}; }
  let project = normalizeProject(raw, meta);
  if (!project.project_id) project.project_id = uid("audio-project");

  let selectedId = mainTrack(project).clips[0]?.id || null;
  let selection = null;
  let previewId = "rendered";
  let activeInspector = "clip";
  let showTakes = false;
  let viewInitialized = false;
  let envelopeOverlay = readLayoutNumber("audio-envelope-overlay", 1) !== 0;
  let waveformDisplayMode = readWaveDisplayMode();
  let sourceInfo = null;
  const history = [];
  const future = [];

  const root = el("div", "m3ssv2-root");
  const toolbar = el("div", "m3ssv2-toolbar");
  const workspace = el("div", "m3ssv2-workspace");
  const main = el("main", "m3ssv2-main");
  const paneSplitter = makeVerticalSplitter("m3ssv2-pane-splitter");
  const side = el("aside", "m3ssv2-side");
  const footer = el("footer", "m3ssv2-footer");
  root.append(toolbar, workspace, footer);
  workspace.append(main, paneSplitter, side);
  shell.content.appendChild(root);

  const preview = select(
    [{ value: "rendered", label: "Rendered A" }, ...(meta.takes || []).map((take) => ({ value: take.id, label: take.name || take.id }))],
    previewId,
  );
  const play = button("▶");
  const pause = button("Ⅱ");
  const stop = button("■");
  const undo = button("Undo");
  const redo = button("Redo");
  const fit = button("Fit");
  const zoom = input("range", 28, 8, 120, 1);
  const displayMode = select([
    { value: "auto", label: "Auto L/R" },
    { value: "split", label: "Stereo Split" },
    { value: "overlay", label: "Stereo Overlay" },
    { value: "mono", label: "Mono Mix Preview" },
  ], waveformDisplayMode);
  const envelopeToggle = button("Envelope: On");
  envelopeToggle.title = "Show/hide and edit the selected clip Gain Envelope over the rendered waveform";
  const time = el("span", "m3ssv2-time", "0:00.00");
  const takesToggle = button(`Takes (${meta.takes.length})`);
  const trackInfo = el("span", "m3ssv2-track-info", "Audio layout loading…");
  const renderState = el("span", "m3ssv2-render-state", "Rendered state");
  toolbar.append(
    field("Preview", preview), play, pause, stop, undo, redo, fit, field("Zoom", zoom),
    field("Waveform", displayMode), envelopeToggle, time, takesToggle,
    el("span", "m3ssv2-wheel-hint", "Wheel: zoom · Shift+Wheel: pan"), trackInfo, renderState,
  );

  const waveWrap = el("section", "m3ssv2-wave-wrap");
  const waveHead = el("div", "m3ssv2-wave-head");
  waveHead.append(
    el("strong", "", "Waveform"),
    el("span", "m3ssv2-wave-note", "Stereo shows Left / Right separately by default · Envelope points are directly editable on Rendered preview"),
  );
  main.append(waveHead, waveWrap);

  const timelineHead = el("div", "m3ssv2-timeline-head");
  timelineHead.append(
    el("strong", "", "Main Comp"),
    el("span", "m3ssv2-timeline-note", "Same time scale as waveform · drag clips to move · drag edges to trim · drag top fade handles"),
  );
  main.appendChild(timelineHead);
  const timeline = el("div", "m3ssv2-timeline");
  main.appendChild(timeline);

  const context = el("div", "m3ssv2-contextbar");
  const split = button("Split @ Playhead");
  const del = button("Delete Selection");
  const dup = button("Duplicate");
  const muteClip = button("Mute Clip");
  const cross = button("Crossfade Next");
  const useTake = button("Use Preview Take");
  const selectionText = el("span", "m3ssv2-selection-text", "No selection");
  context.append(split, del, dup, muteClip, cross, useTake, selectionText);
  main.appendChild(context);

  let wave = null;
  wave = new WaveformView(
    waveWrap,
    (nextSelection) => {
      selection = nextSelection;
      selectionText.textContent = nextSelection
        ? `Selection ${fmtTime(nextSelection.start)}–${fmtTime(nextSelection.end)}`
        : "No selection";
    },
    {
      onZoom: (nextZoom) => {
        zoom.value = String(Math.round(nextZoom));
        project.view.zoom = nextZoom / 28;
        renderTimelinePanel();
      },
      onScroll: (seconds) => {
        project.view.scroll_seconds = seconds;
        timeline._m3ssTimelineSetScrollSeconds?.(seconds);
      },
      onSourceInfo: (info) => {
        sourceInfo = info;
        updateTrackInfo();
      },
      onEnvelopeBegin: () => begin(),
      onEnvelopeCommit: () => mark(true),
    },
  );
  wave.setDisplayMode(waveformDisplayMode);
  wave.setSemanticSections(semanticOverlay(node));

  const inspectorTabs = el("nav", "m3ssv2-inspector-tabs");
  const inspectorBody = el("div", "m3ssv2-inspector-body");
  const tabButtons = new Map();
  for (const [id, label] of [["clip", "Clip"], ["envelope", "Envelope"], ["master", "Master"], ["takes", "Takes"]]) {
    const tab = button(label, "m3ssv2-inspector-tab");
    tab.onclick = () => {
      activeInspector = id;
      renderInspectorPanel();
    };
    tabButtons.set(id, tab);
    inspectorTabs.appendChild(tab);
  }
  side.append(inspectorTabs, inspectorBody);

  const status = el("div", "m3ssv2-status");
  const actions = el("div", "m3ssv2-footer-actions");
  const reset = button("Reset");
  const cancel = button("Cancel");
  const save = button("Save Edits", "m3ssv2-button primary");
  actions.append(reset, cancel, save);
  footer.append(status, actions);

  const cleanupPaneSplitter = installCssSizeDrag({
    handle: paneSplitter,
    target: workspace,
    cssVariable: "--m3ssv2-inspector-width",
    storageKey: "audio-inspector-width",
    defaultSize: 360,
    minSize: 290,
    maxSize: 680,
    invert: true,
    onChange: () => requestAnimationFrame(() => wave?.render()),
  });

  const findClip = () => mainTrack(project).clips.find((clip) => clip.id === selectedId) || null;

  function begin() {
    history.push(snapshot(project));
    if (history.length > 100) history.shift();
    future.length = 0;
  }

  function mark(renderDirty = true) {
    if (renderDirty) {
      renderState.textContent = "Edits not rendered — Save, then Queue";
      renderState.classList.add("dirty");
    }
    renderAll();
  }

  function commit(fn) {
    begin();
    fn();
    mark(true);
  }

  function restore(value) {
    project = normalizeProject(parseSnapshot(value), meta);
    selectedId = mainTrack(project).clips.find((clip) => clip.id === selectedId)?.id || mainTrack(project).clips[0]?.id || null;
    renderState.textContent = "Edits not rendered — Save, then Queue";
    renderState.classList.add("dirty");
    renderAll();
  }

  function updateTrackInfo() {
    const channels = Number(sourceInfo?.channels) || Number(meta.takes?.[0]?.channels) || 1;
    const layout = channels >= 2 ? "Stereo" : "Mono";
    const sampleRate = Number(sourceInfo?.sampleRate) || Number(meta.takes?.[0]?.sample_rate) || 0;
    const modeLabels = { split: "L/R Split", overlay: "L/R Overlay", mono: channels >= 2 ? "Mono Mix Preview" : "Mono", auto: "Auto" };
    const resolved = sourceInfo?.displayMode || (channels >= 2 ? "split" : "mono");
    trackInfo.textContent = `${layout}${sampleRate ? ` · ${sampleRate} Hz` : ""} · ${modeLabels[resolved] || resolved}`;
    trackInfo.title = "Waveform display is preview-only. Master Channel mode controls the queued AUDIO output.";
  }

  async function setPreview(id) {
    previewId = id;
    preview.value = id;
    const entry = id === "rendered" ? meta.rendered : meta.takes.find((take) => take.id === id);
    const url = previewUrl(firstPreviewRef(entry));
    try {
      await wave.setSource(url);
      if (!viewInitialized) {
        wave.setZoom(clamp((Number(project.view.zoom) || 1) * 28, 8, 120));
        wave.setScrollSeconds(project.view.scroll_seconds || 0);
        viewInitialized = true;
      }
    } catch (error) {
      alert(`Could not load audio preview: ${error}`);
    }
    renderTimelinePanel();
    renderInspectorPanel();
    updateEnvelopeOverlay();
  }

  function cleanupInspector() {
    for (const child of inspectorBody.querySelectorAll(".m3ssv2-envelope-wrap")) {
      child._m3ssResizeObserver?.disconnect?.();
    }
  }

  function renderInspectorPanel() {
    cleanupInspector();
    for (const [id, tab] of tabButtons) tab.classList.toggle("is-active", id === activeInspector);
    if (activeInspector === "clip") renderInspector(inspectorBody, findClip(), meta, commit);
    else if (activeInspector === "envelope") renderEnvelope(inspectorBody, findClip(), commit, begin, () => mark(true));
    else if (activeInspector === "master") renderMaster(inspectorBody, project, commit);
    else renderTakes(inspectorBody, meta, previewId, (id) => setPreview(id), showTakes, () => { showTakes = !showTakes; renderAll(); });
  }

  function renderTimelinePanel() {
    const duration = timelineDuration(project, meta);
    renderTimeline(
      timeline,
      project,
      meta,
      selectedId,
      (id) => { selectedId = id; renderAll(); },
      begin,
      () => mark(true),
      duration,
      {
        showTakes,
        pixelWidth: wave.contentWidth(),
        scrollSeconds: wave.scrollSeconds(),
        onScrollSeconds: (seconds) => {
          project.view.scroll_seconds = seconds;
          wave.setScrollSeconds(seconds);
        },
      },
    );
  }

  function updateEnvelopeOverlay() {
    const visible = envelopeOverlay && previewId === "rendered";
    wave.setEnvelopeOverlay(visible ? findClip() : null, visible);
    envelopeToggle.textContent = `Envelope: ${envelopeOverlay ? "On" : "Off"}`;
    envelopeToggle.classList.toggle("is-active", envelopeOverlay);
    envelopeToggle.disabled = previewId !== "rendered";
  }

  function renderAll() {
    const duration = timelineDuration(project, meta);
    const clip = findClip();
    renderTimelinePanel();
    renderInspectorPanel();
    updateEnvelopeOverlay();
    updateTrackInfo();
    status.textContent = `${mainTrack(project).clips.length} clips · timeline ${fmtTime(duration)} · ${meta.takes.length} take(s)${meta.interactive_supported ? "" : " · batch preview: first item only"}`;
    undo.disabled = !history.length;
    redo.disabled = !future.length;
    takesToggle.classList.toggle("is-active", showTakes);
    takesToggle.textContent = `${showTakes ? "Hide" : "Show"} Takes (${meta.takes.length})`;
    useTake.disabled = meta.takes.length <= 1 || previewId === "rendered";
    muteClip.disabled = !clip;
    muteClip.textContent = clip?.muted ? "Unmute Clip" : "Mute Clip";
    muteClip.classList.toggle("is-active", !!clip?.muted);
  }

  preview.onchange = () => setPreview(preview.value);
  displayMode.onchange = () => {
    waveformDisplayMode = WAVE_DISPLAY_MODES.has(displayMode.value) ? displayMode.value : "auto";
    writeWaveDisplayMode(waveformDisplayMode);
    wave.setDisplayMode(waveformDisplayMode);
    renderTimelinePanel();
  };
  zoom.oninput = () => wave.setZoom(Number(zoom.value));
  fit.onclick = () => {
    wave.fit();
    project.view.zoom = wave.zoom / 28;
    project.view.scroll_seconds = 0;
    renderTimelinePanel();
  };
  envelopeToggle.onclick = () => {
    envelopeOverlay = !envelopeOverlay;
    writeLayoutNumber("audio-envelope-overlay", envelopeOverlay ? 1 : 0);
    updateEnvelopeOverlay();
  };
  play.onclick = () => wave.play();
  pause.onclick = () => wave.pause();
  stop.onclick = () => wave.stop();
  takesToggle.onclick = () => { showTakes = !showTakes; renderAll(); };

  undo.onclick = () => {
    if (!history.length) return;
    future.push(snapshot(project));
    restore(history.pop());
  };
  redo.onclick = () => {
    if (!future.length) return;
    history.push(snapshot(project));
    restore(future.pop());
  };

  split.onclick = () => {
    const track = mainTrack(project);
    const playheadTime = wave.currentTime();
    const selectedIndex = track.clips.findIndex((clip) => clip.id === selectedId);
    const target = selectedIndex >= 0
      ? selectedIndex
      : track.clips.findIndex((clip) => playheadTime > clip.timeline_start && playheadTime < clipEnd(clip));
    if (target < 0) return;
    const pieces = splitClip(track.clips[target], playheadTime);
    if (!pieces) return;
    commit(() => {
      track.clips.splice(target, 1, ...pieces);
      selectedId = pieces[1].id;
    });
  };

  del.onclick = () => {
    if (!selection || selection.end - selection.start < 0.001 || previewId !== "rendered") {
      alert("Select a region on the Rendered preview first. Delete Selection is non-ripple and leaves a silence gap.");
      return;
    }
    commit(() => {
      deleteTimelineRange(mainTrack(project), selection.start, selection.end);
      selectedId = mainTrack(project).clips[0]?.id || null;
      selection = null;
      wave.setSelection(null);
    });
  };

  dup.onclick = () => {
    const clip = findClip();
    if (!clip) return;
    commit(() => {
      const duplicate = clone(clip);
      duplicate.id = uid("clip");
      duplicate.timeline_start = clipEnd(clip) + 0.05;
      mainTrack(project).clips.push(duplicate);
      selectedId = duplicate.id;
    });
  };

  muteClip.onclick = () => {
    const clip = findClip();
    if (!clip) return;
    commit(() => { clip.muted = !clip.muted; });
  };

  cross.onclick = () => {
    const track = mainTrack(project);
    const clip = findClip();
    if (!clip) return;
    const ordered = [...track.clips].sort((a, b) => a.timeline_start - b.timeline_start);
    const index = ordered.findIndex((item) => item.id === clip.id);
    const next = ordered[index + 1];
    if (!next) return;
    const duration = Math.min(0.5, clipDuration(clip) / 2, clipDuration(next) / 2);
    if (duration <= 0) return;
    commit(() => {
      if (clipEnd(clip) - next.timeline_start < duration) next.timeline_start = Math.max(0, clipEnd(clip) - duration);
      clip.fade_out = { duration, curve: "equal_power" };
      next.fade_in = { duration, curve: "equal_power" };
    });
  };

  useTake.onclick = () => {
    if (previewId === "rendered") {
      alert("Choose Take 1–4 in Preview first.");
      return;
    }
    const clip = findClip();
    if (!clip) return;
    const take = meta.takes.find((item) => item.id === previewId);
    const max = Number(take?.duration) || clipDuration(clip);
    const old = clipDuration(clip);
    commit(() => {
      clip.source_id = previewId;
      clip.source_in = clamp(clip.source_in, 0, max);
      clip.source_out = clamp(clip.source_in + old, clip.source_in + 0.01, max);
    });
  };

  reset.onclick = () => {
    if (!confirm("Reset V2 edits to one full-length Take 1 clip?")) return;
    begin();
    project = defaultProject(meta);
    project.project_id = raw?.project_id || uid("audio-project");
    selectedId = mainTrack(project).clips[0]?.id || null;
    selection = null;
    wave.setSelection(null);
    mark(true);
  };

  save.onclick = () => {
    const text = JSON.stringify(project);
    editWidget.value = text;
    editWidget.callback?.(text);
    compactSummary?.update(`${meta.takes.length} take${meta.takes.length === 1 ? "" : "s"} · ${mainTrack(project).clips.length} clips · edits pending Queue`);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    shell.close();
  };
  cancel.onclick = () => shell.close();

  function keys(event) {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "z") {
      event.preventDefault();
      event.shiftKey ? redo.click() : undo.click();
    }
    if ((event.ctrlKey || event.metaKey) && event.key === "0") {
      event.preventDefault();
      fit.click();
    }
    if (event.code === "Space" && !["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName)) {
      event.preventDefault();
      wave.audio.paused ? play.click() : pause.click();
    }
  }

  document.addEventListener("keydown", keys);
  const timer = setInterval(() => { time.textContent = fmtTime(wave.currentTime()); }, 100);
  cleanup = () => {
    clearInterval(timer);
    document.removeEventListener("keydown", keys);
    cleanupInspector();
    cleanupPaneSplitter();
    wave.destroy();
  };

  shell.mount();
  setPreview(previewId);
  renderAll();
}

function updateNodeMeta(node, message) {
  const meta = extractMeta(message);
  if (!meta) return;
  node._m3ssV2Output = meta;
  node._m3ssV2Compact?.update(summaryFromMeta(meta));
}

app.registerExtension({
  name: EXTENSION_NAME,
  async beforeRegisterNodeDef(nodeType, nodeData) {
    if (nodeData?.name !== NODE_ID) return;
    const old = nodeType.prototype.onExecuted;
    nodeType.prototype.onExecuted = function (message) {
      old?.apply(this, [message]);
      updateNodeMeta(this, message);
    };
  },
  async nodeCreated(node) {
    if (nodeClass(node) !== NODE_ID || node._m3ssV2ButtonInstalled) return;
    node._m3ssV2ButtonInstalled = true;
    ensureStyles();
    hideNodeWidgets(node, ["edit_json"]);
    const compact = installNodeSummary(node, {
      widgetName: "Editor Summary",
      text: summaryFromMeta(node._m3ssV2Output),
      minWidth: 360,
    });
    node._m3ssV2Compact = compact;
    const open = node.addWidget?.("button", "Open Audio Editor", null, () => openEditor(node, compact), { serialize: false });
    if (open) {
      open.label = "Open Audio Editor";
      open.serialize = false;
    }
    node.setSize?.([
      Math.max(node.size?.[0] || 360, 360),
      Math.min(Math.max(node.computeSize?.()[1] || 170, 170), 300),
    ]);
  },
  onNodeOutputsUpdated(outputs) {
    for (const node of app.graph?._nodes || []) {
      if (nodeClass(node) !== NODE_ID) continue;
      const output = outputs?.[node.id] || outputs?.[String(node.id)];
      updateNodeMeta(node, output);
    }
  },
});
