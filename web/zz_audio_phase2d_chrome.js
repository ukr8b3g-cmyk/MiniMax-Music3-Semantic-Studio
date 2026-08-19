const INSTALLED = "m3ssPhase2dChrome";

function compactSubtitle(dialog) {
  const subtitle = dialog.querySelector(".m3shell-subtitle");
  if (!subtitle?.textContent) return;
  const next = subtitle.textContent
    .replace(/^Unified Waveform\s*\/\s*Draft Preview\s*·\s*/i, "")
    .replace(/\s*·\s*Python render remains authoritative\s*$/i, "")
    .replace(/^Audio Editor\s*·\s*/i, "");
  if (next !== subtitle.textContent) subtitle.textContent = next;
}

function install(dialog) {
  if (!dialog || dialog.dataset.m3ssEmptyEditor === "1" || dialog.dataset[INSTALLED] === "1") return;
  dialog.dataset[INSTALLED] = "1";
  compactSubtitle(dialog);

  const subtitle = dialog.querySelector(".m3shell-subtitle");
  if (subtitle) {
    const observer = new MutationObserver(() => {
      if (!dialog.isConnected) return observer.disconnect();
      compactSubtitle(dialog);
    });
    observer.observe(subtitle, { childList: true, subtree: true, characterData: true });
  }

  const reset = [...dialog.querySelectorAll(".m3ssv2-footer-actions button")]
    .find((button) => /^(Reset|リセット)$/.test(String(button.textContent || "").trim()));
  if (reset) {
    reset.addEventListener("click", () => {
      const original = globalThis.confirm;
      if (typeof original !== "function") return;
      globalThis.confirm = function (message, ...args) {
        const text = String(message || "")
          .replace(/one full-length Take 1 clip and neutral Track controls/gi, "one full-length source clip and neutral audio controls")
          .replace(/Track controls/gi, "audio controls");
        return original.call(this, text, ...args);
      };
      queueMicrotask(() => {
        if (globalThis.confirm !== original) globalThis.confirm = original;
      });
    }, true);
  }
}

if (typeof document !== "undefined") {
  document.addEventListener("m3ss-audio-workspace-ready", (event) => {
    const dialog = event.target?.closest?.(".m3ssv2-dialog") || event.target;
    if (dialog?.matches?.(".m3ssv2-dialog")) install(dialog);
  });
}