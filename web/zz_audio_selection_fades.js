import { uid } from "./audio_editor_core.js";
import { parseClock } from "./audio_time_controls.js";
import { applySelectionFade, canApplySelectionFade } from "./audio_selection_fade_core.js";

const INSTALLED = "m3ssSelectionFadesInstalled";

function readSelection(dialog) {
  const summary = dialog.querySelector(".m3ssv2-selection-text");
  if (!/^Selection\s/i.test(String(summary?.textContent || "").trim())) return null;
  const inputs = [...dialog.querySelectorAll(".m3ssv2-selection-panel input")];
  if (inputs.length < 2) return null;
  const start = parseClock(inputs[0].value);
  const end = parseClock(inputs[1].value);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start + .001) return null;
  return { start, end };
}

function menuItem(label, disabled, action) {
  const item = document.createElement("button");
  item.type = "button";
  item.className = "m3ssv2-context-menu-item";
  item.dataset.m3ssSelectionFade = "1";
  item.disabled = !!disabled;
  const text = document.createElement("span");
  text.textContent = label;
  const shortcut = document.createElement("kbd");
  item.append(text, shortcut);
  item.onclick = () => {
    const menu = item.closest(".m3ssv2-context-menu");
    if (menu) menu.hidden = true;
    if (!item.disabled) action?.();
  };
  return item;
}

function insertFadeItems(dialog) {
  const menu = dialog.querySelector(".m3ssv2-context-menu");
  if (!menu || menu.hidden) return;
  for (const old of menu.querySelectorAll('[data-m3ss-selection-fade="1"]')) old.remove();

  const selection = readSelection(dialog);
  const context = dialog._m3ssSingleAudioContext?.()
    || dialog.querySelector(".m3ssv2-inspector-body")?._m3ssEffectsContext
    || null;
  const track = context?.project?.tracks?.[0] || null;
  const available = !!selection && !!track && canApplySelectionFade(track, selection.start, selection.end);

  const apply = (direction) => {
    const latest = readSelection(dialog);
    const latestContext = dialog._m3ssSingleAudioContext?.()
      || dialog.querySelector(".m3ssv2-inspector-body")?._m3ssEffectsContext
      || null;
    const latestTrack = latestContext?.project?.tracks?.[0] || null;
    if (!latest || !latestTrack || typeof latestContext?.commit !== "function") return;
    if (!canApplySelectionFade(latestTrack, latest.start, latest.end)) {
      alert("Fade In / Fade Out requires one selected range contained inside a single clip.");
      return;
    }
    latestContext.commit(() => {
      applySelectionFade(latestTrack, latest.start, latest.end, direction, {
        curve: "linear",
        makeId: () => uid("clip"),
      });
    });
  };

  const separator = document.createElement("div");
  separator.className = "m3ssv2-context-menu-sep";
  separator.dataset.m3ssSelectionFade = "1";
  const fadeIn = menuItem("Fade In", !available, () => apply("fade_in"));
  const fadeOut = menuItem("Fade Out", !available, () => apply("fade_out"));
  if (!available && selection) {
    const reason = "Selection must be contained inside one clip.";
    fadeIn.title = reason;
    fadeOut.title = reason;
  }

  const buttons = [...menu.querySelectorAll(".m3ssv2-context-menu-item")];
  const mute = buttons.find((button) => /^(Mute|Unmute) (Track|Audio)$/i.test(String(button.textContent || "").trim()));
  const anchor = mute?.previousElementSibling?.classList?.contains("m3ssv2-context-menu-sep")
    ? mute.previousElementSibling
    : mute;
  if (anchor) {
    menu.insertBefore(separator, anchor);
    menu.insertBefore(fadeIn, anchor);
    menu.insertBefore(fadeOut, anchor);
  } else {
    menu.append(separator, fadeIn, fadeOut);
  }
}

function install(dialog) {
  if (!dialog || dialog.dataset.m3ssEmptyEditor === "1" || dialog.dataset[INSTALLED] === "1") return;
  const main = dialog.querySelector(".m3ssv2-main");
  if (!main) return;
  dialog.dataset[INSTALLED] = "1";

  const onContextMenu = () => insertFadeItems(dialog);
  main.addEventListener("contextmenu", onContextMenu);
  dialog.addEventListener("m3ss-shell-close", () => main.removeEventListener("contextmenu", onContextMenu), { once: true });
}

if (typeof document !== "undefined") {
  document.addEventListener("m3ss-audio-workspace-ready", (event) => {
    const dialog = event.target?.closest?.(".m3ssv2-dialog") || event.target;
    if (dialog?.matches?.(".m3ssv2-dialog")) install(dialog);
  });
}
