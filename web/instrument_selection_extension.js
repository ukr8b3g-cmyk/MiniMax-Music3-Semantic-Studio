// Instrument lane safety: timeline cells select sections; editing remains in Section Inspector.
// This capture-phase handler intentionally runs before the legacy cell onclick toggle.
function selectInstrumentCell(event) {
  const cell = event.target?.closest?.(".m3ss-tl-instrument-cell");
  if (!cell) return;

  event.preventDefault();
  event.stopImmediatePropagation();

  const index = cell.dataset.sectionIndex;
  const stage = cell.closest(".m3ss-tl-stage");
  if (!stage || index == null) return;

  const sectionBlock = [...stage.querySelectorAll(".m3ss-tl-section-block")]
    .find((block) => block.dataset.sectionIndex === index);
  sectionBlock?.click();
}

function refreshInstrumentHints(root = document) {
  for (const toggle of root.querySelectorAll?.(".m3ss-tl-instrument-toggle") || []) {
    toggle.textContent = toggle.textContent.replace(" · click cells to toggle", " · select a section to edit");
  }
  for (const cell of root.querySelectorAll?.(".m3ss-tl-instrument-cell") || []) {
    const title = cell.title || "";
    cell.title = title.replace(/: (On|Off)$/, ": $1 · select section to edit in Section Inspector");
    cell.removeAttribute("aria-pressed");
  }
}

document.addEventListener("click", selectInstrumentCell, true);

const observer = new MutationObserver((records) => {
  for (const record of records) {
    for (const node of record.addedNodes) {
      if (!(node instanceof Element)) continue;
      if (node.matches?.(".m3ss-tl-instrument-toggle,.m3ss-tl-instrument-cell") || node.querySelector?.(".m3ss-tl-instrument-toggle,.m3ss-tl-instrument-cell")) {
        refreshInstrumentHints(node.matches?.(".m3ss-tl-instrument-toggle,.m3ss-tl-instrument-cell") ? node.parentElement || node : node);
      }
    }
  }
});
observer.observe(document.documentElement, { childList: true, subtree: true });
refreshInstrumentHints();
