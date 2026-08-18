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
      phase: "2A",
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

function rackSection(title, owner, state, rerender) {
  const section = el("section", "m3ssv2-vst3-rack-section");
  const effects = state[owner];
  section.appendChild(el("strong", "m3ssv2-vst3-rack-title", `${title} · ${effects.length}`));
  if (!effects.length) {
    section.appendChild(el("div", "m3ssv2-vst3-empty", "No VST3 effects in this rack."));
    return section;
  }
  effects.forEach((effect, index) => {
    const row = el("div", `m3ssv2-vst3-rack-row${effect.enabled === false ? " is-bypassed" : ""}`);
    const main = el("div", "m3ssv2-vst3-main");
    main.append(
      el("strong", "m3ssv2-vst3-name", effectLabel(effect)),
      el("div", "m3ssv2-vst3-meta", `${effect.enabled === false ? "BYPASS" : "ON"} · rack position ${index + 1}`),
    );
    const power = button(effect.enabled === false ? "Enable" : "Bypass", "m3ssv2-button secondary m3ssv2-vst3-mini");
    power.onclick = () => { effect.enabled = effect.enabled === false; rerender(); };
    const up = button("↑", "m3ssv2-button secondary m3ssv2-vst3-icon");
    up.disabled = index === 0;
    up.onclick = () => {
      if (index <= 0) return;
      [effects[index - 1], effects[index]] = [effects[index], effects[index - 1]];
      rerender();
    };
    const down = button("↓", "m3ssv2-button secondary m3ssv2-vst3-icon");
    down.disabled = index === effects.length - 1;
    down.onclick = () => {
      if (index >= effects.length - 1) return;
      [effects[index + 1], effects[index]] = [effects[index], effects[index + 1]];
      rerender();
    };
    const remove = button("×", "m3ssv2-button secondary m3ssv2-vst3-icon is-danger");
    remove.title = "Remove VST3 from rack";
    remove.onclick = () => { effects.splice(index, 1); rerender(); };
    row.append(main, power, up, down, remove);
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
  meta.textContent = [plugin.vendor, kind, hostReady ? "Host ready" : "Detected · host unavailable"].filter(Boolean).join(" · ");
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
    track.title = hostReady ? "Append to Main Track VST3 rack" : "Install the optional VST3 host first";
    master.title = hostReady ? "Append to Master VST3 rack" : "Install the optional VST3 host first";
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
    el("h3", "", "VST3 Plugins · Phase 2A"),
    el("p", "m3ssv2-vst3-note", "Queued VST3 processing is available through the optional Pedalboard host. Browser Draft remains built-in DSP only."),
  );
  const rescan = button("Rescan", "m3ssv2-button secondary");
  head.append(heading, rescan);

  const host = el("div", "m3ssv2-vst3-host", "VST3 host status not checked yet.");
  const status = el("div", "m3ssv2-vst3-status", "Not scanned yet.");
  const roots = el("div", "m3ssv2-vst3-roots");
  const racks = el("div", "m3ssv2-vst3-racks");
  const list = el("div", "m3ssv2-vst3-list");
  root.append(head, host, status, roots, racks, list);

  const state = initialRackState(node);
  let scanning = false;
  let hostReady = false;
  let lastPlugins = [];

  const renderRacks = () => {
    racks.replaceChildren(
      el("div", "m3ssv2-vst3-rack-note", "Phase 2A appends VST3 after built-in effects. VST3 order within each rack is preserved."),
      rackSection("Main Track VST3", "track", state, renderRacks),
      rackSection("Master VST3", "master", state, renderRacks),
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
    host.textContent = "Checking optional VST3 host…";
    roots.replaceChildren();
    list.replaceChildren();
    try {
      const [result, hostResult] = await Promise.all([scanVst3Plugins(), readVst3HostStatus()]);
      hostReady = !!hostResult?.ready;
      host.textContent = hostReady
        ? `Host ready · ${hostResult.backend || "pedalboard"} ${hostResult.version || ""}`.trim()
        : String(hostResult?.message || "Optional VST3 host is unavailable.");
      host.classList.toggle("is-ready", hostReady);
      host.classList.toggle("is-missing", !hostReady);
      lastPlugins = Array.isArray(result.plugins) ? result.plugins : [];
      status.textContent = `${lastPlugins.length} VST3 effect candidate${lastPlugins.length === 1 ? "" : "s"} detected.`;
      const scanRoots = Array.isArray(result.roots) ? result.roots : [];
      if (scanRoots.length) {
        roots.appendChild(el("strong", "", "Scan folders"));
        for (const path of scanRoots) roots.appendChild(el("div", "m3ssv2-vst3-root-path", path));
      }
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
  root.persistVst3State = () => persistRackState(node, state);
  renderRacks();
  return root;
}
