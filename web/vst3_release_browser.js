import { button, el, input, select, uid } from "./audio_editor_core.js";
import { ensureEffectsStyles } from "./audio_effects.js";
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

const clone = (value) => JSON.parse(JSON.stringify(value));

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
  ensureEffectsStyles();
  const root = el("section", "m3ssv2-vst3-panel m3ssv2-vst3-release");
  root.dataset.m3ssVst3EditorOpen = "0";
  root.dataset.m3ssVst3ChooserOpen = "0";

  const addVst3 = button("+ Add VST3", "m3ssv2-button m3ssv2-fx-add m3ssv2-vst3-add-main");
  addVst3.setAttribute("aria-expanded", "false");

  const utility = el("div", "m3ssv2-vst3-utility");
  const summary = el("div", "m3ssv2-vst3-summary");
  const hostDot = el("span", "m3ssv2-vst3-host-dot");
  const hostText = el("span", "m3ssv2-vst3-host-text", "Checking…");
  const countText = el("span", "m3ssv2-vst3-count", "0 available");
  summary.append(hostDot, hostText, countText);
  const rescan = button("↻", "m3ssv2-button secondary m3ssv2-vst3-rescan");
  rescan.title = "Rescan installed VST3 effects";
  rescan.setAttribute("aria-label", "Rescan installed VST3 effects");
  utility.append(summary, rescan);

  const inlineStatus = el("div", "m3ssv2-vst3-inline-status");
  inlineStatus.hidden = true;

  const rackPane = el("div", "m3ssv2-vst3-pane m3ssv2-vst3-rack-pane");
  const racks = el("div", "m3ssv2-vst3-racks");
  const presetBar = el("div", "m3ssv2-vst3-preset-bar");
  rackPane.append(racks, presetBar);

  const chooserPane = el("div", "m3ssv2-vst3-pane m3ssv2-vst3-chooser-pane");
  chooserPane.hidden = true;
  const chooserHead = el("div", "m3ssv2-vst3-chooser-head");
  const search = input("search", "");
  search.className = "m3ssv2-vst3-search";
  search.placeholder = "Search installed VST3…";
  search.autocomplete = "off";
  const closeChooserButton = button("×", "m3ssv2-button secondary m3ssv2-vst3-icon is-danger");
  closeChooserButton.title = "Close Add VST3";
  closeChooserButton.setAttribute("aria-label", "Close Add VST3");
  chooserHead.append(search, closeChooserButton);
  const list = el("div", "m3ssv2-vst3-list");
  chooserPane.append(chooserHead, list);

  root.append(addVst3, utility, inlineStatus, rackPane, chooserPane);

  let scanning = false;
  let hostReady = false;
  let hostDetail = "";
  let lastPlugins = [];
  let statusTimer = null;
  let selectedRackId = null;
  let currentPresets = [];
  let chooserOpen = false;
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

  function setNativeOpenFlag() {
    root.dataset.m3ssVst3EditorOpen = openingIds.size ? "1" : "0";
    updateAddControl();
  }

  function updateAddControl() {
    const busy = scanning || openingIds.size > 0;
    addVst3.disabled = busy || !context();
    addVst3.setAttribute("aria-expanded", chooserOpen ? "true" : "false");
    root.dataset.m3ssVst3ChooserOpen = chooserOpen ? "1" : "0";
  }

  function vstEffects() {
    const ctx = context();
    return ctx?.project ? pipelineVst3Effects(ctx.project) : [];
  }

  function pluginMatches(plugin) {
    const query = String(search.value || "").trim().toLowerCase();
    if (!query) return true;
    return [plugin.name, plugin.vendor, categoryOf(plugin), plugin.path]
      .some((value) => String(value || "").toLowerCase().includes(query));
  }

  function closeChooser() {
    chooserOpen = false;
    chooserPane.hidden = true;
    rackPane.hidden = false;
    search.value = "";
    updateAddControl();
    renderRack();
    refreshPresets();
  }

  async function openChooser() {
    if (openingIds.size) {
      setStatus("Close the Plugin UI before adding another VST3.", "error", 2600);
      return;
    }
    chooserOpen = true;
    chooserPane.hidden = false;
    rackPane.hidden = true;
    updateAddControl();
    if (!lastPlugins.length && !scanning) await runScan();
    renderChooser();
    queueMicrotask(() => search.focus?.());
  }

  function pluginRow(plugin) {
    const row = el("div", "m3ssv2-vst3-row");
    const main = el("div", "m3ssv2-vst3-main");
    const name = el("strong", "m3ssv2-vst3-name", plugin.name || "Unnamed VST3");
    const meta = el("div", "m3ssv2-vst3-meta", [plugin.vendor, categoryOf(plugin)].filter(Boolean).join(" · "));
    main.title = String(plugin.path || "");
    main.append(name, meta);

    const add = button("Add", "m3ssv2-button secondary m3ssv2-vst3-mini m3ssv2-vst3-add");
    add.disabled = !hostReady || !context();
    add.onclick = () => {
      const ctx = context();
      if (!ctx) return setStatus("Editor context unavailable", "error");
      const effect = createPluginEffect(plugin);
      ctx.commit(() => appendPipelineEffect(ctx.project, effect));
      selectedRackId = effect.id;
      closeChooser();
      setStatus(`${plugin.name || "VST3"} added`, "saved", 2200);
    };
    row.append(main, add);
    return row;
  }

  function renderChooser() {
    list.replaceChildren();
    const filtered = lastPlugins.filter(pluginMatches);
    if (!filtered.length) {
      list.appendChild(el("div", "m3ssv2-vst3-empty", lastPlugins.length ? "No matching VST3 effects" : "No VST3 effects found"));
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
    const effect = selectedRackId ? findPipelineEffect(context()?.project, selectedRackId) : null;
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
    setStatus(`${effectLabel(effect)} · Plugin UI open`, "busy");
    renderRack();
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
    const enabled = effect.enabled !== false;
    const opening = openingIds.has(effect.id);
    const closing = closingIds.has(effect.id);
    const anotherOpen = openingIds.size > 0 && !opening;
    const selected = selectedRackId === effect.id;
    const card = el("article", `m3ssv2-fx-card m3ssv2-vst3-rack-row${enabled ? " is-enabled" : ""}${selected ? " is-selected" : ""}`);
    card.dataset.effectId = effect.id;

    const head = el("div", "m3ssv2-fx-card-head m3ssv2-vst3-rack-card-head");
    const power = button(enabled ? "●" : "○", `m3ssv2-fx-power m3ssv2-vst3-power${enabled ? " is-on" : ""}`);
    power.title = enabled ? "On" : "Bypass";
    power.setAttribute("aria-pressed", enabled ? "true" : "false");
    power.disabled = opening;
    power.onclick = () => {
      const ctx = context();
      if (!ctx) return;
      ctx.commit(() => mutatePipelineEffect(ctx.project, effect.id, (target) => { target.enabled = target.enabled === false; }));
      renderAll();
    };

    const name = button(effectLabel(effect), "m3ssv2-fx-name m3ssv2-vst3-rack-name");
    name.onclick = () => {
      selectedRackId = effect.id;
      renderRack();
      refreshPresets();
    };

    const ui = button(opening ? (closing ? "Closing…" : "Close UI") : "Open UI", `m3ssv2-button secondary m3ssv2-vst3-mini m3ssv2-vst3-open-ui${opening ? " is-active" : ""}`);
    ui.disabled = !hostReady || closing || anotherOpen;
    ui.onclick = () => opening ? onCloseUi(effect) : onOpenUi(effect);

    const up = button("↑", "m3ssv2-fx-icon");
    up.disabled = opening || index === 0;
    up.title = "Move up";
    up.onclick = () => {
      const ctx = context();
      if (!ctx) return;
      ctx.commit(() => movePipelineEffect(ctx.project, effect.id, -1, (item) => String(item?.type || "") === VST3_TYPE));
      renderAll();
    };
    const down = button("↓", "m3ssv2-fx-icon");
    down.disabled = opening || index === effects.length - 1;
    down.title = "Move down";
    down.onclick = () => {
      const ctx = context();
      if (!ctx) return;
      ctx.commit(() => movePipelineEffect(ctx.project, effect.id, 1, (item) => String(item?.type || "") === VST3_TYPE));
      renderAll();
    };
    const remove = button("×", "m3ssv2-fx-icon is-danger");
    remove.disabled = opening;
    remove.title = "Remove VST3";
    remove.onclick = () => {
      const ctx = context();
      if (!ctx) return;
      ctx.commit(() => removePipelineEffect(ctx.project, effect.id));
      if (selectedRackId === effect.id) selectedRackId = null;
      renderAll();
    };

    head.append(power, name, ui, up, down, remove);
    card.appendChild(head);
    const state = opening ? "UI OPEN" : stateLabel(effect);
    card.appendChild(el("div", "m3ssv2-fx-summary m3ssv2-vst3-rack-summary", `${enabled ? "ON" : "BYPASS"} · ${state}`));
    return card;
  }

  function renderRack() {
    racks.replaceChildren();
    const effects = vstEffects();
    if (selectedRackId && !effects.some((effect) => effect.id === selectedRackId)) selectedRackId = null;
    if (!effects.length) {
      racks.appendChild(el("div", "m3ssv2-vst3-rack-empty", "No VST3 effects. Use + Add VST3."));
      presetBar.hidden = true;
    } else {
      if (!selectedRackId) selectedRackId = effects[0].id;
      effects.forEach((effect, index) => racks.appendChild(rackRow(effect, index, effects)));
      renderPresetBar();
    }
  }

  function renderAll() {
    renderRack();
    if (chooserOpen) renderChooser();
    updateAddControl();
  }

  async function runScan() {
    if (scanning) return;
    scanning = true;
    rescan.disabled = true;
    updateAddControl();
    hostText.textContent = "Checking…";
    hostDot.classList.remove("is-ready", "is-error");
    if (chooserOpen) list.replaceChildren(el("div", "m3ssv2-vst3-empty", "Scanning VST3…"));
    try {
      const [result, hostResult] = await Promise.all([scanVst3Plugins(), readVst3HostStatus()]);
      hostReady = !!hostResult?.ready;
      hostDetail = String(hostResult?.message || "");
      hostText.textContent = hostReady ? "Ready" : "Unavailable";
      hostDot.classList.toggle("is-ready", hostReady);
      hostDot.classList.toggle("is-error", !hostReady);
      summary.title = hostDetail;
      lastPlugins = Array.isArray(result.plugins) ? result.plugins : [];
      countText.textContent = `${lastPlugins.length} available`;
      if (chooserOpen) renderChooser();
      if (!hostReady) setStatus(hostDetail || "VST3 host unavailable", "error");
    } catch (error) {
      hostReady = false;
      hostText.textContent = "Error";
      hostDot.classList.add("is-error");
      setStatus(`VST3 scan failed: ${error}`, "error");
      if (chooserOpen) list.replaceChildren(el("div", "m3ssv2-vst3-empty", "VST3 scan failed"));
    } finally {
      scanning = false;
      rescan.disabled = false;
      updateAddControl();
    }
  }

  addVst3.onclick = () => chooserOpen ? closeChooser() : openChooser();
  closeChooserButton.onclick = closeChooser;
  search.oninput = renderChooser;
  rescan.onclick = runScan;

  root.runScan = runScan;
  root.openAddVst3 = openChooser;
  root.closeAddVst3 = closeChooser;
  root.refreshFromProject = () => {
    renderRack();
    refreshPresets();
  };
  root.persistVst3State = () => {
    if (openingIds.size) {
      setStatus("Close Plugin UI before Save Edits", "error");
      return false;
    }
    return true;
  };

  setNativeOpenFlag();
  renderAll();
  return root;
}
