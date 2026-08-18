import { CHANNEL_MODES, FADE_CURVES, clamp, clipDuration, el, field, fmtTime, input, select } from "./audio_editor_core.js";

function change(control, event, commit, fn) {
  control.addEventListener(event, () => commit(() => fn(control)));
  return control;
}

function rememberEffectsContext(container, patch) {
  if (!container) return;
  const current = container._m3ssEffectsContext && typeof container._m3ssEffectsContext === "object"
    ? container._m3ssEffectsContext
    : {};
  Object.assign(current, patch);
  container._m3ssEffectsContext = current;
}

function panText(value) {
  const pan = Number(value) || 0;
  if (Math.abs(pan) < .01) return "Center";
  return `${pan < 0 ? "Left" : "Right"} ${Math.round(Math.abs(pan) * 100)}%`;
}

export function renderTrack(container, track, commit, onToolEnvelope) {
  rememberEffectsContext(container, { track, commit });
  container.replaceChildren();
  if (!track) {
    container.appendChild(el("div", "m3ssv2-empty", "No editable audio is available."));
    return;
  }
  const grid = el("div", "m3ssv2-grid m3ssv2-grid-2");
  const name = input("text", track.name || "Audio");
  change(name, "change", commit, (control) => { track.name = control.value.trim() || "Audio"; });
  const mute = input("checkbox");
  mute.checked = !!track.muted;
  change(mute, "change", commit, (control) => { track.muted = control.checked; });
  const solo = input("checkbox");
  solo.checked = !!track.solo;
  change(solo, "change", commit, (control) => { track.solo = control.checked; });
  const gain = input("number", track.gain_db || 0, -60, 24, .1);
  change(gain, "change", commit, (control) => { track.gain_db = clamp(control.value, -60, 24); });
  const pan = input("range", track.pan || 0, -1, 1, .01);
  const panValue = el("span", "m3ssv2-track-panel-pan", panText(track.pan));
  pan.oninput = () => { panValue.textContent = panText(pan.value); };
  change(pan, "change", commit, (control) => { track.pan = clamp(control.value, -1, 1); });
  const panWrap = el("div", "m3ssv2-pan-control");
  panWrap.append(pan, panValue);
  const envelope = el("button", "m3ssv2-button", "Edit Audio Envelope on Waveform");
  envelope.type = "button";
  envelope.onclick = () => onToolEnvelope?.();
  grid.append(
    field("Audio name", name),
    field("Mute", mute),
    field("Input gain (dB)", gain),
    field("Pan", panWrap),
    field("Automation", envelope),
  );
  container.appendChild(grid);
}

export function renderInspector(container, clip, meta, commit) {
  rememberEffectsContext(container, { commit });
  container.replaceChildren();
  if (!clip) {
    container.appendChild(el("div", "m3ssv2-empty", "Select a clip boundary on the waveform to edit advanced clip properties."));
    return;
  }
  container.appendChild(el("div", "m3ssv2-envelope-note", "Advanced clip properties. Normal editing is performed on the waveform; these values preserve non-destructive source ranges and comping."));
  const sources = (meta?.takes || []).map((take) => ({ value: take.id, label: take.name || take.id }));
  const grid = el("div", "m3ssv2-grid m3ssv2-grid-2");
  const source = select(sources, clip.source_id);
  change(source, "change", commit, (control) => {
    const old = clipDuration(clip);
    const take = meta.takes.find((item) => item.id === control.value);
    const maximum = Number(take?.duration) || old;
    clip.source_id = control.value;
    clip.source_in = clamp(clip.source_in, 0, maximum);
    clip.source_out = clamp(clip.source_in + old, clip.source_in + .01, maximum);
  });
  grid.appendChild(field("Source take", source));

  for (const [key, label, minimum, maximum, step] of [
    ["source_in", "Source in (s)", 0, 3600, .001],
    ["source_out", "Source out (s)", 0, 3600, .001],
    ["timeline_start", "Timeline start (s)", 0, 3600, .001],
    ["gain_db", "Clip gain (dB)", -60, 24, .1],
    ["pan", "Clip pan", -1, 1, .01],
  ]) {
    const control = input("number", clip[key], minimum, maximum, step);
    change(control, "change", commit, (item) => { clip[key] = clamp(item.value, minimum, maximum); });
    grid.appendChild(field(label, control));
  }

  const fadeIn = input("number", clip.fade_in?.duration || 0, 0, clipDuration(clip), .001);
  const fadeOut = input("number", clip.fade_out?.duration || 0, 0, clipDuration(clip), .001);
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
  grid.append(field("Reverse", reverse), field("Clip muted", mute));

  if (clip.gain_envelope?.length) {
    grid.appendChild(field("Legacy clip envelope", el("span", "m3ssv2-helper", `${clip.gain_envelope.length} point(s) retained for schema-1 compatibility. New automation should use Audio Envelope.`)));
  }
  container.appendChild(grid);
}

export function renderTrackEnvelope(container, track, duration, commit, onToolEnvelope) {
  rememberEffectsContext(container, { track, commit });
  container.replaceChildren();
  if (!track) {
    container.appendChild(el("div", "m3ssv2-empty", "No editable audio is available."));
    return;
  }
  container.appendChild(el(
    "div",
    "m3ssv2-envelope-note",
    "Audio Gain Envelope spans the complete edit timeline. Choose the Envelope tool, click the waveform to add a point, drag to move it, and right-click or double-click to delete it. Values are applied to Draft Preview immediately and to final AUDIO after Save Edits → Queue.",
  ));
  const actions = el("div", "m3ssv2-envelope-actions");
  const edit = el("button", "m3ssv2-button", "Use Envelope Tool");
  edit.type = "button";
  edit.onclick = () => onToolEnvelope?.();
  const clear = el("button", "m3ssv2-button", "Clear Envelope");
  clear.type = "button";
  clear.disabled = !(track.gain_envelope || []).length;
  clear.onclick = () => commit(() => { track.gain_envelope = []; });
  actions.append(edit, clear);
  container.appendChild(actions);

  const points = [...(track.gain_envelope || [])].sort((a, b) => a.time - b.time);
  const list = el("div", "m3ssv2-envelope-point-list");
  if (!points.length) {
    list.appendChild(el("div", "m3ssv2-empty", "No automation points. Audio remains at 0 dB before Input Gain."));
  }
  points.forEach((point, index) => {
    const row = el("div", "m3ssv2-envelope-point-row");
    const time = input("number", point.time, 0, Math.max(.001, duration), .001);
    const gain = input("number", point.gain_db, -60, 24, .1);
    const remove = el("button", "m3ssv2-button danger", "Delete");
    remove.type = "button";
    time.onchange = () => commit(() => { point.time = clamp(time.value, 0, duration); track.gain_envelope.sort((a, b) => a.time - b.time); });
    gain.onchange = () => commit(() => { point.gain_db = clamp(gain.value, -60, 24); });
    remove.onclick = () => commit(() => {
      const actual = track.gain_envelope.indexOf(point);
      if (actual >= 0) track.gain_envelope.splice(actual, 1);
    });
    row.append(el("span", "m3ssv2-envelope-index", String(index + 1)), field("Time", time), field("Gain dB", gain), remove);
    list.appendChild(row);
  });
  container.appendChild(list);
}

export function renderMaster(container, project, commit) {
  rememberEffectsContext(container, { project, track: project?.tracks?.[0] || null, commit });
  container.replaceChildren();
  const master = project.master;
  const grid = el("div", "m3ssv2-grid m3ssv2-grid-2");
  const gain = input("number", master.gain_db, -60, 24, .1);
  const mode = select([
    { value: "preserve", label: "Preserve source" },
    { value: "mono", label: "Mono" },
    { value: "stereo", label: "Stereo" },
    { value: "left_only", label: "Left only" },
    { value: "right_only", label: "Right only" },
    { value: "swap_lr", label: "Swap L/R" },
  ], master.channel_mode);
  const normalize = input("checkbox");
  const target = input("number", master.normalize.target_peak_dbfs, -60, 0, .1);
  normalize.checked = !!master.normalize.enabled;
  change(gain, "change", commit, (control) => { master.gain_db = clamp(control.value, -60, 24); });
  change(mode, "change", commit, (control) => { master.channel_mode = control.value; });
  change(normalize, "change", commit, (control) => { master.normalize.enabled = control.checked; });
  change(target, "change", commit, (control) => { master.normalize.target_peak_dbfs = clamp(control.value, -60, 0); });
  grid.append(
    field("Output gain (dB)", gain),
    field("Channel", mode),
    field("Normalize", normalize),
    field("Target peak dBFS", target),
  );
  container.appendChild(grid);
}

export function renderTakes(container, meta, previewId, onPreview) {
  container.replaceChildren();
  const list = el("div", "m3ssv2-take-list");
  for (const take of meta?.takes || []) {
    const layout = Number(take.channels) >= 2 ? "Stereo" : "Mono";
    const item = el("button", `m3ssv2-take-item${previewId === take.id ? " is-active" : ""}`, `${take.name || take.id} · ${layout} · ${take.sample_rate} Hz · ${Number(take.duration).toFixed(2)} s`);
    item.type = "button";
    item.onclick = () => onPreview(take.id);
    list.appendChild(item);
  }
  container.appendChild(list);
  container.appendChild(el("div", "m3ssv2-envelope-note", "Takes are explicit graph inputs. Select a Take to audition it; use the Clip inspector or Use Preview Take to assign it to a clip."));
}
