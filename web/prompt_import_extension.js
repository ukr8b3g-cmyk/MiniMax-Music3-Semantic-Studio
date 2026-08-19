import { app } from "../../scripts/app.js";
import { getNodeWidget } from "./node_compact.js";
import { normalizeProject, totalDuration } from "./semantic_studio_core.js";
import { openPromptImporter } from "./prompt_import.js";

const NODE_ID = "MiniMaxMusic3SemanticStudio";
const EXTENSION_NAME = "minimax.music3.semantic.studio.prompt-import";
const DIVIDER_NAME = "──────── Semantic Studio ────────";
const nodeClass = (node) => node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";

function normalizeNodeActions(node) {
  if (!Array.isArray(node?.widgets)) return;

  const importPrompt = getNodeWidget(node, "Import Prompt");
  const importIndex = importPrompt ? node.widgets.indexOf(importPrompt) : -1;
  const openStudio = getNodeWidget(node, "Open Semantic Studio")
    || (importIndex > 0 ? [...node.widgets.slice(0, importIndex)].reverse().find((widget) => widget?.type === "button" && !widget?.hidden) : null);
  let divider = getNodeWidget(node, DIVIDER_NAME);
  if (!divider && openStudio) {
    divider = node.addWidget?.("button", DIVIDER_NAME, null, () => {}, { serialize: false });
    if (divider) {
      divider.label = DIVIDER_NAME;
      divider.serialize = false;
      divider.disabled = true;
    }
  }

  if (!importPrompt || !openStudio || !divider) return;
  const remaining = node.widgets.filter((widget) => ![importPrompt, divider, openStudio].includes(widget));
  node.widgets.splice(0, node.widgets.length, ...remaining, importPrompt, divider, openStudio);
  node.setSize?.([
    Math.max(node.size?.[0] || 360, 360),
    Math.max(220, node.computeSize?.()[1] || 0, node.size?.[1] || 0),
  ]);
  node.setDirtyCanvas?.(true, true);
}

function install(node) {
  if (nodeClass(node) !== NODE_ID || node._m3ssPromptImportInstalled) return;
  node._m3ssPromptImportInstalled = true;
  const projectWidget = getNodeWidget(node, "project_json");
  if (!projectWidget) return;

  const open = node.addWidget?.("button", "Import Prompt", null, () => {
    let current;
    try {
      const parsed = JSON.parse(projectWidget.value || "{}");
      current = normalizeProject(parsed);
    } catch (error) {
      // Import Prompt is a recovery/editing surface, not a validation gate. A bad
      // hidden project_json should not prevent the user from importing a new prompt.
      console.warn("[MiniMax Music3 Semantic Studio] Prompt Import recovered invalid project_json:", error);
      current = normalizeProject({});
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

        node.setDirtyCanvas?.(true, true);
        app.graph?.setDirtyCanvas?.(true, true);
      },
    });
  }, { serialize: false });

  if (open) {
    open.label = "Import Prompt";
    open.serialize = false;
  }

  requestAnimationFrame(() => normalizeNodeActions(node));
}

app.registerExtension({
  name: EXTENSION_NAME,
  async nodeCreated(node) { install(node); },
});
