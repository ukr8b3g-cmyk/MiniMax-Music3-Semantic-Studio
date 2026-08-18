import { button, el, input, select, uid } from "./audio_editor_core.js";
import {
  closeVst3NativeEditor, openVst3NativeEditor, readVst3HostStatus, scanVst3Plugins,
} from "./vst3_browser.js";
import {
  VST3_TYPE, appendPipelineEffect, findPipelineEffect, movePipelineEffect,
  mutatePipelineEffect, pipelineVst3Effects, removePipelineEffect,
} from "./audio_single_pipeline.js";
import {
  deleteVst3Preset, listVst3Presets, saveVst3Preset, vst3PluginKey,
} from "./vst3_preset_store.js";

const FAVORITES_KEY = "m3ss-vst3:favorites-v1";
const RECENT_KEY = "m3ss-vst3:recent-v1";
const MAX_RECENT = 16;
const clone = (value) => JSON.parse(JSON.stringify(value));

function readJsonStorage(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null");
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function writeJsonStorage(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch {}
}

function pluginKey(plugin) {
  return vst3PluginKey(plugin?.path, plugin?.name || plugin?.plugin_name);
}

function effectPluginKey(effect) {
  const params = effect?.params || {};
  return vst3PluginKey(params.path, params.plugin_name || params.name);
}

function categoryOf(plugin) {
  const explicit = String(plugin?.category || "").trim();
  if (explicit) return explicit;
  const text = `${plugin?.name || ""} ${plugin?.vendor || ""}`.toLowerCase();
  if (/compress|limiter|gate|de[- ]?ess|master/.test(text)) return "Dynamics";
  if (/chorus|flanger|phaser|modulat/.test(text)) return "Modulation";
  if (/delay|echo|reverb|room|space/.test(text)) return "Space";
  if (/pitch|harmoni|tune/.test(text)) return "Pitch";
  if (/\beq\b|filter/.test(text)) return "EQ / Filter";
  return "Other";
}

function createPluginEffect(plugin) {
  return {
    id: uid("vst3"),
    type: VST3_TYPE,
    enabled: true,
    params: {
      path: String(plugin.path || ""),
      plugin_name: String(plugin.name || ""),
      name: String(plugin.name || "Unnamed VST3"),
      vendor: String(plugin.vendor || ""),
      category: categoryOf(plugin),
      phase: "2D",
    },
  };
}

function effectLabel(effect) {
  return String(effect?.params?.name || effect?.params?.plugin_name || "VST3");
}

function stateLabel(effect) {
  return effect?.params?.state_b64 ? "Saved" : "Default";
}

function presetRecordFromEffect(effect, name) {
  const params = effect?.params || {};
  return {
    plugin_key: effectPluginKey(effect),
    name,
    path: String(params.path || ""),
    plugin_name: String(params.plugin_name || params.name || ""),
    vendor: String(params.vendor || params.manufacturer || ""),
    state_kind: String(params.state_kind || "preset_data"),
    state_b64: String(params.state_b64 || ""),
    state_bytes: Number(params.state_bytes) || 0,
    plugin_identifier: String(params.plugin_identifier || ""),
    plugin_version: String(params.plugin_version || ""),
    manufacturer: String(params.manufacturer || ""),
  };
}

export function createVst3ReleasePanel({ contextProvider = null } = {}) {
  const root = el("section", "m3ssv2-vst3-panel m3ssv2-vst3-release");
  root.dataset.m3ssVst3View = "plugins";
  root.dataset.m3ssVst3EditorOpen = "0";

  const head = el("div", "m3ssv2-vst3-head");
  const viewTabs = el("div", "m3ssv2-vst3-view-tabs");
  const pluginsTab = button("Plugins", "m3ssv2-vst3-view-tab is-active");
  const rackTab = button("Rack", "m3ssv2-vst3-view-tab");
  pluginsTab.setAttribute("role", "tab");
  rackTab.setAttribute("role", "tab");
  pluginsTab.setAttribute("aria-selected", "true");
  rackTab.setAttribute("aria-selected", "false");
  viewTabs.append(pluginsTab, rackTab);

  const summary = el("div", "m3ssv2-vst3-summary");
  const hostDot = el("span", "m3ssv2-vst3-host-dot");
  const hostText = el("span", "m3ssv2-vst3-host-text", "Checking…");
  const countText = el("span", "m3ssv2-vst3-count", "0 plugins");
  summary.append(hostDot, hostText, countText);
  const rescan = button("Rescan", "m3ssv2-button secondary m3ssv2-vst3-rescan");
  head.append(viewTabs, summary, rescan);

  const filters = el("div", "m3ssv2-vst3-filters");
  const search = input("search", "");
  search.className = "m3ssv2-vst3-search";
  search.placeholder = "Search VST3…";
  search.autocomplete = "off";
  const scope = select([
    { value: "all", label: "All" },
    { value: "favorites", label: "Favorites" },
    { value: "recent", label: "Recent" },
  ], "all");
  scope.className = "m3ssv2-vst3-filter";
  const vendor = select([{ value: "", label: "All Vendors" }], "");
  vendor.className = "m3ssv2-vst3-filter";
  const category = select([{ value: "", label: "All Categories" }], "");
  category.className = "m3ssv2-vst3-filter";
  filters.append(search, scope, vendor, category);

  const inlineStatus = el("div", "m3ssv2-vst3-inline-status");
  inlineStatus.hidden = true;

  const pluginsPane = el("div", "m3ssv2-vst3-pane m3ssv2-vst3-plugins-pane");
  const list = el("div", "m3ssv2-vst3-list");
  pluginsPane.appendChild(list);

  const rackPane = el("div", "m3ssv2-vst3-pane m3ssv2-vst3-rack-pane");
  rackPane.hidden = true;
  const racks = el("div", "m3ssv2-vst3-racks");
  const presetBar = el("div", "m3ssv2-vst3-preset-bar");
  rackPane.append(racks, presetBar);

  root.append(head, filters, inlineStatus, pluginsPane, rackPane);

  let scanning = false;
  let hostReady = false;
  let hostDetail = "";
  let lastPlugins = [];
  let statusTimer = null;
  let selectedRackId = null;
  let currentPresets = [];
  let favorites = new Set((readJsonStorage(FAVORITES_KEY, []) || []).map(String));
  let recent = (readJsonStorage(RECENT_KEY, []) || []).map(String).slice(0, MAX_RECENT);
  const openingIds = new Set();
  const closingIds = new Set();
  const forcedCloseIds = new Set();

  const context = () => {
    const value = typeof contextProvider === "function" ? contextProvider() : null;
    return value?.project && typeof value.commit === "function" ? value : null;
  };

  function setStatus(text = "", kind = "", timeout = 0) {
    clearTimeout(statusTimer);
    inlineStatus.textContent = text;
    inlineStatus.hidden = !text;
    inlineStatus.className = `m3ssv2-vst3-inline-status${kind ? ` is-${kind}` : ""}`;
    if (text && timeout > 0) statusTimer = setTimeout(() => setStatus(), timeout);
  }

  function recordRecent(key) {
    recent = [key, ...recent.filter((item) => item !== key)].slice(0, MAX_RECENT);
    writeJsonStorage(RECENT_KEY, recent);
  }

  function toggleFavorite(key) {
    if (favorites.has(key)) favorites.delete(key);
    else favorites.add(key);
    writeJsonStorage(FAVORITES_KEY, [...favorites]);
    renderPlugins();
  }

  function setNativeOpenFlag() {
    root.dataset.m3ssVst3EditorOpen = openingIds.size ? "1" : "0";
  }

  function vstEffects() {
    return context()?.project ? pipelineVst3Effects(context().project) : [];
  }

  function updateRackTab() {
    const count = vstEffects().length;
    rackTab.textContent = count ? `Rack ${count}` : "Rack";
  }

  function rebuildFilterOptions() {
    const vendors = [...new Set(lastPlugins.map((plugin) => String(plugin.vendor || "").trim()).filter(Boolean))]
      .sort((a, b) => a.localeCompare(b));
    const categories = [...new Set(lastPlugins.map(categoryOf))].sort((a, b) => a.localeCompare(b));
    const currentVendor = vendor.value;
    const currentCategory = category.value;
    vendor.replaceChildren();
    category.replaceChildren();
    for (const item of [{ value: "", label: "All Vendors" }, ...vendors.map((value) => ({ value, label: value }))]) {
      const option = document.createElement("option"); option.value = item.value; option.textContent = item.label; vendor.appendChild(option);
    }
    for (const item of [{ value: "", label: "All Categories" }, ...categories.map((value) => ({ value, label: value }))]) {
      const option = document.createElement("option"); option.value = item.value; option.textContent = item.label; category.appendChild(option);
    }
    if ([...vendor.options].some((option) => option.value === currentVendor)) vendor.value = currentVendor;
    if ([...category.options].some((option) => option.value === currentCategory)) category.value = currentCategory;
  }

  function pluginMatches(plugin) {
    const key = pluginKey(plugin);
    if (scope.value === "favorites" && !favorites.has(key)) return false;
    if (scope.value === "recent" && !recent.includes(key)) return false;
    if (vendor.value && String(plugin.vendor || "") !== vendor.value) return false;
    if (category.value && categoryOf(plugin) !== category.value) return false;
    const query = String(search.value || "").trim().toLowerCase();
    if (!query) return true;
    return [plugin.name, plugin.vendor, categoryOf(plugin), plugin.path]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }

  function pluginRow(plugin) {
    const row = el("div", "m3ssv2-vst3-row");
    const key = pluginKey(plugin);
    const star = button(favorites.has(key) ? "★" : "☆", "m3ssv2-vst3-favorite");
    star.title = favorites.has(key) ? "Remove from Favorites" : "Add to Favorites";
    star.setAttribute("aria-pressed", favorites.has(key) ? "true" : "false");
    star.onclick = () => toggleFavorite(key);

    const main = el("div", "m3ssv2-vst3-main");
    const name = el("strong", "m3ssv2-vst3-name", plugin.name || "Unnamed VST3");
    const meta = el("div", "m3ssv2-vst3-meta", [plugin.vendor, categoryOf(plugin)].filter(Boolean).join(" · "));
    main.title = String(plugin.path || "");
    main.append(name, meta);

    const add = button("+ Add", "m3ssv2-button secondary m3ssv2-vst3-mini m3ssv2-vst3-add");
    add.disabled = !hostReady || !context();
    add.onclick = () => {
      const ctx = context();
      if (!ctx) return setStatus("Editor context unavailable", "error");
      const effect = createPluginEffect(plugin);
      ctx.commit(() => appendPipelineEffect(ctx.project, effect));
      recordRecent(key);
      selectedRackId = effect.id;
      renderAll();
      setStatus(`${plugin.name || "VST3"} added`, "saved", 1800);
    };
    row.append(star, main, add);
    return row;
  }

  function renderPlugins() {
    list.replaceChildren();
    const filtered = lastPlugins.filter(pluginMatches);
    if (!filtered.length) {
      list.appendChild(el("div", "m3ssv2-vst3-empty", lastPlugins.length ? "No matching VST3 plugins" : "No VST3 effects found"));
      return;
    }
    for (const plugin of filtered) list.appendChild(pluginRow(plugin));
  }

  async function refreshPresets() {
    const effect = selectedRackId ? findPipelineEffect(context()?.project, selectedRackId) : null;
    if (!effect || String(effect.type || "") !== VST3_TYPE) {
      currentPresets = [];
      renderPresetBar();
      return;
    }
    try {
      currentPresets = await listVst3Presets(effectPluginKey(effect));
    } catch (error) {
      currentPresets = [];
      setStatus(`Preset library unavailable: ${error}`, "error");
    }
    renderPresetBar();
  }

  function renderPresetBar() {
    presetBar.replaceChildren();
    const ctx = context();
    const effect = selectedRackId ? findPipelineEffect(ctx?.project, selectedRackId) : null;
    if (!effect || String(effect.type || "") !== VST3_TYPE) {
      presetBar.hidden = true;
      return;
    }
    presetBar.hidden = false;
    const title = el("strong", "m3ssv2-vst3-preset-title", effectLabel(effect));
    const presetSelect = select([
      { value: "", label: "Preset…" },
      ...currentPresets.map((preset) => ({ value: preset.id, label: preset.name })),
    ], "");
    presetSelect.className = "m3ssv2-vst3-preset-select";
    const load = button("Load", "m3ssv2-button secondary m3ssv2-vst3-mini");
    const save = button("Save", "m3ssv2-button secondary m3ssv2-vst3-mini");
    const remove = button("×", "m3ssv2-button secondary m3ssv2-vst3-icon is-danger");
    const reset = button("Default", "m3ssv2-button secondary m3ssv2-vst3-mini");
    load.disabled = true;
    remove.disabled = true;
    save.disabled = !effect.params?.state_b64;
    reset.disabled = !effect.params?.state_b64;
    presetSelect.onchange = () => {
      load.disabled = !presetSelect.value;
      remove.disabled = !presetSelect.value;
    };
    load.onclick = () => {
      const preset = currentPresets.find((item) => item.id === presetSelect.value);
      const latest = context();
      if (!preset || !latest) return;
      latest.commit(() => mutatePipelineEffect(latest.project, effect.id, (target) => {
        target.params ||= {};
        for (const key of ["state_kind", "state_b64", "state_bytes", "plugin_identifier", "plugin_version", "manufacturer"]) {
          if (preset[key] !== undefined) target.params[key] = clone(preset[key]);
        }
        target.params.phase = "2D";
      }));
      renderAll();
      setStatus(`${preset.name} loaded`, "saved", 2200);
    };
    save.onclick = async () => {
      const latest = findPipelineEffect(context()?.project, effect.id);
      if (!latest?.params?.state_b64) return setStatus("Open the Plugin UI and capture state before saving a preset", "error");
      const name = String(prompt("Preset name", `${effectLabel(latest)} Preset`) || "").trim();
      if (!name) return;
      try {
        await saveVst3Preset(presetRecordFromEffect(latest, name));
        await refreshPresets();
        setStatus(`${name} saved`, "saved", 2200);
      } catch (error) {
        setStatus(`Preset save failed: ${error}`, "error");
      }
    };
    remove.onclick = async () => {
      const preset = currentPresets.find((item) => item.id === presetSelect.value);
      if (!preset || !confirm(`Delete preset “${preset.name}”?`)) return;
      try {
        await deleteVst3Preset(preset.id);
        await refreshPresets();
        setStatus("Preset deleted", "saved", 1800);
      } catch (error) {
        setStatus(`Preset delete failed: ${error}`, "error");
      }
    };
    reset.onclick = () => {
      const latest = context();
      if (!latest) return;
      latest.commit(() => mutatePipelineEffect(latest.project, effect.id, (target) => {
        target.params ||= {};
        for (const key of ["state_kind", "state_b64", "state_bytes", "plugin_identifier", "plugin_version", "manufacturer"]) delete target.params[key];
        target.params.phase = "2D";
      }));
      renderAll();
      setStatus("Default plugin state restored", "saved", 2200);
    };
    presetBar.append(title, presetSelect, load, save, remove, reset);
  }

  async function onCloseUi(effect) {
    if (!openingIds.has(effect.id) || closingIds.has(effect.id)) return;
    closingIds.add(effect.id);
    setStatus(`Closing ${effectLabel(effect)}…`, "busy");
    renderRack();
    try {
      const result = await closeVst3NativeEditor();
      if (result?.forced) {
        forcedCloseIds.add(effect.id);
        setStatus("Plugin UI force-closed. Latest state may not have been captured.", "error");
      } else {
        setStatus("Closing Plugin UI…", "busy");
      }
    } catch (error) {
      closingIds.delete(effect.id);
      setStatus(`Close UI failed: ${error}`, "error");
    } finally {
      renderRack();
    }
  }

  async function onOpenUi(effect) {
    if (!hostReady || openingIds.size || openingIds.has(effect.id)) return;
    openingIds.add(effect.id);
    setNativeOpenFlag();
    setStatus(`${effectLabel(effect)} · Native UI open`, "busy");
    renderRack();
    recordRecent(effectPluginKey(effect));
    try {
      const result = await openVst3NativeEditor(effect);
      const ctx = context();
      if (!ctx) throw new Error("Editor context unavailable after Plugin UI close.");
      ctx.commit(() => mutatePipelineEffect(ctx.project, effect.id, (target) => {
        target.params ||= {};
        target.params.state_kind = result.state_kind || "preset_data";
        target.params.state_b64 = result.state_b64 || "";
        target.params.state_bytes = Number(result.state_bytes) || 0;
        target.params.plugin_identifier = result.plugin_identifier || target.params.plugin_identifier || "";
        target.params.plugin_version = result.plugin_version || "";
        target.params.manufacturer = result.manufacturer || target.params.vendor || "";
        target.params.phase = "2D";
      }));
      setStatus(`${effectLabel(effect)} · State captured`, "saved", 3500);
    } catch (error) {
      if (forcedCloseIds.has(effect.id)) setStatus("Plugin UI force-closed. Latest state was not captured.", "error");
      else setStatus(`Plugin UI failed: ${error}`, "error");
    } finally {
      openingIds.delete(effect.id);
      closingIds.delete(effect.id);
      forcedCloseIds.delete(effect.id);
      setNativeOpenFlag();
      renderAll();
      await refreshPresets();
    }
  }

  function rackRow(effect, index, effects) {
    const opening = openingIds.has(effect.id);
    const closing = closingIds.has(effect.id);
    const anotherOpen = openingIds.size > 0 && !opening;
    const selected = selectedRackId === effect.id;
    const row = el("div", `m3ssv2-vst3-rack-row${effect.enabled === false ? " is-bypassed" : ""}${selected ? " is-selected" : ""}`);
    row.onclick = (event) => {
      if (event.target.closest?.("button,select,input")) return;
      selectedRackId = effect.id;
      renderRack();
      refreshPresets();
    };
    const main = el("div", "m3ssv2-vst3-main");
    main.append(
      el("strong", "m3ssv2-vst3-name", effectLabel(effect)),
      el("div", "m3ssv2-vst3-meta", `${effect.enabled === false ? "BYPASS" : "ON"} · ${stateLabel(effect)}`),
    );
    const ui = button(opening ? (closing ? "Closing…" : "Close UI") : "Open UI", `m3ssv2-button secondary m3ssv2-vst3-mini m3ssv2-vst3-open-ui${opening ? " is-active" : ""}`);
    ui.disabled = !hostReady || closing || anotherOpen;
    ui.onclick = () => opening ? onCloseUi(effect) : onOpenUi(effect);
    const power = button(effect.enabled === false ? "Enable" : "Bypass", "m3ssv2-button secondary m3ssv2-vst3-mini");
    power.setAttribute("aria-pressed", effect.enabled === false ? "false" : "true");
    power.onclick = () => {
      const ctx = context();
      if (!ctx) return;
      ctx.commit(() => mutatePipelineEffect(ctx.project, effect.id, (target) => { target.enabled = target.enabled === false; }));
      renderAll();
    };
    const up = button("↑", "m3ssv2-button secondary m3ssv2-vst3-icon");
    up.disabled = index === 0;
    up.onclick = () => {
      const ctx = context(); if (!ctx) return;
      ctx.commit(() => movePipelineEffect(ctx.project, effect.id, -1, (item) => String(item?.type || "") === VST3_TYPE));
      renderAll();
    };
    const down = button("↓", "m3ssv2-button secondary m3ssv2-vst3-icon");
    down.disabled = index === effects.length - 1;
    down.onclick = () => {
      const ctx = context(); if (!ctx) return;
      ctx.commit(() => movePipelineEffect(ctx.project, effect.id, 1, (item) => String(item?.type || "") === VST3_TYPE));
      renderAll();
    };
    const remove = button("×", "m3ssv2-button secondary m3ssv2-vst3-icon is-danger");
    remove.disabled = opening;
    remove.title = "Remove VST3";
    remove.onclick = () => {
      const ctx = context(); if (!ctx) return;
      ctx.commit(() => removePipelineEffect(ctx.project, effect.id));
      if (selectedRackId === effect.id) selectedRackId = null;
      renderAll();
    };
    const actions = el("div", "m3ssv2-vst3-rack-actions");
    actions.append(ui, power, up, down, remove);
    row.append(main, actions);
    return row;
  }

  function renderRack() {
    racks.replaceChildren();
    const effects = vstEffects();
    if (selectedRackId && !effects.some((effect) => effect.id === selectedRackId)) selectedRackId = null;
    if (!effects.length) {
      racks.appendChild(el("div", "m3ssv2-vst3-rack-empty", "No VST3 effects"));
    } else {
      effects.forEach((effect, index) => racks.appendChild(rackRow(effect, index, effects)));
    }
    updateRackTab();
    if (!selectedRackId && effects.length) selectedRackId = effects[0].id;
    renderPresetBar();
  }

  function renderAll() {
    renderPlugins();
    renderRack();
  }

  function setView(view) {
    const next = view === "rack" ? "rack" : "plugins";
    root.dataset.m3ssVst3View = next;
    const pluginsActive = next === "plugins";
    pluginsTab.classList.toggle("is-active", pluginsActive);
    rackTab.classList.toggle("is-active", !pluginsActive);
    pluginsTab.setAttribute("aria-selected", pluginsActive ? "true" : "false");
    rackTab.setAttribute("aria-selected", pluginsActive ? "false" : "true");
    pluginsPane.hidden = !pluginsActive;
    filters.hidden = !pluginsActive;
    rackPane.hidden = pluginsActive;
    if (pluginsActive) queueMicrotask(() => search.focus?.());
    else refreshPresets();
  }

  async function runScan() {
    if (scanning) return;
    scanning = true;
    rescan.disabled = true;
    hostText.textContent = "Checking…";
    hostDot.classList.remove("is-ready", "is-error");
    list.replaceChildren(el("div", "m3ssv2-vst3-empty", "Scanning VST3…"));
    try {
      const [result, hostResult] = await Promise.all([scanVst3Plugins(), readVst3HostStatus()]);
      hostReady = !!hostResult?.ready;
      hostDetail = String(hostResult?.message || "");
      hostText.textContent = hostReady ? "Ready" : "Unavailable";
      hostDot.classList.toggle("is-ready", hostReady);
      hostDot.classList.toggle("is-error", !hostReady);
      summary.title = hostDetail;
      lastPlugins = Array.isArray(result.plugins) ? result.plugins : [];
      countText.textContent = `${lastPlugins.length} plugin${lastPlugins.length === 1 ? "" : "s"}`;
      rebuildFilterOptions();
      renderAll();
      if (!hostReady) setStatus(hostDetail || "VST3 host unavailable", "error");
    } catch (error) {
      hostReady = false;
      hostText.textContent = "Error";
      hostDot.classList.add("is-error");
      setStatus(`VST3 scan failed: ${error}`, "error");
      list.replaceChildren(el("div", "m3ssv2-vst3-empty", "VST3 scan failed"));
    } finally {
      scanning = false;
      rescan.disabled = false;
    }
  }

  pluginsTab.onclick = () => setView("plugins");
  rackTab.onclick = () => setView("rack");
  search.oninput = renderPlugins;
  scope.onchange = renderPlugins;
  vendor.onchange = renderPlugins;
  category.onchange = renderPlugins;
  rescan.onclick = runScan;
  root.runScan = runScan;
  root.setVst3View = setView;
  root.refreshFromProject = () => { renderRack(); refreshPresets(); };
  root.persistVst3State = () => {
    if (openingIds.size) {
      setStatus("Close Plugin UI before Save Edits", "error");
      return false;
    }
    return true;
  };

  setNativeOpenFlag();
  renderAll();
  setView("plugins");
  return root;
}
