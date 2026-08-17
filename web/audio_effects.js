import { button, el, input, select, uid } from "./audio_editor_core.js";
import { currentUiLocale } from "./ui_i18n.js";
import {
  EFFECT_CATALOG, createEffect, effectCategories, effectDefinition, effectOwner,
  moveEffect, resetEffectParams, setEffectParam,
} from "./audio_effects_core.js";

const STYLE_ID = "m3ss-v2-effects-style";

const JA = {
  "Effects Rack": "エフェクトラック",
  "Track Effects": "トラックエフェクト",
  "Master Effects": "マスターエフェクト",
  "Track": "トラック",
  "Master": "マスター",
  "+ Add Effect": "+ エフェクトを追加",
  "No effects yet.": "エフェクトはまだありません。",
  "DSP pending": "DSP未実装",
  "Foundation only": "基盤UIのみ",
  "New effects start OFF. Parameter editing is saved now; DSP rendering arrives in V2.1-B.": "新しいエフェクトはOFFで追加されます。パラメータ編集は保存されますが、DSPレンダーはV2.1-Bで実装します。",
  "Enabled effects intentionally fail Draft/Queue until their DSP is implemented; they are never silently ignored.": "DSP未実装のエフェクトをONにすると、黙って無視せずDraft / Queueで明示的にエラーになります。",
  "Reset": "リセット",
  "Delete": "削除",
  "Move up": "上へ",
  "Move down": "下へ",
  "On": "オン",
  "Off": "オフ",
  "Unknown effect": "不明なエフェクト",
  "Unknown effect data is preserved. No parameter editor is available for this type.": "不明なエフェクトのデータは保持されます。このタイプのパラメータ編集UIはありません。",
  "Level": "レベル",
  "Dynamics": "ダイナミクス",
  "EQ / Filter": "EQ / フィルター",
  "Stereo": "ステレオ",
  "Space": "空間系",
  "Gain / Amplify": "ゲイン / 増幅",
  "Gain": "ゲイン",
  "Compressor": "コンプレッサー",
  "Limiter": "リミッター",
  "EQ (3-Band)": "EQ（3バンド）",
  "High-Pass Filter": "ハイパスフィルター",
  "Low-Pass Filter": "ローパスフィルター",
  "Stereo Width": "ステレオ幅",
  "Reverb": "リバーブ",
  "Threshold": "しきい値",
  "Ratio": "レシオ",
  "Attack": "アタック",
  "Release": "リリース",
  "Makeup": "メイクアップ",
  "Ceiling": "シーリング",
  "Lookahead": "ルックアヘッド",
  "Low": "Low",
  "Mid": "Mid",
  "High": "High",
  "Cutoff": "カットオフ",
  "Slope": "スロープ",
  "Width": "幅",
  "Room Size": "ルームサイズ",
  "Pre-delay": "プリディレイ",
  "Reverberance": "残響",
  "Damping": "ダンピング",
  "Tone Low": "Tone Low",
  "Tone High": "Tone High",
  "Wet Gain": "Wetゲイン",
  "Dry Gain": "Dryゲイン",
  "Wet Only": "Wetのみ",
};

const tr = (text) => currentUiLocale() === "ja" ? (JA[text] || text) : text;

export function ensureEffectsStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./audio_effects.css", import.meta.url).href;
  document.head.appendChild(link);
}

export function createEffectsRackState() {
  return { owner: "track", expandedId: null, addOpen: false, dragId: null };
}

function formatParam(param, value) {
  if (param.kind === "boolean") return value ? tr("On") : tr("Off");
  if (param.kind === "select") return `${value}${param.key === "slope_db_oct" ? " dB/oct" : ""}`;
  const number = Number(value);
  const digits = param.step < 1 ? 1 : 0;
  return `${Number.isFinite(number) ? number.toFixed(digits) : param.defaultValue}${param.unit ? ` ${param.unit}` : ""}`;
}

function effectSummary(effect, definition) {
  if (!definition) return String(effect.type || tr("Unknown effect"));
  const params = effect.params || {};
  return definition.params.slice(0, 3).map((param) => (
    `${tr(param.label)} ${formatParam(param, params[param.key] ?? param.defaultValue)}`
  )).join(" · ");
}

function parameterEditor(effect, param, commit, rerender) {
  const row = el("label", `m3ssv2-fx-param is-${param.kind}`);
  row.appendChild(el("span", "m3ssv2-fx-param-label", tr(param.label)));
  const current = effect.params?.[param.key] ?? param.defaultValue;

  if (param.kind === "boolean") {
    const checkbox = input("checkbox");
    checkbox.checked = !!current;
    checkbox.onchange = () => {
      commit(() => setEffectParam(effect, param.key, checkbox.checked));
      rerender();
    };
    row.appendChild(checkbox);
    return row;
  }

  if (param.kind === "select") {
    const control = select(param.values.map((value) => ({
      value,
      label: param.key === "slope_db_oct" ? `${value} dB/oct` : String(value),
    })), current);
    control.onchange = () => {
      commit(() => setEffectParam(effect, param.key, control.value));
      rerender();
    };
    row.appendChild(control);
    return row;
  }

  const controls = el("div", "m3ssv2-fx-param-controls");
  const number = input("number", current, param.minimum, param.maximum, param.step);
  const slider = input("range", current, param.minimum, param.maximum, param.step);
  const unit = el("span", "m3ssv2-fx-param-unit", param.unit || "");
  slider.oninput = () => { number.value = slider.value; };
  number.oninput = () => { slider.value = number.value; };
  const apply = (value) => {
    commit(() => setEffectParam(effect, param.key, value));
    rerender();
  };
  slider.onchange = () => apply(slider.value);
  number.onchange = () => apply(number.value);
  controls.append(number, slider, unit);
  row.appendChild(controls);
  return row;
}

function ownerTitle(project, owner) {
  if (owner === "master") return tr("Master Effects");
  const name = String(project?.tracks?.[0]?.name || "Main Track");
  return `${tr("Track Effects")} · ${name}`;
}

export function renderEffectsRack(container, project, commit, state = createEffectsRackState()) {
  ensureEffectsStyles();
  const rerender = () => renderEffectsRack(container, project, commit, state);
  const root = el("div", "m3ssv2-effects-root");

  const head = el("div", "m3ssv2-effects-head");
  const title = el("div", "m3ssv2-effects-title");
  title.append(el("strong", "", tr("Effects Rack")), el("span", "m3ssv2-fx-phase", `V2.1-A · ${tr("Foundation only")}`));
  const ownerTabs = el("div", "m3ssv2-effects-owner-tabs");
  for (const owner of ["track", "master"]) {
    const tab = button(tr(owner === "track" ? "Track" : "Master"), `m3ssv2-fx-owner${state.owner === owner ? " is-active" : ""}`);
    tab.onclick = () => {
      state.owner = owner;
      state.expandedId = null;
      state.addOpen = false;
      rerender();
    };
    ownerTabs.appendChild(tab);
  }
  head.append(title, ownerTabs);
  root.appendChild(head);

  const boundary = el("div", "m3ssv2-effects-boundary");
  boundary.append(
    el("div", "", tr("New effects start OFF. Parameter editing is saved now; DSP rendering arrives in V2.1-B.")),
    el("div", "", tr("Enabled effects intentionally fail Draft/Queue until their DSP is implemented; they are never silently ignored.")),
  );
  root.appendChild(boundary);

  const owner = effectOwner(project, state.owner);
  const effects = owner?.effects || [];
  const rackHead = el("div", "m3ssv2-effects-rack-head");
  rackHead.appendChild(el("strong", "", ownerTitle(project, state.owner)));
  const add = button(tr("+ Add Effect"), "m3ssv2-button m3ssv2-fx-add");
  add.onclick = () => { state.addOpen = !state.addOpen; rerender(); };
  rackHead.appendChild(add);
  root.appendChild(rackHead);

  if (state.addOpen) {
    const menu = el("div", "m3ssv2-fx-add-menu");
    for (const category of effectCategories()) {
      const group = el("section", "m3ssv2-fx-add-group");
      group.appendChild(el("strong", "", tr(category)));
      const items = el("div", "m3ssv2-fx-add-items");
      for (const definition of EFFECT_CATALOG.filter((item) => item.category === category)) {
        const item = button(tr(definition.label), "m3ssv2-fx-add-item");
        item.onclick = () => {
          let created;
          commit(() => {
            created = createEffect(definition.type, () => uid("effect"));
            effects.push(created);
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
    root.appendChild(menu);
  }

  const list = el("div", "m3ssv2-effects-list");
  if (!effects.length) list.appendChild(el("div", "m3ssv2-empty m3ssv2-fx-empty", tr("No effects yet.")));

  effects.forEach((effect, index) => {
    const definition = effectDefinition(effect.type);
    const expanded = state.expandedId === effect.id;
    const card = el("article", `m3ssv2-fx-card${expanded ? " is-expanded" : ""}${effect.enabled ? " is-enabled" : ""}`);
    card.dataset.effectId = effect.id;
    card.ondragover = (event) => event.preventDefault();
    card.ondrop = (event) => {
      event.preventDefault();
      const sourceId = state.dragId;
      state.dragId = null;
      if (!sourceId || sourceId === effect.id) return;
      commit(() => {
        const from = effects.findIndex((item) => item.id === sourceId);
        const to = effects.findIndex((item) => item.id === effect.id);
        if (from < 0 || to < 0) return;
        const [moved] = effects.splice(from, 1);
        effects.splice(to, 0, moved);
      });
      rerender();
    };

    const cardHead = el("div", "m3ssv2-fx-card-head");
    const power = button(effect.enabled ? "●" : "○", `m3ssv2-fx-power${effect.enabled ? " is-on" : ""}`);
    power.title = tr(effect.enabled ? "On" : "Off");
    power.onclick = () => {
      commit(() => { effect.enabled = !effect.enabled; });
      rerender();
    };
    const grab = el("span", "m3ssv2-fx-grab", "⋮⋮");
    grab.title = "Drag to reorder";
    grab.draggable = true;
    grab.ondragstart = (event) => {
      state.dragId = effect.id;
      event.dataTransfer?.setData?.("text/plain", effect.id);
      if (event.dataTransfer) event.dataTransfer.effectAllowed = "move";
    };
    grab.ondragend = () => { state.dragId = null; };
    const name = button(definition ? tr(definition.label) : `${tr("Unknown effect")}: ${effect.type || "—"}`, "m3ssv2-fx-name");
    name.onclick = () => { state.expandedId = expanded ? null : effect.id; rerender(); };
    const badge = el("span", "m3ssv2-fx-pending", tr("DSP pending"));
    const up = button("↑", "m3ssv2-fx-icon");
    up.title = tr("Move up");
    up.disabled = index === 0;
    up.onclick = () => { commit(() => moveEffect(effects, effect.id, -1)); rerender(); };
    const down = button("↓", "m3ssv2-fx-icon");
    down.title = tr("Move down");
    down.disabled = index === effects.length - 1;
    down.onclick = () => { commit(() => moveEffect(effects, effect.id, 1)); rerender(); };
    const arrow = button(expanded ? "▴" : "▾", "m3ssv2-fx-icon");
    arrow.onclick = () => { state.expandedId = expanded ? null : effect.id; rerender(); };
    const remove = button("×", "m3ssv2-fx-icon is-danger");
    remove.title = tr("Delete");
    remove.onclick = () => {
      commit(() => {
        const actual = effects.indexOf(effect);
        if (actual >= 0) effects.splice(actual, 1);
      });
      if (state.expandedId === effect.id) state.expandedId = null;
      rerender();
    };
    cardHead.append(power, grab, name, badge, up, down, arrow, remove);
    card.appendChild(cardHead);

    const summary = el("div", "m3ssv2-fx-summary", effectSummary(effect, definition));
    card.appendChild(summary);

    if (effect.enabled) {
      card.appendChild(el("div", "m3ssv2-fx-enabled-warning", tr("Enabled effects intentionally fail Draft/Queue until their DSP is implemented; they are never silently ignored.")));
    }

    if (expanded) {
      const body = el("div", "m3ssv2-fx-card-body");
      if (!definition) {
        body.appendChild(el("div", "m3ssv2-envelope-note", tr("Unknown effect data is preserved. No parameter editor is available for this type.")));
      } else {
        const params = el("div", "m3ssv2-fx-params");
        for (const param of definition.params) params.appendChild(parameterEditor(effect, param, commit, rerender));
        body.appendChild(params);
        const actions = el("div", "m3ssv2-fx-card-actions");
        const reset = button(tr("Reset"), "m3ssv2-button");
        reset.onclick = () => { commit(() => resetEffectParams(effect)); rerender(); };
        const deleteButton = button(tr("Delete"), "m3ssv2-button danger");
        deleteButton.onclick = remove.onclick;
        actions.append(reset, deleteButton);
        body.appendChild(actions);
      }
      card.appendChild(body);
    }
    list.appendChild(card);
  });

  root.appendChild(list);
  container.replaceChildren(root);
  return state;
}
