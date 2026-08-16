import { app } from "../../scripts/app.js";
import { getNodeWidget } from "./node_compact.js";
import { normalizeProject, summarizeProject, totalDuration } from "./semantic_studio_core.js";
import { openPromptImporter } from "./prompt_import.js";

const NODE_ID = "MiniMaxMusic3SemanticStudio";
const EXTENSION_NAME = "minimax.music3.semantic.studio.prompt-import";
const nodeClass = (node) => node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";

function install(node) {
  if (nodeClass(node) !== NODE_ID || node._m3ssPromptImportInstalled) return;
  node._m3ssPromptImportInstalled = true;
  const projectWidget = getNodeWidget(node, "project_json");
  if (!projectWidget) return;

  const open = node.addWidget?.("button", "Import Prompt", null, () => {
    let current;
    try {
      current = normalizeProject(JSON.parse(projectWidget.value || "{}"));
    } catch (error) {
      alert(`Music3 Semantic Studio: cannot import until project_json is valid.\n\n${error}`);
      return;
    }

    openPromptImporter({
      project: current,
      onApply: (next) => {
        const serialized = JSON.stringify(next);
        projectWidget.value = serialized;
        projectWidget.callback?.(serialized);

        const durationWidget = getNodeWidget(node, "max_duration");
        if (durationWidget) {
          const max = Number(durationWidget.options?.max), limit = Number.isFinite(max) ? max : 360;
          durationWidget.value = Math.round(Math.max(0.04, Math.min(limit, totalDuration(next))) * 100) / 100;
          durationWidget.callback?.(durationWidget.value);
        }

        const summaryWidget = getNodeWidget(node, "Studio Summary");
        if (summaryWidget) summaryWidget.value = summarizeProject(next);
        node.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
      },
    });
  }, { serialize: false });

  if (open) {
    open.label = "Import Prompt";
    open.serialize = false;
  }
  node.setSize?.([Math.max(node.size?.[0] || 360, 360), Math.max(node.size?.[1] || 180, 210)]);
}

app.registerExtension({
  name: EXTENSION_NAME,
  async nodeCreated(node) { install(node); },
});
