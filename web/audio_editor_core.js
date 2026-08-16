import { app } from "../../scripts/app.js";
import { api } from "../../scripts/api.js";

export const NODE_ID = "MiniMaxMusic3SemanticStudioAudioEditor";
export const V1_NODE_ID = "MiniMaxMusic3SemanticStudio";
export const EXTENSION_NAME = "minimax.music3.semantic.studio.audio-editor";
export const EDIT_SCHEMA_VERSION = 2;
export const CHANNEL_MODES = ["preserve", "mono", "stereo", "left_only", "right_only", "swap_lr"];
export const FADE_CURVES = ["linear", "equal_power"];
const STYLE_ID = "m3ss-v2-style-link";

export function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./audio_editor.css", import.meta.url).href;
  document.head.appendChild(link);
}
export const clone = (value) => JSON.parse(JSON.stringify(value));
export const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
export const uid = (prefix = "item") => `${prefix}-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
export const nodeClass = (node) => node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
export const getWidget = (node, name) => node?.widgets?.find((widget) => widget.name === name);
export function el(tag, className = "", text) { const node = document.createElement(tag); if (className) node.className = className; if (text !== undefined) node.textContent = text; return node; }
export function button(text, className = "m3ssv2-button") { const node = el("button", className, text); node.type = "button"; return node; }
export function input(type, value, min = null, max = null, step = null) { const node = document.createElement("input"); node.type = type; if (value !== undefined) node.value = String(value); if (min !== null) node.min = String(min); if (max !== null) node.max = String(max); if (step !== null) node.step = String(step); return node; }
export function select(options, value) { const node = document.createElement("select"); for (const item of options) { const option = document.createElement("option"); option.value = item.value ?? item; option.textContent = item.label ?? item; option.selected = String(option.value) === String(value); node.appendChild(option); } return node; }
export function field(label, control, helper = "") { const node = el("label", "m3ssv2-field"); node.append(el("span", "m3ssv2-label", label), control); if (helper) node.appendChild(el("span", "m3ssv2-helper", helper)); return node; }
export function fmtTime(seconds) { const safe = Math.max(0, Number(seconds) || 0); const minutes = Math.floor(safe / 60); return `${minutes}:${(safe - minutes * 60).toFixed(2).padStart(5, "0")}`; }
export const clipDuration = (clip) => Math.max(0, Number(clip?.source_out) - Number(clip?.source_in));
export const clipEnd = (clip) => Number(clip?.timeline_start || 0) + clipDuration(clip);
export function timelineDuration(project, meta) { let end = 0; for (const track of project?.tracks || []) for (const clip of track?.clips || []) end = Math.max(end, clipEnd(clip)); end = Math.max(end, Number(meta?.rendered?.duration) || 0); for (const take of meta?.takes || []) end = Math.max(end, Number(take.duration) || 0); return Math.max(end, 1); }
export function previewUrl(ref) { if (!ref) return ""; const params = new URLSearchParams({ filename: ref.filename || ref.name || "", type: ref.type || "temp" }); if (ref.subfolder) params.set("subfolder", ref.subfolder); return api.apiURL(`/view?${params}`); }
export const firstPreviewRef = (entry) => entry?.audio?.[0] || null;
export function extractMeta(message) { const value = message?.m3ss_v2; return Array.isArray(value) ? value[0] || null : value || null; }

function normalizeEnvelope(value, duration) {
  const map = new Map();
  for (const raw of Array.isArray(value) ? value.slice(0, 128) : []) {
    if (!raw || typeof raw !== "object") continue;
    const time = clamp(raw.time, 0, Math.max(0, duration));
    map.set(time.toFixed(9), { time, gain_db: clamp(raw.gain_db, -60, 24) });
  }
  return [...map.values()].sort((a, b) => a.time - b.time);
}

function normalizeEffects(value) {
  return (Array.isArray(value) ? value : []).slice(0, 64).filter((item) => item && typeof item === "object").map((raw) => ({
    ...clone(raw),
    id: String(raw.id || uid("effect")),
    type: String(raw.type || ""),
    enabled: raw.enabled !== false,
    params: raw.params && typeof raw.params === "object" ? clone(raw.params) : {},
  }));
}

function migrateProject(raw) {
  const project = raw && typeof raw === "object" ? clone(raw) : {};
  const version = Number(project.edit_schema_version || 1);
  if (version !== 1 && version !== EDIT_SCHEMA_VERSION) throw new Error(`Unsupported audio edit_schema_version=${version}.`);
  if (version === 1) {
    for (const [index, track] of (Array.isArray(project.tracks) ? project.tracks : []).entries()) {
      if (!track || typeof track !== "object") continue;
      track.name ||= index === 0 ? "Main Track" : `Track ${index + 1}`;
      track.muted ??= false;
      track.solo ??= false;
      track.gain_db ??= 0;
      track.pan ??= 0;
      track.gain_envelope ??= [];
      track.effects ??= [];
    }
    project.master ||= {};
    project.master.effects ??= [];
    project.view ||= {};
    project.view.waveform_height ??= 360;
  }
  project.edit_schema_version = EDIT_SCHEMA_VERSION;
  return project;
}

export function defaultProject(meta) {
  const take = meta?.takes?.find((item) => item.id === "take-1") || meta?.takes?.[0];
  const duration = Number(take?.duration) || 1;
  return {
    edit_schema_version: EDIT_SCHEMA_VERSION,
    project_id: "",
    view: { zoom: 1, scroll_seconds: 0, waveform_height: 360 },
    takes: (meta?.takes || []).map((item) => ({ id: item.id, input: item.input, name: item.name || item.id, enabled: true })),
    tracks: [{
      id: "main",
      name: "Main Track",
      muted: false,
      solo: false,
      gain_db: 0,
      pan: 0,
      gain_envelope: [],
      effects: [],
      clips: [{
        id: uid("clip"), source_id: "take-1", source_in: 0, source_out: duration, timeline_start: 0,
        gain_db: 0, pan: 0, muted: false, reverse: false,
        fade_in: { duration: 0, curve: "linear" }, fade_out: { duration: 0, curve: "linear" }, gain_envelope: [],
      }],
    }],
    master: { gain_db: 0, channel_mode: "preserve", normalize: { enabled: false, target_peak_dbfs: -1 }, effects: [] },
    reserved: {},
  };
}

export function normalizeProject(raw, meta) {
  const fallback = defaultProject(meta);
  const project = migrateProject(raw && typeof raw === "object" ? raw : fallback);
  const takeMap = new Map((meta?.takes || []).map((take) => [take.id, take]));
  project.project_id = typeof project.project_id === "string" ? project.project_id : "";
  project.view = project.view && typeof project.view === "object" ? project.view : {};
  project.view.zoom = clamp(project.view.zoom || 1, .05, 100);
  project.view.scroll_seconds = Math.max(0, Number(project.view.scroll_seconds) || 0);
  project.view.waveform_height = clamp(project.view.waveform_height || 360, 220, 900);
  project.takes = (meta?.takes || []).map((take) => {
    const existing = Array.isArray(project.takes) ? project.takes.find((item) => item?.id === take.id) : null;
    return { ...(existing || {}), id: take.id, input: take.input, name: existing?.name || take.name || take.id, enabled: existing?.enabled !== false };
  });

  project.tracks = Array.isArray(project.tracks) && project.tracks.length ? project.tracks : fallback.tracks;
  if (!Array.isArray(project.tracks[0]?.clips) || !project.tracks[0].clips.length) project.tracks[0].clips = fallback.tracks[0].clips;
  for (const [trackIndex, track] of project.tracks.entries()) {
    track.id ||= uid("track");
    track.name ||= trackIndex === 0 ? "Main Track" : `Track ${trackIndex + 1}`;
    track.muted = !!track.muted;
    track.solo = !!track.solo;
    track.gain_db = clamp(track.gain_db, -60, 24);
    track.pan = clamp(track.pan, -1, 1);
    track.effects = normalizeEffects(track.effects);
    track.clips = Array.isArray(track.clips) ? track.clips : [];
    for (const clip of track.clips) {
      clip.id ||= uid("clip");
      if (!takeMap.has(clip.source_id)) clip.source_id = "take-1";
      const source = takeMap.get(clip.source_id) || meta?.takes?.[0];
      const maximum = Number(source?.duration) || 1;
      clip.source_in = clamp(clip.source_in, 0, maximum);
      clip.source_out = clamp(clip.source_out ?? maximum, 0, maximum);
      if (clip.source_out <= clip.source_in) clip.source_out = Math.min(maximum, clip.source_in + .01);
      clip.timeline_start = Math.max(0, Number(clip.timeline_start) || 0);
      clip.gain_db = clamp(clip.gain_db, -60, 24);
      clip.pan = clamp(clip.pan, -1, 1);
      clip.muted = !!clip.muted;
      clip.reverse = !!clip.reverse;
      clip.fade_in = clip.fade_in && typeof clip.fade_in === "object" ? clip.fade_in : { duration: 0, curve: "linear" };
      clip.fade_out = clip.fade_out && typeof clip.fade_out === "object" ? clip.fade_out : { duration: 0, curve: "linear" };
      clip.fade_in.duration = clamp(clip.fade_in.duration, 0, clipDuration(clip));
      clip.fade_out.duration = clamp(clip.fade_out.duration, 0, clipDuration(clip));
      if (!FADE_CURVES.includes(clip.fade_in.curve)) clip.fade_in.curve = "linear";
      if (!FADE_CURVES.includes(clip.fade_out.curve)) clip.fade_out.curve = "linear";
      clip.gain_envelope = normalizeEnvelope(clip.gain_envelope, clipDuration(clip));
    }
    const duration = track.clips.reduce((maximum, clip) => Math.max(maximum, clipEnd(clip)), 0);
    track.gain_envelope = normalizeEnvelope(track.gain_envelope, duration);
  }

  project.master = project.master && typeof project.master === "object" ? project.master : {};
  project.master.gain_db = clamp(project.master.gain_db, -60, 24);
  if (!CHANNEL_MODES.includes(project.master.channel_mode)) project.master.channel_mode = "preserve";
  project.master.normalize = project.master.normalize && typeof project.master.normalize === "object" ? project.master.normalize : {};
  project.master.normalize.enabled = !!project.master.normalize.enabled;
  project.master.normalize.target_peak_dbfs = clamp(project.master.normalize.target_peak_dbfs ?? -1, -60, 0);
  project.master.effects = normalizeEffects(project.master.effects);
  project.reserved = project.reserved && typeof project.reserved === "object" ? project.reserved : {};
  project.edit_schema_version = EDIT_SCHEMA_VERSION;
  return project;
}

export function mainTrack(project) {
  if (!project.tracks?.length) project.tracks = defaultProject(null).tracks;
  return project.tracks[0];
}

export function semanticOverlay(node) {
  const graph = app.graph;
  if (!graph) return [];
  const queue = [{ node, depth: 0 }];
  const seen = new Set();
  const found = [];
  while (queue.length) {
    const current = queue.shift();
    if (!current.node || current.depth > 12 || seen.has(current.node.id)) continue;
    seen.add(current.node.id);
    if (current.node !== node && nodeClass(current.node) === V1_NODE_ID) found.push(current.node);
    for (const socket of current.node.inputs || []) {
      if (socket?.link == null) continue;
      const link = graph.links?.[socket.link];
      const origin = link ? graph.getNodeById?.(link.origin_id) : null;
      if (origin) queue.push({ node: origin, depth: current.depth + 1 });
    }
  }
  const unique = [...new Map(found.map((item) => [item.id, item])).values()];
  if (unique.length !== 1) return [];
  const widget = getWidget(unique[0], "project_json");
  if (!widget?.value) return [];
  try {
    const project = JSON.parse(widget.value);
    let cursor = 0;
    return (project?.timeline?.sections || []).map((section) => {
      const start = cursor;
      cursor += Math.max(0, Number(section.duration) || 0);
      return { start, end: cursor, label: section.label || section.type || "Section" };
    });
  } catch {
    return [];
  }
}

export const snapshot = (project) => JSON.stringify(project);
export const parseSnapshot = (value) => JSON.parse(value);

function splitEnvelope(points, splitTime, duration, side) {
  const source = Array.isArray(points) ? points : [];
  if (side === "left") return source.filter((point) => point.time <= splitTime + 1e-9).map((point) => ({ ...point }));
  return source.filter((point) => point.time >= splitTime - 1e-9).map((point) => ({ ...point, time: clamp(point.time - splitTime, 0, Math.max(0, duration - splitTime)) }));
}

export function splitClip(clip, time) {
  const start = Number(clip.timeline_start);
  const end = clipEnd(clip);
  if (!(time > start + 1e-6 && time < end - 1e-6)) return null;
  const offset = time - start;
  const duration = clipDuration(clip);
  const left = clone(clip);
  const right = clone(clip);
  left.id = uid("clip");
  right.id = uid("clip");
  right.timeline_start = time;
  if (clip.reverse) {
    const cut = Number(clip.source_out) - offset;
    left.source_in = cut;
    right.source_out = cut;
  } else {
    const cut = Number(clip.source_in) + offset;
    left.source_out = cut;
    right.source_in = cut;
  }
  left.fade_out = { duration: 0, curve: left.fade_out?.curve || "linear" };
  right.fade_in = { duration: 0, curve: right.fade_in?.curve || "linear" };
  left.gain_envelope = splitEnvelope(clip.gain_envelope, offset, duration, "left");
  right.gain_envelope = splitEnvelope(clip.gain_envelope, offset, duration, "right");
  return [left, right];
}

export function deleteTimelineRange(track, start, end) {
  if (!(end > start)) return;
  const output = [];
  for (const clip of track.clips) {
    const clipStart = Number(clip.timeline_start);
    const clipFinish = clipEnd(clip);
    if (clipFinish <= start || clipStart >= end) {
      output.push(clip);
      continue;
    }
    let pieces = [clip];
    for (const cut of [end, start]) {
      const next = [];
      for (const piece of pieces) next.push(...(splitClip(piece, cut) || [piece]));
      pieces = next;
    }
    for (const piece of pieces) {
      const pieceStart = Number(piece.timeline_start);
      const pieceEnd = clipEnd(piece);
      if (pieceEnd <= start || pieceStart >= end) output.push(piece);
    }
  }
  track.clips = output;
}
