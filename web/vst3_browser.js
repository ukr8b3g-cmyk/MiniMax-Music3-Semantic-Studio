import { api } from "../../scripts/api.js";
import { el, button } from "./audio_editor_core.js";
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
  const bytes = Number(effect?.params?.state_bytes) || 0;
  if (!effect?.params?.state_b64) return "Default plugin state";
  if (bytes >= 1024 * 1024) return `Native state saved · ${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
  if (bytes >= 1024) return `Native state saved · ${(bytes / 1024).toFixed(1)} KiB`;
  return `Native state saved${bytes ? ` · ${bytes} B` : ""}`;
}

function rackSection(title, owner, state, options) {
  const {
    markDirty, rerender, hostReady, openingIds, closingIds, onOpenUi, onCloseUi,
  } = options;
  const section = el("section", "m3ssv2-vst3-rack-section");
  const effects = state[owner];
  section.appendChild(el("strong", "m3ssv2-vst3-rack-title", `${title} · ${effects.length}`));
  if (!effects.length) {
    section.appendChild(el("div", "m3ssv2-vst3-empty", "No VST3 effects in this rack."));
    return section;
  }
  effects.forEach((effect, index) => {
    const opening = openingIds.has(effect.id);
    const closing = closingIds.has(effect.id);
    const anotherOpen = openingIds.size > 0 && !opening;
    const row = el("div", `m3ssv2-vst3-rack-row${effect.enabled === false ? " is-bypassed" : ""}`);
    const main = el("div", "m3ssv2-vst3-main");
    main.append(
      el("strong", "m3ssv2-vst3-name", effectLabel(effect)),
      el("div", "m3ssv2-vst3-meta", `${effect.enabled === false ? "BYPASS" : "ON"} · ${stateLabel(effect)} · rack ${index + 1}`),
    );

    const uiButton = button(
      opening ? (closing ? "Closing…" : "Close UI") : "Open UI",
      "m3ssv2-button secondary m3ssv2-vst3-mini m3ssv2-vst3-open-ui",
    );
    uiButton.disabled = !hostReady || closing || anotherOpen;
    uiButton.title = !hostReady
      ? "VST3 host is not ready"
      : opening
        ? "Close the native plugin window and capture its current state"
        : anotherOpen
          ? "Close the currently open VST3 interface first"
          : "Open this plugin's original VST3 interface in an isolated native window";
    uiButton.onclick = () => opening ? onCloseUi(effect) : onOpenUi(effect);

    const power = button(effect.enabled === false ? "Enable" : "Bypass", "m3ssv2-button secondary m3ssv2-vst3-mini");
    power.onclick = () => { effect.enabled = effect.enabled === false; markDirty(); rerender(); };
    const up = button("↑", "m3ssv2-button secondary m3ssv2-vst3-icon");
    up.disabled = index === 0;
    up.onclick = () => {
      if (index <= 0) return;
      [effects[index - 1], effects[index]] = [effects[index], effects[index - 1]];
      markDirty();
      rerender();
    };
    const down = button("↓", "m3ssv2-button secondary m3ssv2-vst3-icon");
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
    row.append(main, uiButton, power, up, down, remove);
    section.appendChild(row);
  });
  return section;
}

function pluginRow(plugin, { hostReady, canEdit, onAdd }) {
  const row = el("div", "m3ssv2-vst3-row");
  const main = el("div", "m3ssv2-vst3-main");
  const title = el("strong", "m3ssv2-vst3-name", plugin.name || "Unnamed VST3");
  const meta = el("div", "m3ssv2-vst3-meta");
  const kind = plugin.kind === "effect" ? "Effect" : "Unclassified";
  meta.textContent = [plugin.vendor, kind, hostReady ? "Host + Native UI ready" : "Detected · host unavailable"].filter(Boolean).join(" · ");
  const path = el("div", "m3ssv2-vst3-path", plugin.path || "");
  path.title = plugin.path || "";
  main.append(title, meta, path);
  const badge = el("span", `m3ssv2-vst3-badge ${plugin.kind === "effect" ? "is-effect" : "is-unknown"}`, kind);
  row.append(main, badge);
  if (canEdit) {
    const actions = el("div", "m3ssv2-vst3-add-actions");
    const track = button("+ Track", "m3ssv2-button secondary m3ssv2-vst3-mini");
    const master = button("+ Master", "m3ssv2-button secondary m3ssv2-vst3-mini");
    track.disabled = !hostReady;
    master.disabled = !hostReady;
    track.title = hostReady ? "Append to Main Track VST3 rack" : "VST3 host is unavailable";
    master.title = hostReady ? "Append to Master VST3 rack" : "VST3 host is unavailable";
    track.onclick = () => onAdd("track", plugin);
    master.onclick = () => onAdd("master", plugin);
    actions.append(track, master);
    row.appendChild(actions);
  }
  return row;
}

export function createVst3BrowserPanel({ node = null } = {}) {
  const root = el("section", "m3ssv2-vst3-panel");
  const head = el("div", "m3ssv2-vst3-head");
  const heading = el("div", "");
  heading.append(
    el("h3", "", "VST3 Plugins · Phase 2B"),
    el("p", "m3ssv2-vst3-note", "Open the plugin's original native UI. Use Close UI here if the plugin window's own close button does not work. State is captured when the native window closes."),
  );
  const rescan = button("Rescan", "m3ssv2-button secondary");
  head.append(heading, rescan);

  const host = el("div", "m3ssv2-vst3-host", "VST3 host status not checked yet.");
  const editorStatus = el("div", "m3ssv2-vst3-editor-status", "Native Plugin UI: idle");
  const status = el("div", "m3ssv2-vst3-status", "Not scanned yet.");
  const roots = el("div", "m3ssv2-vst3-roots");
  const racks = el("div", "m3ssv2-vst3-racks");
  const list = el("div", "m3ssv2-vst3-list");
  root.append(head, host, editorStatus, status, roots, racks, list);

  const state = initialRackState(node);
  let scanning = false;
  let hostReady = false;
  let lastPlugins = [];
  let rackDirty = false;
  const openingIds = new Set();
  const closingIds = new Set();
  const markDirty = () => { rackDirty = true; };

  function setNativeOpenFlag() {
    root.dataset.m3ssVst3EditorOpen = openingIds.size ? "1" : "0";
  }

  async function onCloseUi(effect) {
    if (!openingIds.has(effect.id) || closingIds.has(effect.id)) return;
    closingIds.add(effect.id);
    editorStatus.textContent = `Closing ${effectLabel(effect)}… Capturing native plugin state.`;
    editorStatus.classList.add("is-busy");
    renderRacks();
    try {
      const result = await closeVst3NativeEditor();
      if (result?.forced) {
        editorStatus.textContent = `${effectLabel(effect)} was force-closed. Latest state may not have been captured.`;
        editorStatus.classList.add("is-error");
      } else {
        editorStatus.textContent = `${effectLabel(effect)} close requested… waiting for state capture.`;
      }
    } catch (error) {
      editorStatus.textContent = `Close Plugin UI failed: ${error}`;
      editorStatus.classList.add("is-error");
    } finally {
      renderRacks();
    }
  }

  async function onOpenUi(effect) {
    if (!hostReady || openingIds.size || openingIds.has(effect.id)) return;
    openingIds.add(effect.id);
    setNativeOpenFlag();
    editorStatus.textContent = `Native UI open: ${effectLabel(effect)}. Use Close UI here if the plugin window cannot close itself.`;
    editorStatus.classList.add("is-busy");
    editorStatus.classList.remove("is-error", "is-saved");
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
      editorStatus.textContent = `${effectLabel(effect)} · native state captured. Save Edits, then Queue to render it.`;
      editorStatus.classList.remove("is-error");
      editorStatus.classList.add("is-saved");
    } catch (error) {
      editorStatus.textContent = `Native Plugin UI failed: ${error}`;
      editorStatus.classList.remove("is-saved");
      editorStatus.classList.add("is-error");
    } finally {
      openingIds.delete(effect.id);
      closingIds.delete(effect.id);
      setNativeOpenFlag();
      editorStatus.classList.remove("is-busy");
      renderRacks();
    }
  }

  const renderRacks = () => {
    const options = {
      markDirty, rerender: renderRacks, hostReady, openingIds, closingIds, onOpenUi, onCloseUi,
    };
    racks.replaceChildren(
      el("div", "m3ssv2-vst3-rack-note", "Open UI uses the plugin's original VST3 window. If its own × does not work, use Close UI in this rack. Browser Draft still does not host VST3."),
      rackSection("Main Track VST3", "track", state, options),
      rackSection("Master VST3", "master", state, options),
    );
  };

  const renderPlugins = () => {
    list.replaceChildren();
    if (!lastPlugins.length) {
      list.appendChild(el("div", "m3ssv2-vst3-empty", "No VST3 effect candidates were found in the standard Windows VST3 folder."));
      return;
    }
    const onAdd = (owner, plugin) => {
      state[owner].push(pluginEffect(plugin));
      markDirty();
      renderRacks();
    };
    for (const plugin of lastPlugins) {
      list.appendChild(pluginRow(plugin, { hostReady, canEdit: !!node, onAdd }));
    }
  };

  async function runScan() {
    if (scanning) return;
    scanning = true;
    rescan.disabled = true;
    status.textContent = "Scanning installed VST3 plugins…";
    host.textContent = "Checking VST3 host…";
    roots.replaceChildren();
    list.replaceChildren();
    try {
      const [result, hostResult] = await Promise.all([scanVst3Plugins(), readVst3HostStatus()]);
      hostReady = !!hostResult?.ready;
      host.textContent = hostReady
        ? `Host ready · ${hostResult.backend || "pedalboard"} ${hostResult.version || ""} · Native UI ready`.trim()
        : String(hostResult?.message || "VST3 host is unavailable.");
      host.classList.toggle("is-ready", hostReady);
      host.classList.toggle("is-missing", !hostReady);
      lastPlugins = Array.isArray(result.plugins) ? result.plugins : [];
      status.textContent = `${lastPlugins.length} VST3 effect candidate${lastPlugins.length === 1 ? "" : "s"} detected.`;
      const scanRoots = Array.isArray(result.roots) ? result.roots : [];
      if (scanRoots.length) {
        roots.appendChild(el("strong", "", "Scan folders"));
        for (const path of scanRoots) roots.appendChild(el("div", "m3ssv2-vst3-root-path", path));
      }
      renderRacks();
      renderPlugins();
    } catch (error) {
      status.textContent = `VST3 scan failed: ${error}`;
      list.appendChild(el("div", "m3ssv2-vst3-empty", "Restart ComfyUI after updating the custom node, then try Rescan again."));
    } finally {
      scanning = false;
      rescan.disabled = false;
    }
  }

  rescan.onclick = runScan;
  root.runScan = runScan;
  root.persistVst3State = () => {
    if (!rackDirty) return true;
    if (openingIds.size) {
      editorStatus.textContent = "Use Close UI before Save Edits so the latest VST3 state can be captured.";
      editorStatus.classList.add("is-error");
      return false;
    }
    const saved = persistRackState(node, state);
    if (saved) rackDirty = false;
    return saved;
  };
  setNativeOpenFlag();
  renderRacks();
  return root;
}
