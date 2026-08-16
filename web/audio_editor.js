import { app } from "../../scripts/app.js";
import { createStudioWindow } from "./studio_shell.js";
import { hideNodeWidgets, installNodeSummary, getNodeWidget } from "./node_compact.js";
import { installCssSizeDrag, makeVerticalSplitter, readLayoutNumber, writeLayoutNumber } from "./layout_splitter.js";
import {
  NODE_ID, EXTENSION_NAME, ensureStyles, clone, uid, nodeClass, el, button, input, select, field,
  clamp, fmtTime, clipDuration, clipEnd, timelineDuration, previewUrl, firstPreviewRef, extractMeta,
  defaultProject, normalizeProject, mainTrack, semanticOverlay, snapshot, parseSnapshot, splitClip,
} from "./audio_editor_core.js";
import {
  extractTimelineRange, pasteTimelineClipboard, removeTimelineRange,
} from "./audio_edit_commands.js";
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
      ? `Phase B / Audio Editor Basics · ${summaryFromMeta(meta)} · backend render authoritative`
      : "Phase B / Audio Editor · run once to load source audio",
    storageKey: "m3ss-audio-window",
    defaultWidth: 1480,
    defaultHeight: 900,
    minWidth: 900,
    minHeight: 600,
    onClose: () => cleanup(),
  });
  shell.window.classList.add("m3ssv2-dialog", "m3ssv2-phase-b");

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
  let internalClipboard = null;
  let previewId = "rendered";
  let activeInspector = "clip";
  let showTakes = false;
  let viewInitialized = false;
  let envelopeOverlay = readLayoutNumber("audio-envelope-overlay", 0) !== 0;
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
  const envelopeToggle = button("Envelope: Off");
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

  const waveHead = el("div", "m3ssv2-wave-head");
  waveHead.append(
    el("strong", "", "Waveform"),
    el("span", "m3ssv2-wave-note", "Stereo L/R preview · selection drives Cut/Copy/Delete/Silence · orange Gain Envelope is optional"),
  );
  main.appendChild(waveHead);

  const waveArea = el("div", "m3ssv2-wave-area");
  const trackStrip = el("aside", "m3ssv2-track-strip");
  const trackName = el("strong", "m3ssv2-track-name", "Main Comp");
  const channelBadge = el("span", "m3ssv2-channel-badge", "Stereo");
  const quickMute = button("M", "m3ssv2-track-mini-button");
  quickMute.title = "Mute / unmute selected clip (M)";
  const quickGain = input("range", 0, -24, 12, .1);
  quickGain.title = "Selected clip gain";
  const quickGainValue = el("span", "m3ssv2-track-value", "0.0 dB");
  const quickPan = input("range", 0, -1, 1, .01);
  quickPan.title = "Selected clip pan";
  const quickPanValue = el("span", "m3ssv2-track-value", "C");
  trackStrip.append(
    trackName, channelBadge,
    el("span", "m3ssv2-track-mini-label", "Selected clip"), quickMute,
    el("span", "m3ssv2-track-mini-label", "Gain"), quickGain, quickGainValue,
    el("span", "m3ssv2-track-mini-label", "Pan"), quickPan, quickPanValue,
  );

  const waveWrap = el("section", "m3ssv2-wave-wrap");
  const peakStrip = el("aside", "m3ssv2-peak-strip");
  peakStrip.title = "Preview peak meter. This meters the currently playing Source/Rendered preview, not unsaved browser edits.";
  peakStrip.appendChild(el("strong", "m3ssv2-peak-title", "Preview Peak"));
  const makePeak = (label) => {
    const row = el("div", "m3ssv2-peak-row");
    const rail = el("div", "m3ssv2-peak-rail");
    const bar = el("div", "m3ssv2-peak-bar");
    rail.appendChild(bar);
    const value = el("span", "m3ssv2-peak-value", "-∞");
    row.append(el("span", "m3ssv2-peak-label", label), rail, value);
    peakStrip.appendChild(row);
    return { row, bar, value, label: row.querySelector(".m3ssv2-peak-label") };
  };
  const peakL = makePeak("L");
  const peakR = makePeak("R");
  waveArea.append(trackStrip, waveWrap, peakStrip);
  main.appendChild(waveArea);

  const timelineHead = el("div", "m3ssv2-timeline-head");
  timelineHead.append(
    el("strong", "", "Main Comp"),
    el("span", "m3ssv2-timeline-note", "Same time scale as waveform · drag clips to move · drag edges to trim · drag top fade handles"),
  );
  main.appendChild(timelineHead);
  const timeline = el("div", "m3ssv2-timeline");
  main.appendChild(timeline);

  const context = el("div", "m3ssv2-contextbar");
  const cut = button("Cut"); cut.title = "Ctrl+X";
  const copy = button("Copy"); copy.title = "Ctrl+C";
  const paste = button("Paste"); paste.title = "Ctrl+V · paste at playhead";
  const split = button("Split"); split.title = "Ctrl+I · split selected clip at playhead";
  const del = button("Delete"); del.title = "Delete · ripple delete selection/clip";
  const silence = button("Silence"); silence.title = "Ctrl+L · remove selection but leave a gap";
  const dup = button("Duplicate"); dup.title = "Ctrl+D";
  const reverse = button("Reverse");
  const muteClip = button("Mute Clip"); muteClip.title = "M";
  const cross = button("Crossfade Next");
  const useTake = button("Use Preview Take");
  const selectionText = el("span", "m3ssv2-selection-text", "No selection");
  context.append(cut, copy, paste, split, del, silence, dup, reverse, muteClip, cross, useTake, selectionText);
  main.appendChild(context);

  const contextMenu = el("div", "m3ssv2-context-menu");
  contextMenu.hidden = true;
  root.appendChild(contextMenu);

  let wave = null;
  wave = new WaveformView(
    waveWrap,
    (nextSelection) => {
      selection = nextSelection;
      selectionText.textContent = nextSelection
        ? `Selection ${fmtTime(nextSelection.start)}–${fmtTime(nextSelection.end)}`
        : internalClipboard?.clips?.length ? `Clipboard ${internalClipboard.clips.length} clip part(s)` : "No selection";
      updateCommandState();
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
  const hasSelection = () => !!selection && selection.end - selection.start >= .001 && previewId === "rendered";
  const makeClipId = () => uid("clip");

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
    channelBadge.textContent = layout;
    peakL.label.textContent = channels >= 2 ? "L" : "M";
    peakR.row.hidden = channels < 2;
  }

  function setPeak(entry, db) {
    const normalized = clamp((db + 60) / 60, 0, 1);
    entry.bar.style.height = `${normalized * 100}%`;
    entry.bar.classList.toggle("is-warn", db > -12);
    entry.bar.classList.toggle("is-hot", db > -3);
    entry.value.textContent = db <= -59.9 ? "-∞" : `${db.toFixed(1)}`;
  }

  function samplePeakDb(channel) {
    const decoded = wave?.decoded;
    if (!decoded || !decoded.length || wave.audio.paused) return -60;
    const safeChannel = Math.min(channel, decoded.numberOfChannels - 1);
    const data = decoded.getChannelData(Math.max(0, safeChannel));
    const sampleRate = decoded.sampleRate || 44100;
    const center = Math.floor(clamp(wave.currentTime(), 0, decoded.duration) * sampleRate);
    const half = Math.max(64, Math.floor(sampleRate * .025));
    const start = Math.max(0, center - half), end = Math.min(data.length, center + half);
    const stride = Math.max(1, Math.floor((end - start) / 1024));
    let peak = 0;
    for (let index = start; index < end; index += stride) peak = Math.max(peak, Math.abs(data[index] || 0));
    return peak > 1e-5 ? Math.max(-60, 20 * Math.log10(peak)) : -60;
  }

  function updatePeakMeter() {
    setPeak(peakL, samplePeakDb(0));
    setPeak(peakR, samplePeakDb(1));
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
    updateCommandState();
  }

  function cleanupInspector() {
    for (const child of inspectorBody.querySelectorAll(".m3ssv2-envelope-wrap")) child._m3ssResizeObserver?.disconnect?.();
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
      timeline, project, meta, selectedId,
      (id) => { selectedId = id; renderAll(); }, begin, () => mark(true), duration,
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

  function panText(value) {
    const pan = Number(value) || 0;
    if (Math.abs(pan) < .01) return "C";
    return `${pan < 0 ? "L" : "R"} ${Math.round(Math.abs(pan) * 100)}`;
  }

  function updateCommandState() {
    const clip = findClip();
    const canRegion = hasSelection();
    cut.disabled = !(canRegion || clip);
    copy.disabled = !(canRegion || clip);
    paste.disabled = !internalClipboard?.clips?.length || previewId !== "rendered";
    split.disabled = !clip;
    del.disabled = !(canRegion || clip);
    silence.disabled = !canRegion;
    dup.disabled = !clip;
    reverse.disabled = !clip;
  }

  function renderAll() {
    const duration = timelineDuration(project, meta);
    const clip = findClip();
    renderTimelinePanel();
    renderInspectorPanel();
    updateEnvelopeOverlay();
    updateTrackInfo();
    status.textContent = `${mainTrack(project).clips.length} clips · timeline ${fmtTime(duration)} · ${meta.takes.length} take(s)${internalClipboard?.clips?.length ? ` · clipboard ${internalClipboard.clips.length}` : ""}${meta.interactive_supported ? "" : " · batch preview: first item only"}`;
    undo.disabled = !history.length;
    redo.disabled = !future.length;
    takesToggle.classList.toggle("is-active", showTakes);
    takesToggle.textContent = `${showTakes ? "Hide" : "Show"} Takes (${meta.takes.length})`;
    useTake.disabled = meta.takes.length <= 1 || previewId === "rendered";
    muteClip.disabled = !clip;
    muteClip.textContent = clip?.muted ? "Unmute Clip" : "Mute Clip";
    muteClip.classList.toggle("is-active", !!clip?.muted);
    quickMute.disabled = !clip;
    quickMute.classList.toggle("is-active", !!clip?.muted);
    quickGain.disabled = !clip;
    quickPan.disabled = !clip;
    if (clip) {
      quickGain.value = String(clip.gain_db || 0);
      quickGainValue.textContent = `${Number(clip.gain_db || 0).toFixed(1)} dB`;
      quickPan.value = String(clip.pan || 0);
      quickPanValue.textContent = panText(clip.pan);
    } else {
      quickGainValue.textContent = "—";
      quickPanValue.textContent = "—";
    }
    updateCommandState();
  }

  function selectedRangeOrClip() {
    if (hasSelection()) return { start: selection.start, end: selection.end, region: true };
    const clip = findClip();
    if (!clip) return null;
    return { start: Number(clip.timeline_start) || 0, end: clipEnd(clip), region: false };
  }

  function copyCurrent() {
    const range = selectedRangeOrClip();
    if (!range) return false;
    const payload = extractTimelineRange(mainTrack(project), range.start, range.end);
    if (!payload.clips.length) return false;
    internalClipboard = payload;
    selectionText.textContent = `Clipboard ${payload.clips.length} clip part(s) · ${fmtTime(payload.duration)}`;
    updateCommandState();
    return true;
  }

  function cutCurrent({ leaveGap = false } = {}) {
    const range = selectedRangeOrClip();
    if (!range || !copyCurrent()) return;
    commit(() => {
      removeTimelineRange(mainTrack(project), range.start, range.end, { ripple: !leaveGap, makeId: makeClipId });
      selectedId = mainTrack(project).clips[0]?.id || null;
      selection = null;
      wave.setSelection(null);
    });
  }

  function deleteCurrent({ leaveGap = false } = {}) {
    const range = selectedRangeOrClip();
    if (!range) return;
    commit(() => {
      removeTimelineRange(mainTrack(project), range.start, range.end, { ripple: !leaveGap, makeId: makeClipId });
      selectedId = mainTrack(project).clips[0]?.id || null;
      selection = null;
      wave.setSelection(null);
    });
  }

  function pasteCurrent() {
    if (!internalClipboard?.clips?.length || previewId !== "rendered") return;
    commit(() => {
      const pasted = pasteTimelineClipboard(mainTrack(project), internalClipboard, wave.currentTime(), { makeId: makeClipId });
      selectedId = pasted[0]?.id || selectedId;
    });
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
  pause.onclick = () => { wave.pause(); updatePeakMeter(); };
  stop.onclick = () => { wave.stop(); updatePeakMeter(); };
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
    const track = mainTrack(project), playheadTime = wave.currentTime();
    const selectedIndex = track.clips.findIndex((clip) => clip.id === selectedId);
    const target = selectedIndex >= 0 ? selectedIndex : track.clips.findIndex((clip) => playheadTime > clip.timeline_start && playheadTime < clipEnd(clip));
    if (target < 0) return;
    const pieces = splitClip(track.clips[target], playheadTime);
    if (!pieces) return;
    commit(() => {
      track.clips.splice(target, 1, ...pieces);
      selectedId = pieces[1].id;
    });
  };

  copy.onclick = () => copyCurrent();
  cut.onclick = () => cutCurrent();
  paste.onclick = () => pasteCurrent();
  del.onclick = () => deleteCurrent();
  silence.onclick = () => {
    if (!hasSelection()) {
      alert("Select a region on the Rendered preview first. Silence leaves the timeline length unchanged.");
      return;
    }
    deleteCurrent({ leaveGap: true });
  };

  dup.onclick = () => {
    const clip = findClip();
    if (!clip) return;
    commit(() => {
      const duplicate = clone(clip);
      duplicate.id = uid("clip");
      duplicate.timeline_start = clipEnd(clip) + .05;
      mainTrack(project).clips.push(duplicate);
      selectedId = duplicate.id;
    });
  };

  reverse.onclick = () => {
    const clip = findClip();
    if (!clip) return;
    commit(() => { clip.reverse = !clip.reverse; });
  };

  muteClip.onclick = () => {
    const clip = findClip();
    if (!clip) return;
    commit(() => { clip.muted = !clip.muted; });
  };
  quickMute.onclick = () => muteClip.click();
  quickGain.onchange = () => {
    const clip = findClip();
    if (!clip) return;
    const next = clamp(quickGain.value, -24, 12);
    commit(() => { clip.gain_db = next; });
  };
  quickPan.onchange = () => {
    const clip = findClip();
    if (!clip) return;
    const next = clamp(quickPan.value, -1, 1);
    commit(() => { clip.pan = next; });
  };

  cross.onclick = () => {
    const track = mainTrack(project), clip = findClip();
    if (!clip) return;
    const ordered = [...track.clips].sort((a, b) => a.timeline_start - b.timeline_start);
    const index = ordered.findIndex((item) => item.id === clip.id), next = ordered[index + 1];
    if (!next) return;
    const duration = Math.min(.5, clipDuration(clip) / 2, clipDuration(next) / 2);
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
    const max = Number(take?.duration) || clipDuration(clip), old = clipDuration(clip);
    commit(() => {
      clip.source_id = previewId;
      clip.source_in = clamp(clip.source_in, 0, max);
      clip.source_out = clamp(clip.source_in + old, clip.source_in + .01, max);
    });
  };

  function menuItem(label, shortcut, action, disabled = false) {
    const item = button("", "m3ssv2-context-menu-item");
    item.disabled = !!disabled;
    item.append(el("span", "", label), el("kbd", "", shortcut || ""));
    item.onclick = () => { hideContextMenu(); if (!item.disabled) action?.(); };
    return item;
  }

  function hideContextMenu() {
    contextMenu.hidden = true;
    contextMenu.replaceChildren();
  }

  function showContextMenu(event) {
    event.preventDefault();
    const clip = findClip(), region = hasSelection();
    contextMenu.replaceChildren(
      menuItem("Cut", "Ctrl+X", () => cut.click(), !(region || clip)),
      menuItem("Copy", "Ctrl+C", () => copy.click(), !(region || clip)),
      menuItem("Paste at Playhead", "Ctrl+V", () => paste.click(), !internalClipboard?.clips?.length || previewId !== "rendered"),
      el("div", "m3ssv2-context-menu-sep"),
      menuItem("Split Clip", "Ctrl+I", () => split.click(), !clip),
      menuItem("Duplicate", "Ctrl+D", () => dup.click(), !clip),
      menuItem("Delete / Ripple", "Del", () => del.click(), !(region || clip)),
      menuItem("Silence / Leave Gap", "Ctrl+L", () => silence.click(), !region),
      menuItem("Cut & Leave Gap", "Ctrl+Alt+X", () => cutCurrent({ leaveGap: true }), !region),
      el("div", "m3ssv2-context-menu-sep"),
      menuItem("Reverse", "", () => reverse.click(), !clip),
      menuItem(clip?.muted ? "Unmute Clip" : "Mute Clip", "M", () => muteClip.click(), !clip),
      menuItem("Pitch & Speed… (V2.1)", "", null, true),
    );
    contextMenu.hidden = false;
    contextMenu.style.left = `${Math.min(event.clientX, window.innerWidth - 250)}px`;
    contextMenu.style.top = `${Math.min(event.clientY, window.innerHeight - 360)}px`;
  }

  main.addEventListener("contextmenu", showContextMenu);
  const closeMenu = (event) => { if (!contextMenu.hidden && !contextMenu.contains(event.target)) hideContextMenu(); };
  document.addEventListener("pointerdown", closeMenu, true);

  reset.onclick = () => {
    if (!confirm("Reset V2 edits to one full-length Take 1 clip?")) return;
    begin();
    project = defaultProject(meta);
    project.project_id = raw?.project_id || uid("audio-project");
    selectedId = mainTrack(project).clips[0]?.id || null;
    selection = null;
    internalClipboard = null;
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
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    const typing = ["INPUT", "TEXTAREA", "SELECT"].includes(document.activeElement?.tagName);
    if (typing && !(mod && key === "s")) return;

    if (mod && key === "z") {
      event.preventDefault();
      event.shiftKey ? redo.click() : undo.click();
    } else if (mod && key === "y") {
      event.preventDefault(); redo.click();
    } else if (mod && key === "s") {
      event.preventDefault(); save.click();
    } else if (mod && event.altKey && key === "x") {
      event.preventDefault(); cutCurrent({ leaveGap: true });
    } else if (mod && key === "x") {
      event.preventDefault(); cut.click();
    } else if (mod && key === "c") {
      event.preventDefault(); copy.click();
    } else if (mod && key === "v") {
      event.preventDefault(); paste.click();
    } else if (mod && key === "i") {
      event.preventDefault(); split.click();
    } else if (mod && key === "d") {
      event.preventDefault(); dup.click();
    } else if (mod && key === "l") {
      event.preventDefault(); silence.click();
    } else if (mod && event.key === "0") {
      event.preventDefault(); fit.click();
    } else if (event.key === "Delete" || event.key === "Backspace") {
      event.preventDefault(); del.click();
    } else if (key === "m") {
      event.preventDefault(); muteClip.click();
    } else if (event.code === "Space") {
      event.preventDefault(); wave.audio.paused ? play.click() : pause.click();
    } else if (event.key === "Escape") {
      hideContextMenu();
    }
  }

  document.addEventListener("keydown", keys);
  const timer = setInterval(() => {
    time.textContent = fmtTime(wave.currentTime());
    updatePeakMeter();
  }, 80);
  cleanup = () => {
    clearInterval(timer);
    document.removeEventListener("keydown", keys);
    document.removeEventListener("pointerdown", closeMenu, true);
    main.removeEventListener("contextmenu", showContextMenu);
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
