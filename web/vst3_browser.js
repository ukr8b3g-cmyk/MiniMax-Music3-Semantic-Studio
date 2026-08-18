import { api } from "../../scripts/api.js";
import { el, button } from "./audio_editor_core.js";

export async function scanVst3Plugins() {
  const response = await api.fetchApi("/m3ss/vst3/scan");
  if (!response.ok) throw new Error(`VST3 scan failed: HTTP ${response.status}`);
  return await response.json();
}

function pluginRow(plugin) {
  const row = el("div", "m3ssv2-vst3-row");
  const main = el("div", "m3ssv2-vst3-main");
  const title = el("strong", "m3ssv2-vst3-name", plugin.name || "Unnamed VST3");
  const meta = el("div", "m3ssv2-vst3-meta");
  const kind = plugin.kind === "effect" ? "Effect" : "Unclassified";
  meta.textContent = [plugin.vendor, kind, "Detected · not loaded yet"].filter(Boolean).join(" · ");
  const path = el("div", "m3ssv2-vst3-path", plugin.path || "");
  path.title = plugin.path || "";
  main.append(title, meta, path);
  const badge = el("span", `m3ssv2-vst3-badge ${plugin.kind === "effect" ? "is-effect" : "is-unknown"}`, kind);
  row.append(main, badge);
  return row;
}

export function createVst3BrowserPanel() {
  const root = el("section", "m3ssv2-vst3-panel");
  const head = el("div", "m3ssv2-vst3-head");
  const heading = el("div", "");
  heading.append(
    el("h3", "", "VST3 Plugins · Phase 1"),
    el("p", "m3ssv2-vst3-note", "Windows 64-bit VST3 detection only. Plugins are listed but not loaded or used for audio processing yet."),
  );
  const rescan = button("Rescan", "m3ssv2-button secondary");
  head.append(heading, rescan);

  const status = el("div", "m3ssv2-vst3-status", "Not scanned yet.");
  const roots = el("div", "m3ssv2-vst3-roots");
  const list = el("div", "m3ssv2-vst3-list");
  root.append(head, status, roots, list);

  let scanning = false;
  async function runScan() {
    if (scanning) return;
    scanning = true;
    rescan.disabled = true;
    status.textContent = "Scanning installed VST3 plugins…";
    roots.replaceChildren();
    list.replaceChildren();
    try {
      const result = await scanVst3Plugins();
      const plugins = Array.isArray(result.plugins) ? result.plugins : [];
      status.textContent = `${plugins.length} VST3 effect candidate${plugins.length === 1 ? "" : "s"} detected.`;
      const scanRoots = Array.isArray(result.roots) ? result.roots : [];
      if (scanRoots.length) {
        roots.appendChild(el("strong", "", "Scan folders"));
        for (const path of scanRoots) roots.appendChild(el("div", "m3ssv2-vst3-root-path", path));
      }
      if (!plugins.length) {
        list.appendChild(el("div", "m3ssv2-vst3-empty", "No VST3 effect candidates were found in the standard Windows VST3 folder."));
      } else {
        for (const plugin of plugins) list.appendChild(pluginRow(plugin));
      }
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
  return root;
}
