import { button, clamp, el, numberInput, selectInput, textarea } from "./semantic_studio_core.js";

const STYLE_ID = "m3ss-semantic-controls-style";
let controlSerial = 0;
const nextId = (prefix) => `${prefix}-${Date.now()}-${++controlSerial}`;
const unique = (values) => [...new Map((values || []).filter(Boolean).map((value) => [String(value).trim().toLowerCase(), String(value).trim()])).values()];

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./semantic_controls.css", import.meta.url).href;
  document.head.appendChild(link);
}

export function editableCombo({ value = "", options = [], placeholder = "", onInput = null, ariaLabel = "" } = {}) {
  ensureStyles();
  const root = el("div", "m3ss-editable-combo");
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.placeholder = placeholder;
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);

  const list = document.createElement("datalist");
  list.id = nextId("m3ss-options");
  input.setAttribute("list", list.id);
  for (const optionValue of unique(options)) {
    const option = document.createElement("option");
    option.value = optionValue;
    list.appendChild(option);
  }
  input.addEventListener("input", () => onInput?.(input.value));
  root.append(input, list);
  root.input = input;
  Object.defineProperty(root, "value", { get: () => input.value, set: (next) => { input.value = next ?? ""; } });
  return root;
}

export function chipEditor({ values = [], suggestions = [], placeholder = "Type or choose…", onChange = null, maxItems = 24 } = {}) {
  ensureStyles();
  const root = el("div", "m3ss-chip-editor");
  const chips = el("div", "m3ss-chip-list");
  const entry = el("div", "m3ss-chip-entry");
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = placeholder;
  const list = document.createElement("datalist");
  list.id = nextId("m3ss-chip-options");
  input.setAttribute("list", list.id);
  for (const optionValue of unique(suggestions)) {
    const option = document.createElement("option");
    option.value = optionValue;
    list.appendChild(option);
  }
  const addButton = button("Add", "m3ss-chip-add");
  let state = unique(values).slice(0, maxItems);

  function emit() { onChange?.([...state]); }
  function removeAt(index) { state.splice(index, 1); render(); emit(); }
  function add(raw) {
    const candidate = String(raw || "").trim().replace(/,$/, "").trim();
    if (!candidate) return false;
    if (state.some((item) => item.toLowerCase() === candidate.toLowerCase())) { input.value = ""; return false; }
    if (state.length >= maxItems) return false;
    state.push(candidate); input.value = ""; render(); emit(); return true;
  }
  function render() {
    chips.replaceChildren();
    for (let index = 0; index < state.length; index++) {
      const item = el("span", "m3ss-chip");
      item.appendChild(el("span", "m3ss-chip-text", state[index]));
      const remove = button("×", "m3ss-chip-remove");
      remove.title = `Remove ${state[index]}`;
      remove.setAttribute("aria-label", `Remove ${state[index]}`);
      remove.onclick = () => removeAt(index);
      item.appendChild(remove);
      chips.appendChild(item);
    }
  }

  addButton.onclick = () => add(input.value);
  input.addEventListener("keydown", (event) => {
    if (event.key === "Enter" || event.key === ",") {
      event.preventDefault(); add(input.value);
    }
  });
  input.addEventListener("change", () => add(input.value));
  entry.append(input, list, addButton);
  root.append(chips, entry);
  root.getValues = () => [...state];
  root.setValues = (next) => { state = unique(next).slice(0, maxItems); render(); };
  render();
  return root;
}

export function textareaWithSuggestions({ value = "", placeholder = "", rows = 5, suggestions = [], onInput = null } = {}) {
  ensureStyles();
  const root = el("div", "m3ss-textarea-suggest");
  const area = textarea(value, placeholder, rows);
  const strip = el("div", "m3ss-suggestion-strip");
  area.addEventListener("input", () => onInput?.(area.value));

  for (const suggestion of unique(suggestions)) {
    const chip = button(suggestion, "m3ss-suggestion-chip");
    chip.type = "button";
    chip.onclick = () => {
      const current = area.value.trim();
      if (current.toLowerCase().includes(suggestion.toLowerCase())) return;
      const fragment = suggestion.replace(/[.\s]+$/, "");
      area.value = current ? `${current.replace(/[.\s]+$/, "")}. ${fragment}.` : `${fragment}.`;
      area.dispatchEvent(new Event("input", { bubbles: true }));
      area.focus();
    };
    strip.appendChild(chip);
  }
  root.append(area, strip);
  root.textarea = area;
  Object.defineProperty(root, "value", { get: () => area.value, set: (next) => { area.value = next ?? ""; } });
  return root;
}

export function bpmControl({ value = 120, presets = [], onChange = null } = {}) {
  ensureStyles();
  const root = el("div", "m3ss-bpm-control");
  const number = numberInput(value, 20, 400, 1);
  const preset = selectInput([{ value: "", label: "Feel preset…" }, ...presets.map((item) => ({ value: String(item.value), label: item.label }))], "");
  number.addEventListener("input", () => onChange?.(clamp(number.value, 20, 400)));
  preset.addEventListener("change", () => {
    if (!preset.value) return;
    number.value = preset.value;
    onChange?.(clamp(number.value, 20, 400));
    number.focus();
  });
  root.append(number, preset);
  root.number = number;
  return root;
}
