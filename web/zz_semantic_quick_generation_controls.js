import { app } from "../../scripts/app.js";

const NODE_ID = "MiniMaxMusic3SemanticStudio";
const STYLE_ID = "m3ss-semantic-quick-generation-style";
const AUTO_SYNC_STORAGE_KEY = "m3ss-layout:semantic-generation-auto-sync";

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./semantic_quick_generation_controls.css", import.meta.url).href;
  document.head.appendChild(link);
}

let activeNode = null;
let quickDraft = null;

function nodeClass(node) {
  return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function widget(node, name) {
  return node?.widgets?.find((item) => item?.name === name || item?.label === name) || null;
}

function numericWidgetValue(node, name, fallback) {
  const value = Number(widget(node, name)?.value);
  return Number.isFinite(value) ? value : fallback;
}

function readAutoSyncPreference() {
  try {
    const raw = localStorage.getItem(AUTO_SYNC_STORAGE_KEY);
    if (raw === null) return true;
    const value = Number(raw);
    return Number.isFinite(value) ? value !== 0 : true;
  } catch {
    return true;
  }
}

function resolveNode() {
  if (activeNode && nodeClass(activeNode) === NODE_ID) return activeNode;
  const nodes = (app.graph?._nodes || []).filter((node) => nodeClass(node) === NODE_ID);
  return nodes.length === 1 ? nodes[0] : null;
}

function resetQuickDraft(node) {
  quickDraft = {
    cfg: numericWidgetValue(node, "cfg_scale", 1.5),
    duration: numericWidgetValue(node, "max_duration", 30),
    durationDirty: false,
    autoSync: readAutoSyncPreference(),
  };
}

function generationCards(dialog) {
  const cards = [...dialog.querySelectorAll(".m3ss-generation-card")];
  const cfgCard = cards.find((card) => /Music CFG|音楽CFG/i.test(card.querySelector("h4")?.textContent || ""));
  const durationCard = cards.find((card) => card.classList.contains("is-duration") || /Duration Limit|生成時間上限/i.test(card.querySelector("h4")?.textContent || ""));
  return { cfgCard, durationCard };
}

function timelineTotalDuration(dialog) {
  const text = dialog.querySelector(".m3ss-timeline-accordion-summary")?.textContent
    || dialog.querySelector(".m3shell-subtitle")?.textContent
    || "";
  const match = text.match(/([0-9]+(?:\.[0-9]+)?)\s*s\b/i);
  const value = match ? Number(match[1]) : NaN;
  return Number.isFinite(value) ? value : null;
}

function captureVisibleGeneration(dialog) {
  if (!quickDraft) return;
  const { cfgCard, durationCard } = generationCards(dialog);
  const cfg = cfgCard?.querySelector('input[type="number"]');
  const duration = durationCard?.querySelector('input[type="number"]');
  const auto = durationCard?.querySelector('input[type="checkbox"]');
  if (cfg && Number.isFinite(Number(cfg.value))) quickDraft.cfg = Number(cfg.value);
  if (auto) quickDraft.autoSync = !!auto.checked;
  if (duration && Number.isFinite(Number(duration.value))) {
    quickDraft.duration = Number(duration.value);
    quickDraft.durationDirty = false;
  }
}

function refreshAutoSyncedDuration(dialog) {
  if (!quickDraft?.autoSync || quickDraft.durationDirty) return;
  const total = timelineTotalDuration(dialog);
  if (!Number.isFinite(total)) return;
  quickDraft.duration = total;
  const input = dialog.querySelector('.m3ss-semantic-quick-field.is-duration input[type="number"]');
  if (input && document.activeElement !== input) input.value = String(total);
}

function setInputValue(input, value) {
  if (!input || !Number.isFinite(Number(value))) return;
  const next = String(value);
  if (input.value === next) return;
  input.value = next;
  input.dispatchEvent(new Event("input", { bubbles: true }));
}

function syncVisibleGeneration(dialog) {
  if (!quickDraft) return;
  let { cfgCard, durationCard } = generationCards(dialog);
  if (!cfgCard && !durationCard) return;

  setInputValue(cfgCard?.querySelector('input[type="number"]'), quickDraft.cfg);

  if (quickDraft.durationDirty) {
    const auto = durationCard?.querySelector('input[type="checkbox"]');
    if (auto?.checked) {
      auto.checked = false;
      auto.dispatchEvent(new Event("change", { bubbles: true }));
      quickDraft.autoSync = false;
      ({ cfgCard, durationCard } = generationCards(dialog));
    }
    setInputValue(durationCard?.querySelector('input[type="number"]'), quickDraft.duration);
  }
}

function generationTab(dialog) {
  return dialog.querySelector('.m3ss-top-tab[data-view="generation"]');
}

function timelineTab(dialog) {
  return dialog.querySelector('.m3ss-top-tab[data-view="timeline"]');
}

function syncQuickControlsThroughGeneration(dialog, returnToTimeline = true) {
  const generation = generationTab(dialog);
  const timeline = timelineTab(dialog);
  if (!generation) return;
  const wasTimeline = !!timeline?.classList.contains("is-active");
  if (!generation.classList.contains("is-active")) generation.click();
  syncVisibleGeneration(dialog);
  if (returnToTimeline && wasTimeline) timeline?.click();
}

function refreshQuickDraftFromHistory(dialog) {
  const generation = generationTab(dialog);
  const timeline = timelineTab(dialog);
  if (!generation) return;
  const wasTimeline = !!timeline?.classList.contains("is-active");
  if (!generation.classList.contains("is-active")) generation.click();
  captureVisibleGeneration(dialog);
  if (wasTimeline) timeline?.click();
  refreshAutoSyncedDuration(dialog);
}

function syncDraftBeforeSave(dialog) {
  const generation = generationTab(dialog);
  if (!generation) return;
  if (!generation.classList.contains("is-active")) generation.click();
  else captureVisibleGeneration(dialog);
  syncVisibleGeneration(dialog);
}

function makeField(label, value, { min, max, step, className, onInput, onChange }) {
  const field = document.createElement("label");
  field.className = `m3ss-field m3ss-semantic-quick-field ${className}`;
  field.dataset.m3ssQuickGeneration = "1";
  const title = document.createElement("span");
  title.className = "m3ss-label";
  title.textContent = label;
  const input = document.createElement("input");
  input.type = "number";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  input.value = String(value);
  input.addEventListener("input", () => onInput(input));
  input.addEventListener("change", () => onChange?.(input));
  field.append(title, input);
  return field;
}

function ensureQuickControls(dialog) {
  if (!dialog?.isConnected) return;
  const primary = dialog.querySelector(".m3ss-song-settings-primary");
  if (!primary) return;
  if (primary.querySelector('[data-m3ss-quick-generation="1"]')) {
    refreshAutoSyncedDuration(dialog);
    return;
  }

  const node = resolveNode();
  if (!node) return;
  if (!quickDraft) resetQuickDraft(node);
  refreshAutoSyncedDuration(dialog);

  const cfgWidget = widget(node, "cfg_scale");
  const durationWidget = widget(node, "max_duration");
  const commitChange = () => syncQuickControlsThroughGeneration(dialog, true);
  const cfg = makeField("CFG", quickDraft.cfg, {
    min: Number(cfgWidget?.options?.min) || 0,
    max: Number(cfgWidget?.options?.max) || 100,
    step: Number(cfgWidget?.options?.step) || .1,
    className: "is-cfg",
    onInput: (input) => {
      const value = Number(input.value);
      if (Number.isFinite(value)) quickDraft.cfg = value;
    },
    onChange: commitChange,
  });
  const duration = makeField("Duration", quickDraft.duration, {
    min: Number(durationWidget?.options?.min) || .04,
    max: Number(durationWidget?.options?.max) || 360,
    step: Number(durationWidget?.options?.step) || .04,
    className: "is-duration",
    onInput: (input) => {
      const value = Number(input.value);
      if (Number.isFinite(value)) {
        quickDraft.duration = value;
        quickDraft.durationDirty = true;
      }
    },
    onChange: commitChange,
  });
  duration.querySelector("input").title = "Generation duration limit in seconds";

  const more = primary.querySelector(".m3ss-more-settings-button");
  if (more) {
    primary.insertBefore(cfg, more);
    primary.insertBefore(duration, more);
  } else {
    primary.append(cfg, duration);
  }
}

function installDialogBridge(dialog) {
  if (!dialog || dialog.dataset.m3ssQuickGenerationBridge === "1") return;
  dialog.dataset.m3ssQuickGenerationBridge = "1";
  if (!quickDraft) {
    const node = resolveNode();
    if (node) resetQuickDraft(node);
  }

  dialog.addEventListener("click", (event) => {
    const button = event.target.closest?.("button");
    if (!button) return;
    if (button.matches('.m3ss-top-tab[data-view="timeline"]')) captureVisibleGeneration(dialog);
    if (button.matches('.m3ss-top-tab[data-view="generation"]')) {
      queueMicrotask(() => syncVisibleGeneration(dialog));
    }
    if (button.matches(".m3ss-history-undo,.m3ss-history-redo")) {
      queueMicrotask(() => refreshQuickDraftFromHistory(dialog));
    }
    if (button.closest(".m3ss-footer") && /Reset|リセット/i.test(button.textContent || "")) {
      queueMicrotask(() => refreshQuickDraftFromHistory(dialog));
    }
    if (/Save to Node|ノードに保存/i.test(button.textContent || "")) syncDraftBeforeSave(dialog);
  }, true);

  const observer = new MutationObserver(() => {
    if (!dialog.isConnected) {
      observer.disconnect();
      return;
    }
    ensureQuickControls(dialog);
    refreshAutoSyncedDuration(dialog);
  });
  observer.observe(dialog, { childList: true, subtree: true });
  ensureQuickControls(dialog);
}

function scanDialogs() {
  for (const dialog of document.querySelectorAll(".m3ss-dialog")) installDialogBridge(dialog);
}

function wrapOpenWidget(node) {
  if (!node || node._m3ssQuickGenerationWrapped) return;
  const attempt = () => {
    const open = node.widgets?.find((item) => item?.type === "button" && /Semantic Studio|セマンティック/i.test(String(item?.name || item?.label || "")));
    if (!open?.callback || open._m3ssQuickGenerationWrapped) return false;
    const original = open.callback;
    open.callback = (...args) => {
      activeNode = node;
      resetQuickDraft(node);
      return original(...args);
    };
    open._m3ssQuickGenerationWrapped = true;
    node._m3ssQuickGenerationWrapped = true;
    return true;
  };
  if (attempt()) return;
  queueMicrotask(attempt);
  setTimeout(attempt, 80);
  setTimeout(attempt, 280);
}

app.registerExtension({
  name: "minimax.music3.semantic.quick-generation-controls",
  nodeCreated(node) {
    if (nodeClass(node) === NODE_ID) wrapOpenWidget(node);
  },
});

if (typeof document !== "undefined") {
  const observer = new MutationObserver(scanDialogs);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scanDialogs();
}
