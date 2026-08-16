import { button, clamp, el, numberInput, selectInput, textarea } from "./semantic_studio_core.js";

const STYLE_ID = "m3ss-semantic-controls-style";
const MAX_MENU_ITEMS = 80;
let controlSerial = 0;
const nextId = (prefix) => `${prefix}-${Date.now()}-${++controlSerial}`;
const unique = (values) => {
  const result = [], seen = new Set();
  for (const raw of values || []) {
    const value = String(raw ?? "").trim();
    const key = value.toLowerCase();
    if (!value || seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
};

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./semantic_controls.css", import.meta.url).href;
  document.head.appendChild(link);
}

export function filterPresetOptions(options = [], query = "", limit = MAX_MENU_ITEMS) {
  const values = unique(options);
  const needle = String(query || "").trim().toLowerCase();
  const filtered = needle ? values.filter((value) => value.toLowerCase().includes(needle)) : values;
  return filtered.slice(0, Math.max(1, Number(limit) || MAX_MENU_ITEMS));
}

function attachSuggestionPopup(root, input, options, onChoose) {
  const menu = el("div", "m3ss-combo-menu");
  const menuId = nextId("m3ss-combo-menu");
  menu.id = menuId;
  menu.setAttribute("role", "listbox");
  menu.hidden = true;
  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-controls", menuId);
  input.setAttribute("aria-expanded", "false");
  root.appendChild(menu);

  let open = false;
  let browseAll = false;
  let activeIndex = -1;
  let visible = [];

  function setActive(next) {
    if (!visible.length) {
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
      return;
    }
    activeIndex = ((next % visible.length) + visible.length) % visible.length;
    const items = [...menu.querySelectorAll(".m3ss-combo-option")];
    items.forEach((item, index) => {
      const isActive = index === activeIndex;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-selected", isActive ? "true" : "false");
    });
    const active = items[activeIndex];
    if (active) {
      input.setAttribute("aria-activedescendant", active.id);
      active.scrollIntoView?.({ block: "nearest" });
    }
  }

  function choose(value) {
    input.value = value;
    onChoose?.(value);
    setOpen(false);
    input.focus({ preventScroll: true });
  }

  function renderMenu({ all = browseAll } = {}) {
    browseAll = !!all;
    visible = filterPresetOptions(options, browseAll ? "" : input.value);
    menu.replaceChildren();
    activeIndex = -1;
    input.removeAttribute("aria-activedescendant");
    if (!visible.length) {
      menu.appendChild(el("div", "m3ss-combo-empty", "No preset match — custom text is allowed."));
      return;
    }
    visible.forEach((value, index) => {
      const option = el("div", "m3ss-combo-option", value);
      option.id = `${menuId}-option-${index}`;
      option.setAttribute("role", "option");
      option.setAttribute("aria-selected", "false");
      option.addEventListener("pointerdown", (event) => {
        event.preventDefault();
        choose(value);
      });
      option.addEventListener("pointermove", () => setActive(index));
      menu.appendChild(option);
    });
  }

  function setOpen(next, { all = false } = {}) {
    open = !!next;
    if (open) {
      browseAll = !!all;
      renderMenu({ all: browseAll });
    }
    menu.hidden = !open;
    input.setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) {
      browseAll = false;
      activeIndex = -1;
      input.removeAttribute("aria-activedescendant");
    }
  }

  input.addEventListener("focus", () => {
    if (!open) setOpen(true, { all: false });
  });
  input.addEventListener("input", () => {
    browseAll = false;
    if (!open) open = true;
    renderMenu({ all: false });
    menu.hidden = false;
    input.setAttribute("aria-expanded", "true");
  });
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      if (!open) setOpen(true, { all: false });
      setActive(activeIndex + 1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) setOpen(true, { all: false });
      setActive(activeIndex < 0 ? visible.length - 1 : activeIndex - 1);
    } else if (event.key === "Enter" && open && activeIndex >= 0) {
      event.preventDefault();
      choose(visible[activeIndex]);
    } else if (event.key === "Enter" && open) {
      setOpen(false);
    } else if (event.key === "Escape" && open) {
      event.preventDefault();
      setOpen(false);
    }
  });
  root.addEventListener("focusout", () => {
    setTimeout(() => {
      if (!root.contains(document.activeElement)) setOpen(false);
    }, 0);
  });

  return {
    menu,
    isOpen: () => open,
    setOpen,
    refresh: () => renderMenu({ all: browseAll }),
  };
}

export function editableCombo({ value = "", options = [], placeholder = "", onInput = null, ariaLabel = "" } = {}) {
  ensureStyles();
  const root = el("div", "m3ss-editable-combo");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "m3ss-combo-input";
  input.value = value ?? "";
  input.placeholder = placeholder;
  if (ariaLabel) input.setAttribute("aria-label", ariaLabel);
  input.addEventListener("input", () => onInput?.(input.value));

  const toggle = button("▾", "m3ss-combo-toggle");
  toggle.title = "Show all presets";
  toggle.setAttribute("aria-label", "Show all presets");
  toggle.addEventListener("pointerdown", (event) => event.preventDefault());

  root.append(input, toggle);
  const popup = attachSuggestionPopup(root, input, options, (next) => onInput?.(next));
  toggle.onclick = () => {
    const next = !popup.isOpen();
    popup.setOpen(next, { all: true });
    if (next) input.focus({ preventScroll: true });
  };

  root.input = input;
  root.popup = popup;
  Object.defineProperty(root, "value", { get: () => input.value, set: (next) => { input.value = next ?? ""; popup.refresh(); } });
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
  const addButton = button("Add", "m3ss-chip-add");
  let state = unique(values).slice(0, maxItems);

  function emit() { onChange?.([...state]); }
  function removeAt(index) { state.splice(index, 1); render(); emit(); }
  function add(raw) {
    const candidate = String(raw || "").trim().replace(/,$/, "").trim();
    if (!candidate) return false;
    if (state.some((item) => item.toLowerCase() === candidate.toLowerCase())) { input.value = ""; popup.refresh(); return false; }
    if (state.length >= maxItems) return false;
    state.push(candidate);
    input.value = "";
    render();
    emit();
    popup.refresh();
    return true;
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

  entry.append(input, addButton);
  const popup = attachSuggestionPopup(entry, input, suggestions, (next) => add(next));
  addButton.onclick = () => add(input.value);
  input.addEventListener("keydown", (event) => {
    if (event.key === ",") {
      event.preventDefault();
      add(input.value);
    } else if (event.key === "Enter" && !popup.isOpen()) {
      event.preventDefault();
      add(input.value);
    }
  });
  input.addEventListener("change", () => add(input.value));
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
