import { CHANNEL_MODES, FADE_CURVES, clamp, clipDuration, el, field, fmtTime, input, select } from "./audio_editor_core.js";

function change(control, event, commit, fn) {
  control.addEventListener(event, () => commit(() => fn(control)));
  return control;
}

export function renderInspector(container, clip, meta, commit) {
  container.replaceChildren();
  if (!clip) {
    container.appendChild(el("div", "m3ssv2-empty", "Select a clip to edit its properties."));
    return;
  }
  const sources = (meta?.takes || []).map((take) => ({ value: take.id, label: take.name || take.id }));
  const grid = el("div", "m3ssv2-grid m3ssv2-grid-2");
  const source = select(sources, clip.source_id);
  change(source, "change", commit, (control) => {
    const old = clipDuration(clip);
    const take = meta.takes.find((item) => item.id === control.value);
    const max = Number(take?.duration) || old;
    clip.source_id = control.value;
    clip.source_in = clamp(clip.source_in, 0, max);
    clip.source_out = clamp(clip.source_in + old, clip.source_in + 0.01, max);
  });
  grid.appendChild(field("Source take", source));

  for (const [key, label, min, max, step] of [
    ["source_in", "Source in (s)", 0, 3600, 0.01],
    ["source_out", "Source out (s)", 0, 3600, 0.01],
    ["timeline_start", "Timeline start (s)", 0, 3600, 0.01],
    ["gain_db", "Gain (dB)", -60, 24, 0.1],
    ["pan", "Pan", -1, 1, 0.01],
  ]) {
    const control = input("number", clip[key], min, max, step);
    change(control, "change", commit, (item) => { clip[key] = clamp(item.value, min, max); });
    grid.appendChild(field(label, control));
  }

  const fadeIn = input("number", clip.fade_in?.duration || 0, 0, clipDuration(clip), 0.01);
  const fadeOut = input("number", clip.fade_out?.duration || 0, 0, clipDuration(clip), 0.01);
  const curve = select(FADE_CURVES, clip.fade_in?.curve || "linear");
  change(fadeIn, "change", commit, (control) => { clip.fade_in.duration = clamp(control.value, 0, clipDuration(clip)); });
  change(fadeOut, "change", commit, (control) => { clip.fade_out.duration = clamp(control.value, 0, clipDuration(clip)); });
  change(curve, "change", commit, (control) => {
    clip.fade_in.curve = control.value;
    clip.fade_out.curve = control.value;
  });
  grid.append(field("Fade in (s)", fadeIn), field("Fade out (s)", fadeOut), field("Fade curve", curve));

  const reverse = input("checkbox");
  reverse.checked = !!clip.reverse;
  change(reverse, "change", commit, (control) => { clip.reverse = control.checked; });
  const mute = input("checkbox");
  mute.checked = !!clip.muted;
  change(mute, "change", commit, (control) => { clip.muted = control.checked; });
  grid.append(field("Reverse", reverse), field("Muted", mute));
  container.appendChild(grid);
}

export function renderEnvelope(container, clip, commit, begin, refresh) {
  container.replaceChildren();
  if (!clip) {
    container.appendChild(el("div", "m3ssv2-empty", "Select a clip to edit its gain envelope."));
    return;
  }
  container.appendChild(el(
    "div",
    "m3ssv2-envelope-note",
    "Selected clip Gain Envelope · time is relative to this clip · backend anchors 0 dB at clip start/end. Edit here or directly over the rendered waveform: click to add, drag to move, right-click or double-click a point to delete.",
  ));

  const wrap = el("div", "m3ssv2-envelope-wrap");
  const canvas = document.createElement("canvas");
  canvas.className = "m3ssv2-envelope";
  wrap.appendChild(canvas);
  container.appendChild(wrap);

  const points = clip.gain_envelope || (clip.gain_envelope = []);
  const duration = Math.max(0.01, clipDuration(clip));
  const DB_MAX = 24;
  const DB_MIN = -60;
  const TOP = 16;
  const BOTTOM_PAD = 30;
  let dragPoint = null;

  function plotBounds(height) {
    return { top: TOP, bottom: Math.max(TOP + 20, height - BOTTOM_PAD) };
  }

  function resize() {
    const rect = wrap.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    canvas.width = Math.max(400, Math.round(rect.width * dpr));
    canvas.height = 270 * dpr;
    canvas.style.height = "270px";
    draw();
  }

  function xy(point, width, height) {
    const bounds = plotBounds(height);
    return [
      clamp(point.time, 0, duration) / duration * width,
      bounds.top + (DB_MAX - clamp(point.gain_db, DB_MIN, DB_MAX)) / (DB_MAX - DB_MIN) * (bounds.bottom - bounds.top),
    ];
  }

  function previewPoints() {
    const map = new Map();
    for (const point of [{ time: 0, gain_db: 0 }, ...points, { time: duration, gain_db: 0 }]) {
      const time = clamp(point.time, 0, duration);
      map.set(time.toFixed(6), { time, gain_db: clamp(point.gain_db, DB_MIN, DB_MAX) });
    }
    return [...map.values()].sort((a, b) => a.time - b.time);
  }

  function draw() {
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const width = canvas.width / dpr;
    const height = canvas.height / dpr;
    const bounds = plotBounds(height);
    const context = canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#0b0f18";
    context.fillRect(0, 0, width, height);
    context.font = "10px ui-monospace,monospace";

    for (const db of [24, 12, 0, -12, -24, -36, -48, -60]) {
      const y = bounds.top + (DB_MAX - db) / (DB_MAX - DB_MIN) * (bounds.bottom - bounds.top);
      context.strokeStyle = db === 0 ? "rgba(99,210,190,.24)" : "rgba(255,255,255,.07)";
      context.beginPath();
      context.moveTo(0, y + 0.5);
      context.lineTo(width, y + 0.5);
      context.stroke();
      context.fillStyle = "rgba(255,255,255,.5)";
      context.fillText(`${db} dB`, 5, Math.max(10, y - 3));
    }

    const timeDivisions = 4;
    for (let index = 0; index <= timeDivisions; index++) {
      const time = duration * index / timeDivisions;
      const x = time / duration * width;
      context.strokeStyle = "rgba(255,255,255,.07)";
      context.beginPath();
      context.moveTo(x + 0.5, bounds.top);
      context.lineTo(x + 0.5, bounds.bottom);
      context.stroke();
      context.fillStyle = "rgba(255,255,255,.52)";
      const label = fmtTime(time);
      const labelWidth = context.measureText(label).width;
      const labelX = clamp(x - labelWidth / 2, 3, Math.max(3, width - labelWidth - 3));
      context.fillText(label, labelX, height - 8);
    }

    const sorted = previewPoints();
    context.strokeStyle = "#5cd2be";
    context.lineWidth = 2;
    context.beginPath();
    let first = true;
    for (const point of sorted) {
      const [x, y] = xy(point, width, height);
      if (first) {
        context.moveTo(x, y);
        first = false;
      } else {
        context.lineTo(x, y);
      }
    }
    context.stroke();

    for (const point of points) {
      const [x, y] = xy(point, width, height);
      context.fillStyle = "#78a6ff";
      context.beginPath();
      context.arc(x, y, 5, 0, Math.PI * 2);
      context.fill();
    }
  }

  function pointFromEvent(event) {
    const rect = canvas.getBoundingClientRect();
    const bounds = plotBounds(rect.height);
    const y = clamp(event.clientY - rect.top, bounds.top, bounds.bottom);
    return {
      time: clamp((event.clientX - rect.left) / Math.max(rect.width, 1) * duration, 0, duration),
      gain_db: clamp(DB_MAX - (y - bounds.top) / Math.max(bounds.bottom - bounds.top, 1) * (DB_MAX - DB_MIN), DB_MIN, DB_MAX),
    };
  }

  function nearestPoint(event) {
    const rect = canvas.getBoundingClientRect();
    let best = -1;
    let distance = 12;
    points.forEach((point, index) => {
      const [x, y] = xy(point, rect.width, rect.height);
      const nextDistance = Math.hypot(event.clientX - rect.left - x, event.clientY - rect.top - y);
      if (nextDistance < distance) {
        distance = nextDistance;
        best = index;
      }
    });
    return best;
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const index = nearestPoint(event);
    if (index < 0 && points.length >= 128) return;
    begin();
    if (index < 0) {
      dragPoint = pointFromEvent(event);
      points.push(dragPoint);
      points.sort((a, b) => a.time - b.time);
    } else {
      dragPoint = points[index];
    }
    canvas.setPointerCapture?.(event.pointerId);
    draw();
  });
  canvas.addEventListener("pointermove", (event) => {
    if (!dragPoint) return;
    Object.assign(dragPoint, pointFromEvent(event));
    points.sort((a, b) => a.time - b.time);
    draw();
  });
  canvas.addEventListener("pointerup", (event) => {
    if (!dragPoint) return;
    dragPoint = null;
    canvas.releasePointerCapture?.(event.pointerId);
    refresh();
  });
  canvas.addEventListener("pointercancel", (event) => {
    if (!dragPoint) return;
    dragPoint = null;
    canvas.releasePointerCapture?.(event.pointerId);
    refresh();
  });
  canvas.addEventListener("contextmenu", (event) => {
    event.preventDefault();
    const index = nearestPoint(event);
    if (index >= 0) commit(() => points.splice(index, 1));
  });
  canvas.addEventListener("dblclick", (event) => {
    const index = nearestPoint(event);
    if (index >= 0) {
      event.preventDefault();
      commit(() => points.splice(index, 1));
    }
  });

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(wrap);
  wrap._m3ssResizeObserver = resizeObserver;
  resize();
}

export function renderMaster(container, project, commit) {
  container.replaceChildren();
  const master = project.master;
  const grid = el("div", "m3ssv2-grid m3ssv2-grid-2");
  const gain = input("number", master.gain_db, -60, 24, 0.1);
  const mode = select([
    { value: "preserve", label: "Preserve source" },
    { value: "mono", label: "Mono" },
    { value: "stereo", label: "Stereo" },
    { value: "left_only", label: "Left only" },
    { value: "right_only", label: "Right only" },
    { value: "swap_lr", label: "Swap L/R" },
  ], master.channel_mode);
  const normalize = input("checkbox");
  const target = input("number", master.normalize.target_peak_dbfs, -60, 0, 0.1);
  normalize.checked = !!master.normalize.enabled;
  change(gain, "change", commit, (control) => { master.gain_db = clamp(control.value, -60, 24); });
  change(mode, "change", commit, (control) => { master.channel_mode = control.value; });
  change(normalize, "change", commit, (control) => { master.normalize.enabled = control.checked; });
  change(target, "change", commit, (control) => { master.normalize.target_peak_dbfs = clamp(control.value, -60, 0); });
  grid.append(
    field("Master gain (dB)", gain),
    field("Channel mode", mode, "This changes the queued backend output; waveform display mode is preview-only."),
    field("Peak normalize", normalize),
    field("Target peak dBFS", target),
  );
  container.appendChild(grid);
}

export function renderTakes(container, meta, previewId, onPreview, showTakes, onToggle) {
  container.replaceChildren();
  const controls = el("div", "m3ssv2-take-controls");
  const toggle = el("button", "m3ssv2-button", showTakes ? "Hide Take Lanes" : "Show Take Lanes");
  toggle.type = "button";
  toggle.onclick = onToggle;
  controls.appendChild(toggle);
  container.appendChild(controls);
  const list = el("div", "m3ssv2-take-list");
  for (const take of meta?.takes || []) {
    const layout = Number(take.channels) >= 2 ? "Stereo" : "Mono";
    const item = el("button", `m3ssv2-take-item${previewId === take.id ? " is-active" : ""}`, `${take.name || take.id} · ${layout} · ${take.sample_rate} Hz · ${Number(take.duration).toFixed(2)} s`);
    item.type = "button";
    item.onclick = () => onPreview(take.id);
    list.appendChild(item);
  }
  container.appendChild(list);
}
