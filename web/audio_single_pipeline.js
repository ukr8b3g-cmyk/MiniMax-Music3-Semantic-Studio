import { button, el, field, input, select, uid } from "./audio_editor_core.js";
import { currentUiLocale } from "./ui_i18n.js";
import {
  EFFECT_CATALOG, createEffect, effectCategories, effectDefinition,
  resetEffectParams, setEffectParam,
} from "./audio_effects_core.js";
import { ensureEffectsStyles } from "./audio_effects.js";

export const VST3_TYPE = "vst3";
const tr = (en, ja) => currentUiLocale() === "ja" ? ja : en;

function ensureProjectContainers(project) {
  if (!project || typeof project !== "object") return { track: null, master: null };
  project.tracks = Array.isArray(project.tracks) ? project.tracks : [];
  const track = project.tracks[0] || null;
  if (track) track.effects = Array.isArray(track.effects) ? track.effects : [];
  project.master ||= {};
  project.master.effects = Array.isArray(project.master.effects) ? project.master.effects : [];
  project.master.normalize ||= { enabled: false, target_peak_dbfs: -1 };
  return { track, master: project.master };
}

function pipelineLocations(project) {
  const { track, master } = ensureProjectContainers(project);
  return [
    ...(track?.effects || []).map((effect, index) => ({ effect, list: track.effects, index, stage: "input" })),
    ...(master?.effects || []).map((effect, index) => ({ effect, list: master.effects, index, stage: "output" })),
  ];
}

/** Read the historical internal order without exposing Track/Master to the UI. */
export function pipelineEffects(project) {
  return pipelineLocations(project).map(({ effect }) => effect);
}

export function pipelineBuiltinEffects(project) {
  return pipelineEffects(project).filter((effect) => String(effect?.type || "") !== VST3_TYPE);
}

export function pipelineVst3Effects(project) {
  return pipelineEffects(project).filter((effect) => String(effect?.type || "") === VST3_TYPE);
}

export function findPipelineEffect(project, effectId) {
  return pipelineLocations(project).find(({ effect }) => effect?.id === effectId)?.effect || null;
}

/** Parameter/state edits stay in their historical internal stage. */
export function mutatePipelineEffect(project, effectId, fn) {
  const location = pipelineLocations(project).find(({ effect }) => effect?.id === effectId);
  if (!location) return false;
  fn?.(location.effect, location.list);
  return true;
}

/** New release effects are appended to the end of the visible pipeline. */
export function appendPipelineEffect(project, effect) {
  const { master } = ensureProjectContainers(project);
  if (!master) return null;
  master.effects.push(effect);
  return effect;
}

export function removePipelineEffect(project, effectId) {
  const location = pipelineLocations(project).find(({ effect }) => effect?.id === effectId);
  if (!location) return false;
  location.list.splice(location.index, 1);
  return true;
}

/**
 * Reordering is the only operation allowed to move an effect across the hidden
 * internal stage boundary. We repartition at the previous boundary so the
 * combined user-visible order is exact while untouched projects remain bit-for-
 * bit structurally compatible.
 */
export function movePipelineEffect(project, effectId, direction, predicate = null) {
  const { track, master } = ensureProjectContainers(project);
  if (!track || !master) return false;
  const boundary = track.effects.length;
  const all = [...track.effects, ...master.effects];
  const eligible = all
    .map((effect, index) => ({ effect, index }))
    .filter(({ effect }) => !predicate || predicate(effect));
  const position = eligible.findIndex(({ effect }) => effect?.id === effectId);
  if (position < 0) return false;
  const targetPosition = position + (direction < 0 ? -1 : direction > 0 ? 1 : 0);
  if (targetPosition < 0 || targetPosition >= eligible.length || targetPosition === position) return false;
  const a = eligible[position].index;
  const b = eligible[targetPosition].index;
  [all[a], all[b]] = [all[b], all[a]];
  track.effects = all.slice(0, boundary);
  master.effects = all.slice(boundary);
  return true;
}

function change(control, event, commit, fn) {
  control.addEventListener(event, () => commit(() => fn(control)));
  return control;
}

function panText(value) {
  const pan = Number(value) || 0;
  if (Math.abs(pan) < .01) return "Center";
  return `${pan < 0 ? "Left" : "Right"} ${Math.round(Math.abs(pan) * 100)}%`;
}

function clipLength(clip) {
  return Math.max(0, Number(clip?.source_out || 0) - Number(clip?.source_in || 0));
}

function clipEnd(clip) {
  return Math.max(0, Number(clip?.timeline_start || 0)) + clipLength(clip);
}

export function audioEdgeClips(project) {
  const clips = [...(project?.tracks?.[0]?.clips || [])].filter((clip) => clip && typeof clip === "object");
  if (!clips.length) return { first: null, last: null };
  const first = clips.reduce((best, clip) => (
    Number(clip.timeline_start || 0) < Number(best.timeline_start || 0) ? clip : best
  ), clips[0]);
  const last = clips.reduce((best, clip) => (clipEnd(clip) > clipEnd(best) ? clip : best), clips[0]);
  return { first, last };
}

function ensureFade(clip, key) {
  if (!clip) return null;
  const current = clip[key] && typeof clip[key] === "object" ? clip[key] : {};
  clip[key] = {
    duration: Math.max(0, Math.min(clipLength(clip), Number(current.duration) || 0)),
    curve: current.curve === "equal_power" ? "equal_power" : "linear",
  };
  return clip[key];
}

function renderWholeAudioFades(root, project, commit, rerender) {
  const { first, last } = audioEdgeClips(project);
  const section = el("section", "m3ssv2-fade-section");
  const heading = el("div", "m3ssv2-fade-head");
  heading.appendChild(el("strong", "", tr("Fade In / Fade Out", "フェードイン / フェードアウト")));
  section.appendChild(heading);

  if (!first || !last) {
    section.appendChild(el("div", "m3ssv2-empty", tr("No audio clip is available for fades.", "フェードを適用できるオーディオクリップがありません。")));
    root.appendChild(section);
    return;
  }

  const fadeIn = ensureFade(first, "fade_in");
  const fadeOut = ensureFade(last, "fade_out");
  const grid = el("div", "m3ssv2-grid m3ssv2-grid-2 m3ssv2-fade-grid");
  const inDuration = input("number", fadeIn.duration, 0, clipLength(first), .01);
  const outDuration = input("number", fadeOut.duration, 0, clipLength(last), .01);
  const inCurve = select([
    { value: "linear", label: tr("Linear", "リニア") },
    { value: "equal_power", label: tr("Equal Power", "イコールパワー") },
  ], fadeIn.curve);
  const outCurve = select([
    { value: "linear", label: tr("Linear", "リニア") },
    { value: "equal_power", label: tr("Equal Power", "イコールパワー") },
  ], fadeOut.curve);

  const apply = (fn) => {
    commit(fn);
    rerender();
  };
  inDuration.onchange = () => apply(() => {
    ensureFade(first, "fade_in").duration = Math.max(0, Math.min(clipLength(first), Number(inDuration.value) || 0));
  });
  outDuration.onchange = () => apply(() => {
    ensureFade(last, "fade_out").duration = Math.max(0, Math.min(clipLength(last), Number(outDuration.value) || 0));
  });
  inCurve.onchange = () => apply(() => { ensureFade(first, "fade_in").curve = inCurve.value === "equal_power" ? "equal_power" : "linear"; });
  outCurve.onchange = () => apply(() => { ensureFade(last, "fade_out").curve = outCurve.value === "equal_power" ? "equal_power" : "linear"; });

  grid.append(
    field(tr("Fade In (s)", "フェードイン (秒)"), inDuration),
    field(tr("Fade In Curve", "フェードインカーブ"), inCurve),
    field(tr("Fade Out (s)", "フェードアウト (秒)"), outDuration),
    field(tr("Fade Out Curve", "フェードアウトカーブ"), outCurve),
  );
  section.appendChild(grid);
  section.appendChild(el(
    "div",
    "m3ssv2-envelope-note",
    tr(
      "Fades apply to the beginning and end of the complete edit using the existing non-destructive clip fade engine. Draft Preview and queued AUDIO use the same fade data.",
      "編集全体の先頭と末尾に、既存の非破壊クリップフェード処理を適用します。Draft Preview と Queue後の AUDIO は同じフェード設定を使用します。",
    ),
  ));
  root.appendChild(section);
}

export function renderSingleMixer(container, project, commit) {
  container.replaceChildren();
  const { track, master } = ensureProjectContainers(project);
  if (!track || !master) {
    container.appendChild(el("div", "m3ssv2-empty", tr("Audio controls are unavailable.", "オーディオ設定を利用できません。")));
    return;
  }

  const grid = el("div", "m3ssv2-grid m3ssv2-grid-2 m3ssv2-single-mixer");
  const inputGain = input("number", track.gain_db || 0, -60, 24, .1);
  inputGain.title = tr("Gain before Effects/VST3", "Effects/VST3の前段ゲイン");
  change(inputGain, "change", commit, (control) => { track.gain_db = Math.max(-60, Math.min(24, Number(control.value) || 0)); });

  const pan = input("range", track.pan || 0, -1, 1, .01);
  const panValue = el("span", "m3ssv2-track-panel-pan", panText(track.pan));
  pan.oninput = () => { panValue.textContent = panText(pan.value); };
  change(pan, "change", commit, (control) => { track.pan = Math.max(-1, Math.min(1, Number(control.value) || 0)); });
  const panWrap = el("div", "m3ssv2-pan-control");
  panWrap.append(pan, panValue);

  const outputGain = input("number", master.gain_db || 0, -60, 24, .1);
  outputGain.title = tr("Final gain after Effects/VST3", "Effects/VST3後の最終ゲイン");
  change(outputGain, "change", commit, (control) => { master.gain_db = Math.max(-60, Math.min(24, Number(control.value) || 0)); });

  const channel = select([
    { value: "preserve", label: tr("Preserve source", "ソース維持") },
    { value: "mono", label: "Mono" },
    { value: "stereo", label: "Stereo" },
    { value: "left_only", label: tr("Left only", "左のみ") },
    { value: "right_only", label: tr("Right only", "右のみ") },
    { value: "swap_lr", label: "Swap L/R" },
  ], master.channel_mode || "preserve");
  change(channel, "change", commit, (control) => { master.channel_mode = control.value; });

  const normalize = input("checkbox");
  normalize.checked = !!master.normalize?.enabled;
  change(normalize, "change", commit, (control) => { master.normalize.enabled = control.checked; });

  const target = input("number", master.normalize?.target_peak_dbfs ?? -1, -60, 0, .1);
  change(target, "change", commit, (control) => {
    master.normalize.target_peak_dbfs = Math.max(-60, Math.min(0, Number(control.value) || 0));
  });

  grid.append(
    field(tr("Input Gain (dB)", "入力ゲイン (dB)"), inputGain),
    field(tr("Pan", "パン"), panWrap),
    field(tr("Output Gain (dB)", "出力ゲイン (dB)"), outputGain),
    field(tr("Channel", "チャンネル"), channel),
    field(tr("Normalize", "ノーマライズ"), normalize),
    field(tr("Target Peak (dBFS)", "目標ピーク (dBFS)"), target),
  );
  container.appendChild(grid);
}

function formatParam(param, value) {
  if (param.kind === "boolean") return value ? "On" : "Off";
  if (param.kind === "select") return `${value}${param.key === "slope_db_oct" ? " dB/oct" : ""}`;
  const number = Number(value);
  const digits = param.step < 1 ? 1 : 0;
  return `${Number.isFinite(number) ? number.toFixed(digits) : param.defaultValue}${param.unit ? ` ${param.unit}` : ""}`;
}

function effectSummary(effect, definition) {
  if (!definition) return String(effect.type || "Unknown effect");
  const params = effect.params || {};
  return definition.params.slice(0, 3).map((param) => (
    `${param.label} ${formatParam(param, params[param.key] ?? param.defaultValue)}`
  )).join(" · ");
}

function parameterEditor(project, effectId, param, commit, rerender) {
  const effect = findPipelineEffect(project, effectId);
  const row = el("label", `m3ssv2-fx-param is-${param.kind}`);
  row.appendChild(el("span", "m3ssv2-fx-param-label", param.label));
  const current = effect?.params?.[param.key] ?? param.defaultValue;

  const apply = (raw) => {
    commit(() => mutatePipelineEffect(project, effectId, (target) => setEffectParam(target, param.key, raw)));
    rerender();
  };

  if (param.kind === "boolean") {
    const control = input("checkbox");
    control.checked = !!current;
    control.onchange = () => apply(control.checked);
    row.appendChild(control);
    return row;
  }

  if (param.kind === "select") {
    const control = select(param.values.map((value) => ({
      value,
      label: param.key === "slope_db_oct" ? `${value} dB/oct` : String(value),
    })), current);
    control.onchange = () => apply(control.value);
    row.appendChild(control);
    return row;
  }

  const controls = el("div", "m3ssv2-fx-param-controls");
  const number = input("number", current, param.minimum, param.maximum, param.step);
  const slider = input("range", current, param.minimum, param.maximum, param.step);
  const unit = el("span", "m3ssv2-fx-param-unit", param.unit || "");
  slider.oninput = () => { number.value = slider.value; };
  number.oninput = () => { slider.value = number.value; };
  slider.onchange = () => apply(slider.value);
  number.onchange = () => apply(number.value);
  controls.append(number, slider, unit);
  row.appendChild(controls);
  return row;
}

export function createSingleEffectsState() {
  return { expandedId: null, addOpen: false };
}

export function renderSingleEffectsRack(container, project, commit, state = createSingleEffectsState()) {
  ensureEffectsStyles();
  const rerender = () => renderSingleEffectsRack(container, project, commit, state);
  const effects = pipelineBuiltinEffects(project);
  const root = el("div", "m3ssv2-effects-root m3ssv2-single-effects");

  renderWholeAudioFades(root, project, commit, rerender);

  const rackHead = el("div", "m3ssv2-effects-rack-head");
  const add = button(tr("+ Add Effect", "+ エフェクトを追加"), "m3ssv2-button m3ssv2-fx-add");
  add.setAttribute("aria-expanded", state.addOpen ? "true" : "false");
  add.onclick = () => { state.addOpen = !state.addOpen; rerender(); };
  rackHead.appendChild(add);

  if (state.addOpen) {
    const menu = el("div", "m3ssv2-fx-add-menu");
    for (const category of effectCategories()) {
      const group = el("section", "m3ssv2-fx-add-group");
      group.appendChild(el("strong", "", category));
      const items = el("div", "m3ssv2-fx-add-items");
      for (const definition of EFFECT_CATALOG.filter((item) => item.category === category)) {
        const item = button(definition.label, "m3ssv2-fx-add-item");
        item.onclick = () => {
          let created = null;
          commit(() => {
            created = createEffect(definition.type, () => uid("effect"));
            appendPipelineEffect(project, created);
          });
          state.expandedId = created?.id || null;
          state.addOpen = false;
          rerender();
        };
        items.appendChild(item);
      }
      group.appendChild(items);
      menu.appendChild(group);
    }
    rackHead.appendChild(menu);
  }
  root.appendChild(rackHead);

  const list = el("div", "m3ssv2-effects-list");
  if (!effects.length) list.appendChild(el("div", "m3ssv2-empty m3ssv2-fx-empty", tr("No effects", "エフェクトなし")));

  effects.forEach((effect, index) => {
    const definition = effectDefinition(effect.type);
    const expanded = state.expandedId === effect.id;
    const card = el("article", `m3ssv2-fx-card${expanded ? " is-expanded" : ""}${effect.enabled ? " is-enabled" : ""}`);
    card.dataset.effectId = effect.id;

    const head = el("div", "m3ssv2-fx-card-head");
    const power = button(effect.enabled ? "●" : "○", `m3ssv2-fx-power${effect.enabled ? " is-on" : ""}`);
    power.title = effect.enabled ? "On" : "Bypass";
    power.setAttribute("aria-pressed", effect.enabled ? "true" : "false");
    power.onclick = () => {
      commit(() => mutatePipelineEffect(project, effect.id, (target) => { target.enabled = !target.enabled; }));
      rerender();
    };

    const name = button(definition?.label || `Unknown: ${effect.type || "—"}`, "m3ssv2-fx-name");
    name.onclick = () => { state.expandedId = expanded ? null : effect.id; rerender(); };

    const up = button("↑", "m3ssv2-fx-icon");
    up.disabled = index === 0;
    up.onclick = () => {
      commit(() => movePipelineEffect(project, effect.id, -1, (item) => String(item?.type || "") !== VST3_TYPE));
      rerender();
    };
    const down = button("↓", "m3ssv2-fx-icon");
    down.disabled = index === effects.length - 1;
    down.onclick = () => {
      commit(() => movePipelineEffect(project, effect.id, 1, (item) => String(item?.type || "") !== VST3_TYPE));
      rerender();
    };
    const arrow = button(expanded ? "▴" : "▾", "m3ssv2-fx-icon");
    arrow.onclick = () => { state.expandedId = expanded ? null : effect.id; rerender(); };
    const remove = button("×", "m3ssv2-fx-icon is-danger");
    remove.title = tr("Delete", "削除");
    remove.onclick = () => {
      commit(() => removePipelineEffect(project, effect.id));
      if (state.expandedId === effect.id) state.expandedId = null;
      rerender();
    };
    head.append(power, name, up, down, arrow, remove);
    card.appendChild(head);
    card.appendChild(el("div", "m3ssv2-fx-summary", effectSummary(effect, definition)));

    if (expanded) {
      const body = el("div", "m3ssv2-fx-card-body");
      if (definition) {
        const params = el("div", "m3ssv2-fx-params");
        for (const param of definition.params) params.appendChild(parameterEditor(project, effect.id, param, commit, rerender));
        body.appendChild(params);
        const actions = el("div", "m3ssv2-fx-card-actions");
        const reset = button(tr("Reset", "リセット"), "m3ssv2-button");
        reset.onclick = () => {
          commit(() => mutatePipelineEffect(project, effect.id, (target) => resetEffectParams(target)));
          rerender();
        };
        actions.appendChild(reset);
        body.appendChild(actions);
      }
      card.appendChild(body);
    }
    list.appendChild(card);
  });

  root.appendChild(list);
  container.replaceChildren(root);
}