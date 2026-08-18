import { createVst3BrowserPanel } from "./vst3_browser.js";

const STYLE_ID = "m3ss-vst3-browser-style";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./vst3_browser.css", import.meta.url).href;
  document.head.appendChild(link);
}

function mountPanel(dialog) {
  const side = dialog?.querySelector?.(".m3ssv2-side");
  if (!side || side.dataset.m3ssVst3Phase1Mounted === "1") return;
  side.dataset.m3ssVst3Phase1Mounted = "1";
  ensureStyles();
  const panel = createVst3BrowserPanel();
  side.appendChild(panel);
  panel.runScan?.();
}

function scanRoot(root = document) {
  for (const dialog of root.querySelectorAll?.(".m3ssv2-dialog") || []) mountPanel(dialog);
  if (root.matches?.(".m3ssv2-dialog")) mountPanel(root);
}

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(".m3ssv2-dialog") || node.querySelector?.(".m3ssv2-dialog")) scanRoot(node);
    }
  }
});

observer.observe(document.documentElement, { childList: true, subtree: true });
scanRoot();
