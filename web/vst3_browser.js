import { api } from "../../scripts/api.js";
import { el, button, input } from "./audio_editor_core.js";
import { getNodeWidget } from "./node_compact.js";

const VST3_TYPE = "vst3";
const clone = (value) => JSON.parse(JSON.stringify(value));

export async function scanVst3Plugins() {
  const response = await api.fetchApi("/m3ss/vst3/scan");
  if (!response.ok) throw new Error(`VST3 scan failed: HTTP ${response.status}`);
  return await response.json();
}

export async function readVst3HostStatus() {
  const response = await api.fetchApi("/m3ss/vst3/host-status");
  if (!response.ok) throw new Error(`VST3 host status failed: HTTP ${response.status}`);
  return await response.json();
}

export async function openVst3NativeEditor(effect) {
  const params = effect?.params && typeof effect.params === "object" ? effect.params : {};
  const response = await api.fetchApi("/m3ss/vst3/open-editor", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      path: params.path || "",
      plugin_name: params.plugin_name || params.name || "",
      state_kind: params.state_kind || "preset_data",
      state_b64: params.state_b64 || "",
      plugin_identifier: params.plugin_identifier || "",
    }),
  });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || `Native VST3 editor failed: HTTP ${response.status}`);
  }
  return result;
}

export async function closeVst3NativeEditor() {
  const response = await api.fetchApi("/m3ss/vst3/close-editor", { method: "POST" });
  let result = null;
  try { result = await response.json(); } catch {}
  if (!response.ok || !result?.ok) {
    throw new Error(result?.error || `Close VST3 editor failed: HTTP ${response.status}`);
  }
  return result;
}

function makeId() {
  return `vst3-${globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`}`;
}

function pluginEffect(plugin) {
  return {
    id: makeId(),
    type: VST3_TYPE,
    enabled: true,
    params: {
      path: String(plugin.path || ""),
      plugin_name: String(plugin.name || ""),
      name: String(plugin.name || "Unnamed VST3"),
      vendor: String(plugin.vendor || ""),
      phase: "2B",
    },
  };
}

function readProject(node) {
  const widget = getNodeWidget(node, "edit_json");
  if (!widget) return { widget: null, project: null };
  try {
    const project = JSON.parse(widget.value || "{}");
    return { widget, project: project && typeof project === "object" ? project : null };
  } catch {
    return { widget, project: null };
  }
}

function vstEffects(items) {
  return (Array.isArray(items) ? items : [])
    .filter((effect) => effect && typeof effect === "object" && String(effect.type || "") === VST3_TYPE)
    .map((effect) => clone(effect));
}

function initialRackState(node) {
  const { project } = readProject(node);
  return {
    track: vstEffects(project?.tracks?.[0]?.effects),
    master: vstEffects(project?.master?.effects),
  };
}

function mergeVstEffects(existing, vst) {
  const builtins = (Array.isArray(existing) ? existing : []).filter((effect) => String(effect?.type || "") !== VST3_TYPE);
  return [...builtins, ...vst.map((effect) => clone(effect))];
}

function persistRackState(node, state) {
  const { widget, project } = readProject(node);
  if (!widget || !project) return false;
  if (!Array.isArray(project.tracks) || !project.tracks[0]) return false;
  project.tracks[0].effects = mergeVstEffects(project.tracks[0].effects, state.track);
  project.master ||= {};
  project.master.effects = mergeVstEffects(project.master.effects, state.master);
  const text = JSON.stringify(project);
  widget.value = text;
  widget.callback?.(text);
  node?.setDirtyCanvas?.(true, true);
  return true;
}

function effectLabel(effect) {
  return String(effect?.params?.name || effect?.params?.plugin_name || "VST3");
}

function stateLabel(effect) {
  return effect?.params?.state_b64 ? "Saved" : "Default";
}

function rackSection(title, owner, state, options) {
  const {
    markDirty, rerender, hostReady, openingIds, closingIds, onOpenUi, onCloseUi,
  } = options;
  const section = el("section", "m3ssv2-vst3-rack-section");
  const effects = state[owner];
  const titleRow = el("div", "m3ssv2-vst3-rack-title-row");
  titleRow.append(
    el("strong", "m3ssv2-vst3-rack-title", title),
    el("span", "m3ssv2-vst3-rack-count", String(effects.length)),
  );
  section.appendChild(titleRow);
  if (!effects.length) {
    section.appendChild(el("div", "m3ssv2-vst3-rack-empty", "No VST3 effects"));
    return section;
  }

  effects.forEach((effect, index) => {
    const opening = openingIds.has(effect.id);
    const closing = closingIds.has(effect.id);
    const anotherOpen = openingIds.size > 0 && !opening;
    const row = el("div", `m3ssv2-vst3-rack-row${effect.enabled === false ? " is-bypassed" : ""}${opening ? " is-selected" : ""}`);
    const main = el("div", "m3ssv2-vst3-main");
    const meta = `${effect.enabled === false ? "BYPASS" : "ON"} · ${stateLabel(effect)}`;
    main.append(
      el("strong", "m3ssv2-vst3-name", effectLabel(effect)),
      el("div", "m3ssv2-vst3-meta", meta),
    );
    main.title = effect?.params?.path || "";

    const actions = el("div", "m3ssv2-vst3-rack-actions");
    const uiButton = button(
      opening ? (closing ? "Closing…" : "Close UI") : "Open UI",
      `m3ssv2-button secondary m3ssv2-vst3-mini m3ssv2-vst3-open-ui${opening ? " is-active" : ""}`,
    );
    uiButton.disabled = !hostReady || closing || anotherOpen;
    uiButton.title = !hostReady
      ? "VST3 host is not ready"
      : opening
        ? "Close the native plugin window and capture its current state"
        : anotherOpen
          ? "Close the currently open VST3 interface first"
          : "Open the plugin's native interface";
    uiButton.onclick = () => opening ? onCloseUi(effect) : onOpenUi(effect);

    const power = button(effect.enabled === false ? "Enable" : "Bypass", `m3ssv2-button secondary m3ssv2-vst3-mini${effect.enabled === false ? "" : " is-active"}`);
    power.setAttribute("aria-pressed", effect.enabled === false ? "false" : "true");
    power.onclick = () => { effect.enabled = effect.enabled === false; markDirty(); rerender(); };

    const up = button("↑", "m3ssv2-button secondary m3ssv2-vst3-icon");
    up.title = "Move up";
    up.disabled = index === 0;
    up.onclick = () => {
      if (index <= 0) return;
      [effects[index - 1], effects[index]] = [effects[index], effects[index - 1]];
      markDirty();
      rerender();
    };
    const down = button("↓", "m3ssv2-button secondary m3ssv2-vst3-icon");
    down.title = "Move down";
    down.disabled = index === effects.length - 1;
    down.onclick = () => {
      if (index >= effects.length - 1) return;
      [effects[index + 1], effects[index]] = [effects[index], effects[index + 1]];
      markDirty();
      rerender();
    };
    const remove = button("×", "m3ssv2-button secondary m3ssv2-vst3-icon is-danger");
    remove.title = opening ? "Close Plugin UI before removing this VST3" : "Remove VST3 from rack";
    remove.disabled = opening;
    remove.onclick = () => { effects.splice(index, 1); markDirty(); rerender(); };
    actions.append(uiButton, power, up, down, remove);
    row.append(main, actions);
    section.appendChild(row);
  });
  return section;
}

function pluginRow(plugin, { hostReady, canEdit, onAdd }) {
  const row = el("div", "m3ssv2-vst3-row");
  const main = el("div", "m3ssv2-vst3-main");
  const name = String(plugin.name || "Unnamed VST3");
  const vendor = String(plugin.vendor || "").trim();
  main.appendChild(el("strong", "m3ssv2-vst3-name", name));
  if (vendor) main.appendChild(el("div", "m3ssv2-vst3-meta", vendor));
  main.title = [plugin.vendor, plugin.path].filter(Boolean).join(" · ");
  row.appendChild(main);
  if (canEdit) {
    const actions = el("div", "m3ssv2-vst3-add-actions");
    const track = button("+ Track", "m3ssv2-button secondary m3ssv2-vst3-mini");
    const master = button("+ Master", "m3ssv2-button secondary m3ssv2-vst3-mini");
    track.disabled = !hostReady;
    master.disabled = !hostReady;
    track.title = hostReady ? "Add to Main Track VST3 rack" : "VST3 host is unavailable";
    master.title = hostReady ? "Add to Master VST3 rack" : "VST3 host is unavailable";
    track.onclick = () => onAdd("track", plugin);
    master.onclick = () => onAdd("master", plugin);
    actions.append(track, master);
    row.appendChild(actions);
  }
  return row;
}

function pluginMatches(plugin, query) {
  if (!query) return true;
  const haystack = [plugin?.name, plugin?.vendor, plugin?.path, plugin?.kind]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
  return haystack.includes(query.toLowerCase());
}

export function createVst3BrowserPanel({ node = null } = {}) {
  const root = el("section", "m3ssv2-vst3-panel");
  root.dataset.m3ssVst3View = "plugins";

  const head = el("div", "m3ssv2-vst3-head");
  const viewTabs = el("nav", "m3ssv2-vst3-view-tabs");
  const pluginsTab = button("Plugins", "m3ssv2-vst3-view-tab is-active");
  const rackTab = button("Rack", "m3ssv2-vst3-view-tab");
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

  const searchWrap = el("div", "m3ssv2-vst3-search-wrap");
  const search = input("search", "");
  search.className = "m3ssv2-vst3-search";
  search.placeholder = "Search VST3…";
  search.autocomplete = "off";
  searchWrap.appendChild(search);

  const inlineStatus = el("div", "m3ssv2-vst3-inline-status");
  inlineStatus.hidden = true;

  const pluginsPane = el("div", "m3ssv2-vst3-pane m3ssv2-vst3-plugins-pane");
  const list = el("div", "m3ssv2-vst3-list");
  pluginsPane.appendChild(list);

  const rackPane = el("div", "m3ssv2-vst3-pane m3ssv2-vst3-rack-pane");
  rackPane.hidden = true;
  const racks = el("div", "m3ssv2-vst3-racks");
  rackPane.appendChild(racks);

  root.append(head, searchWrap, inlineStatus, pluginsPane, rackPane);

  const state = initialRackState(node);
  let scanning = false;
  let hostReady = false;
  let hostDetail = "";
  let lastPlugins = [];
  let rackDirty = false;
  let statusTimer = null;
  const openingIds = new Set();
  const closingIds = new Set();
  const markDirty = () => { rackDirty = true; };

  const rackCount = () => state.track.length + state.master.length;

  function updateRackTab() {
    const count = rackCount();
    rackTab.textContent = count ? `Rack ${count}` : "Rack";
  }

  function setStatus(text = "", kind = "", timeout = 0) {
    clearTimeout(statusTimer);
    inlineStatus.textContent = text;
    inlineStatus.hidden = !text;
    inlineStatus.className = `m3ssv2-vst3-inline-status${kind ? ` is-${kind}` : ""}`;
    if (text && timeout > 0) statusTimer = setTimeout(() => setStatus(), timeout);
  }

  function setNativeOpenFlag() {
    root.dataset.m3ssVst3EditorOpen = openingIds.size ? "1" : "0";
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
    searchWrap.hidden = !pluginsActive;
    rackPane.hidden = pluginsActive;
    if (pluginsActive) queueMicrotask(() => search.focus?.());
  }

  async function onCloseUi(effect) {
    if (!openingIds.has(effect.id) || closingIds.has(effect.id)) return;
    closingIds.add(effect.id);
    setStatus(`Closing ${effectLabel(effect)}…`, "busy");
    renderRacks();
    try {
      const result = await closeVst3NativeEditor();
      if (result?.forced) setStatus("Plugin UI force-closed. Latest state may not have been captured.", "error");
      else setStatus("Closing Plugin UI…", "busy");
    } catch (error) {
      setStatus(`Close UI failed: ${error}`, "error");
    } finally {
      renderRacks();
    }
  }

  async function onOpenUi(effect) {
    if (!hostReady || openingIds.size || openingIds.has(effect.id)) return;
    openingIds.add(effect.id);
    setNativeOpenFlag();
    setStatus(`${effectLabel(effect)} · Native UI open`, "busy");
    renderRacks();
    try {
      const result = await openVst3NativeEditor(effect);
      effect.params ||= {};
      effect.params.state_kind = result.state_kind || "preset_data";
      effect.params.state_b64 = result.state_b64 || "";
      effect.params.state_bytes = Number(result.state_bytes) || 0;
      effect.params.plugin_identifier = result.plugin_identifier || effect.params.plugin_identifier || "";
      effect.params.plugin_version = result.plugin_version || "";
      effect.params.manufacturer = result.manufacturer || effect.params.vendor || "";
      effect.params.phase = "2B";
      markDirty();
      setStatus(`${effectLabel(effect)} · State captured`, "saved", 3500);
    } catch (error) {
      setStatus(`Plugin UI failed: ${error}`, "error");
    } finally {
      openingIds.delete(effect.id);
      closingIds.delete(effect.id);
      setNativeOpenFlag();
      renderRacks();
    }
  }

  const renderRacks = () => {
    const options = {
      markDirty, rerender: renderRacks, hostReady, openingIds, closingIds, onOpenUi, onCloseUi,
    };
    racks.replaceChildren(
      rackSection("Track", "track", state, options),
      rackSection("Master", "master", state, options),
    );
    updateRackTab();
  };

  const renderPlugins = () => {
    list.replaceChildren();
    const query = String(search.value || "").trim();
    const filtered = lastPlugins.filter((plugin) => pluginMatches(plugin, query));
    if (!filtered.length) {
      list.appendChild(el(
        "div",
        "m3ssv2-vst3-empty",
        lastPlugins.length ? "No matching VST3 plugins" : "No VST3 effects found",
      ));
      return;
    }
    const onAdd = (owner, plugin) => {
      state[owner].push(pluginEffect(plugin));
      markDirty();
      renderRacks();
      setStatus(`${plugin.name || "VST3"} added to ${owner === "master" ? "Master" : "Track"}`, "saved", 1800);
    };
    for (const plugin of filtered) {
      list.appendChild(pluginRow(plugin, { hostReady, canEdit: !!node, onAdd }));
    }
  };

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
      renderRacks();
      renderPlugins();
      if (!hostReady) setStatus(hostDetail || "VST3 host unavailable", "error");
      else if (inlineStatus.classList.contains("is-error")) setStatus();
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
  rescan.onclick = runScan;
  root.runScan = runScan;
  root.setVst3View = setView;
  root.persistVst3State = () => {
    if (!rackDirty) return true;
    if (openingIds.size) {
      setStatus("Close Plugin UI before Save Edits", "error");
      return false;
    }
    const saved = persistRackState(node, state);
    if (saved) rackDirty = false;
    return saved;
  };
  setNativeOpenFlag();
  renderRacks();
  setView("plugins");
  return root;
}
