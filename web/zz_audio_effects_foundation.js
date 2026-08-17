import { app } from "../../scripts/app.js";
import { createEffectsRackState, renderEffectsRack } from "./audio_effects.js";
import { currentUiLocale } from "./ui_i18n.js";

const INSTALLED = "m3ssEffectsFoundationInstalled";

function label() {
  return currentUiLocale() === "ja" ? "エフェクト" : "Effects";
}

function installDialog(dialog) {
  if (!dialog || dialog.dataset[INSTALLED] === "1") return;
  const tabs = dialog.querySelector(".m3ssv2-inspector-tabs");
  const body = dialog.querySelector(".m3ssv2-inspector-body");
  if (!tabs || !body) return;
  dialog.dataset[INSTALLED] = "1";

  const officialTabs = [...tabs.querySelectorAll(".m3ssv2-inspector-tab")];
  const masterTab = officialTabs[3] || null;
  const effectsTab = document.createElement("button");
  effectsTab.type = "button";
  effectsTab.className = "m3ssv2-inspector-tab m3ssv2-effects-tab";
  effectsTab.textContent = label();
  tabs.appendChild(effectsTab);

  const state = createEffectsRackState();
  let effectsActive = false;
  let rendering = false;

  const showUnavailable = () => {
    body.replaceChildren();
    const note = document.createElement("div");
    note.className = "m3ssv2-empty";
    note.textContent = currentUiLocale() === "ja"
      ? "Effects Rackの編集コンテキストを取得できませんでした。Masterタブを一度開いてから再度お試しください。"
      : "Effects Rack context is unavailable. Open the Master tab once, then try again.";
    body.appendChild(note);
  };

  const render = () => {
    if (!effectsActive || rendering) return;
    const context = body._m3ssEffectsContext;
    for (const tab of officialTabs) tab.classList.remove("is-active");
    effectsTab.classList.add("is-active");
    if (!context?.project || typeof context.commit !== "function") {
      showUnavailable();
      return;
    }
    rendering = true;
    try {
      renderEffectsRack(body, context.project, context.commit, state);
    } finally {
      rendering = false;
    }
  };

  for (const tab of officialTabs) {
    tab.addEventListener("click", () => {
      effectsActive = false;
      effectsTab.classList.remove("is-active");
    }, { capture: true });
  }

  effectsTab.onclick = () => {
    if (!body._m3ssEffectsContext?.project && masterTab) masterTab.click();
    effectsActive = true;
    queueMicrotask(render);
  };

  const observer = new MutationObserver(() => {
    if (!dialog.isConnected) {
      observer.disconnect();
      return;
    }
    if (effectsActive && !body.querySelector(".m3ssv2-effects-root")) queueMicrotask(render);
  });
  observer.observe(body, { childList: true, subtree: false });
}

function scan() {
  for (const dialog of document.querySelectorAll(".m3ssv2-dialog")) installDialog(dialog);
}

if (typeof document !== "undefined") {
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
}

app.registerExtension({
  name: "minimax.music3.semantic.studio.audio-effects-foundation",
});
