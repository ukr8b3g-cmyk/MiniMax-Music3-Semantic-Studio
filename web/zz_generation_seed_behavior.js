import { app } from "../../scripts/app.js";

const NODE_ID = "MiniMaxMusic3SemanticStudio";
const STYLE_ID = "m3ss-seed-behavior-style";
const MODES = ["fixed", "increment", "decrement", "randomize"];

function nodeClass(node) {
  return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function isJapanese() {
  let locale = "";
  try { locale = String(app?.ui?.settings?.getSettingValue?.("Comfy.Locale") || ""); } catch {}
  if (!locale) locale = String(document.documentElement?.lang || navigator.language || "en");
  return /^ja(?:-|$)/i.test(locale);
}

function labels() {
  if (isJapanese()) {
    return {
      title: "シード動作（AR）",
      field: "生成後のシード",
      nodeField: "シード動作",
      help: "ComfyUI標準のSeed制御です。KSamplerのSeed Behaviorとは別に、Music Seed (AR)へ適用されます。",
      fixed: "固定",
      increment: "+1（増加）",
      decrement: "-1（減少）",
      randomize: "ランダム化",
    };
  }
  return {
    title: "Seed Behavior (AR)",
    field: "After Queue",
    nodeField: "Seed Behavior",
    help: "Uses ComfyUI's standard seed control for Music Seed (AR). This is separate from KSampler seed behavior.",
    fixed: "Fixed",
    increment: "Increment",
    decrement: "Decrement",
    randomize: "Randomize",
  };
}

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement("style");
  style.id = STYLE_ID;
  style.textContent = `
    .m3ss-generation-seed-behavior .m3ss-seed-behavior-field{display:grid;gap:7px}
    .m3ss-generation-seed-behavior .m3ss-seed-behavior-label{color:#aebed0;font-size:11px;font-weight:650}
    .m3ss-generation-seed-behavior select{width:100%;min-height:34px;border:1px solid rgba(255,255,255,.13);border-radius:7px;background:#151e2b;color:#eef4fb;padding:6px 9px;font-size:12px}
    .m3ss-generation-seed-behavior .m3ss-seed-behavior-help{margin:8px 0 0;color:#8799ad;font-size:10px;line-height:1.45}
  `;
  document.head.appendChild(style);
}

function isSeedControlWidget(widget) {
  const values = Array.isArray(widget?.options?.values) ? widget.options.values : [];
  return typeof widget?.beforeQueued === "function"
    && typeof widget?.afterQueued === "function"
    && MODES.every((mode) => values.includes(mode));
}

function findSeedControlWidget(node) {
  const seed = node?.widgets?.find((widget) => widget.name === "seed");
  const linked = seed?.linkedWidgets?.find?.(isSeedControlWidget);
  if (linked) return linked;
  return node?.widgets?.find((widget) => {
    if (!isSeedControlWidget(widget)) return false;
    const name = String(widget.name || "");
    return name === "control_after_generate" || /control.*generate/i.test(name);
  }) || null;
}

function setWidgetHidden(widget, hidden) {
  if (!widget) return;
  widget.hidden = hidden;
  widget.options = widget.options || {};
  widget.options.hidden = hidden;
}

function findOpenStudioButton(node) {
  return node?.widgets?.find((widget) => {
    if (widget.type !== "button") return false;
    const name = String(widget.name || widget.label || "");
    return name === "Open Semantic Studio" || name === "セマンティックスタジオを開く";
  }) || null;
}

function bindGenerationView(node, controlWidget) {
  const view = [...document.querySelectorAll(".m3ss-dialog .m3ss-generation-view")].at(-1);
  if (!view || view.dataset.seedBehaviorBound === "1") return false;
  const grid = view.querySelector(".m3ss-generation-grid");
  if (!grid) return false;

  ensureStyles();
  const text = labels();
  const card = document.createElement("section");
  card.className = "m3ss-generation-card m3ss-generation-seed-behavior";
  const title = document.createElement("h4");
  title.textContent = text.title;

  const field = document.createElement("label");
  field.className = "m3ss-seed-behavior-field";
  const caption = document.createElement("span");
  caption.className = "m3ss-seed-behavior-label";
  caption.textContent = text.field;
  const select = document.createElement("select");
  for (const mode of MODES) {
    const option = document.createElement("option");
    option.value = mode;
    option.textContent = text[mode];
    select.appendChild(option);
  }
  select.value = MODES.includes(String(controlWidget.value)) ? String(controlWidget.value) : "randomize";
  select.onchange = () => {
    controlWidget.value = select.value;
    controlWidget.callback?.(select.value);
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
  };
  field.append(caption, select);

  const help = document.createElement("p");
  help.className = "m3ss-seed-behavior-help";
  help.textContent = text.help;
  card.append(title, field, help);

  const seedCard = grid.querySelector(".m3ss-generation-card");
  if (seedCard?.nextSibling) grid.insertBefore(card, seedCard.nextSibling);
  else grid.appendChild(card);
  view.dataset.seedBehaviorBound = "1";
  return true;
}

function watchStudio(node, controlWidget) {
  node._m3ssSeedBehaviorObserver?.disconnect?.();
  const bind = () => bindGenerationView(node, controlWidget);
  bind();
  const observer = new MutationObserver(() => {
    bind();
    if (!document.querySelector(".m3ss-dialog")) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  node._m3ssSeedBehaviorObserver = observer;
}

function resizeNodeForGenerationControls(node) {
  const width = Math.max(node.size?.[0] || 360, 360);
  const height = Math.max(node.computeSize?.()[1] || node.size?.[1] || 220, 220);
  node.setSize?.([width, height]);
}

function install(node) {
  if (!node || nodeClass(node) !== NODE_ID) return;
  const seedWidget = node?.widgets?.find((widget) => widget.name === "seed") || null;
  const durationWidget = node?.widgets?.find((widget) => widget.name === "max_duration") || null;
  const controlWidget = findSeedControlWidget(node);

  setWidgetHidden(seedWidget, false);
  setWidgetHidden(durationWidget, false);
  setWidgetHidden(controlWidget, false);
  if (controlWidget) controlWidget.label = labels().nodeField;
  resizeNodeForGenerationControls(node);
  node.setDirtyCanvas?.(true, true);

  if (!controlWidget) return;
  const open = findOpenStudioButton(node);
  if (!open || open._m3ssSeedBehaviorWrapped) return;
  open._m3ssSeedBehaviorWrapped = true;
  const original = open.callback;
  open.callback = function (...args) {
    const result = original?.apply(this, args);
    queueMicrotask(() => watchStudio(node, controlWidget));
    return result;
  };
}

app.registerExtension({
  name: "minimax.music3.semantic.studio.seed-behavior",
  async nodeCreated(node) {
    if (nodeClass(node) !== NODE_ID) return;
    queueMicrotask(() => install(node));
    setTimeout(() => install(node), 80);
    setTimeout(() => install(node), 260);
  },
});
