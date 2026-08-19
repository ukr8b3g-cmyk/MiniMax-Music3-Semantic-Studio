import { app } from "../../scripts/app.js";

const NODE_ID = "MiniMaxMusic3SemanticStudioAudioEditor";

function nodeClass(node) {
  return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function removeLegacyTakeInputs(node) {
  if (!node || nodeClass(node) !== NODE_ID || !Array.isArray(node.inputs)) return;
  const legacy = new Set(["take_2", "take_3", "take_4", "Take 2", "Take 3", "Take 4"]);
  for (let index = node.inputs.length - 1; index >= 0; index -= 1) {
    const input = node.inputs[index];
    if (!legacy.has(String(input?.name || "")) && !legacy.has(String(input?.label || ""))) continue;
    node.removeInput?.(index);
  }
  const width = Math.max(node.size?.[0] || 360, 360);
  const height = Math.max(130, Math.min(node.computeSize?.()[1] || node.size?.[1] || 170, 210));
  node.setSize?.([width, height]);
  node.setDirtyCanvas?.(true, true);
}

function setExactText(root, selector, from, to) {
  for (const element of root.querySelectorAll(selector)) {
    if ((element.textContent || "").trim() === from) element.textContent = to;
  }
}

function removeFieldByLabel(root, label) {
  for (const element of root.querySelectorAll("label, .m3ssv2-field")) {
    const text = (element.textContent || "").trim();
    if (text === label || text.startsWith(`${label}\n`) || text.startsWith(`${label} `)) {
      element.remove();
    }
  }
}

function simplifyPreviewOptions(root) {
  for (const select of root.querySelectorAll("select")) {
    for (const option of select.options || []) {
      const text = (option.textContent || "").trim();
      if (/^Take\s*1$/i.test(text) || /^Audio$/i.test(text)) option.textContent = "Original Audio";
      if (/^Take\s*[2-4]$/i.test(text)) option.remove();
    }
  }
}

function simplifyAudioEditor(dialog) {
  if (!dialog?.isConnected) return;

  // Release V1.0 presents a single AUDIO path. Historical track/master/take
  // objects remain internal for edit-schema compatibility only.
  setExactText(dialog, ".m3ssv2-wave-head strong", "Main Track Waveform", "Audio Waveform");
  setExactText(dialog, ".m3ssv2-track-name", "Main Track", "Audio");
  setExactText(dialog, ".m3ssv2-track-mini-label", "Track Gain", "Gain");
  setExactText(dialog, ".m3ssv2-track-mini-label", "Track Pan", "Pan");

  for (const tab of dialog.querySelectorAll(".m3ssv2-inspector-tab")) {
    const text = (tab.textContent || "").trim();
    if (text === "Track") tab.textContent = "Audio";
    else if (text === "Master") tab.textContent = "Output";
    else if (text === "Takes") {
      tab.hidden = true;
      tab.style.display = "none";
    }
  }

  removeFieldByLabel(dialog, "Source take");
  for (const button of dialog.querySelectorAll("button")) {
    const text = (button.textContent || "").trim();
    if (text === "Use Preview Take") {
      button.hidden = true;
      button.style.display = "none";
    }
  }

  for (const note of dialog.querySelectorAll(".m3ssv2-envelope-note, .m3ssv2-wave-note")) {
    const text = String(note.textContent || "");
    if (/comping/i.test(text)) {
      note.textContent = text
        .replace(/\s*and comping\.?/i, ".")
        .replace(/non-destructive source ranges\s*\./i, "non-destructive source ranges.");
    }
    if (/Main Track/g.test(note.textContent || "")) {
      note.textContent = String(note.textContent).replace(/Main Track/g, "Audio");
    }
  }

  simplifyPreviewOptions(dialog);

  const subtitle = dialog.querySelector(".m3shell-subtitle");
  if (subtitle) {
    subtitle.textContent = String(subtitle.textContent || "")
      .replace(/\b1 take\b/gi, "single audio")
      .replace(/\bTake 1\b/gi, "Audio");
  }
}

function scan() {
  for (const dialog of document.querySelectorAll(".m3ssv2-dialog")) simplifyAudioEditor(dialog);
}

app.registerExtension({
  name: "minimax.music3.audio-editor.v1-single-audio",
  nodeCreated(node) {
    if (nodeClass(node) !== NODE_ID) return;
    queueMicrotask(() => removeLegacyTakeInputs(node));
    setTimeout(() => removeLegacyTakeInputs(node), 120);
  },
});

if (typeof document !== "undefined") {
  const observer = new MutationObserver(scan);
  observer.observe(document.documentElement, { childList: true, subtree: true });
  scan();
}
