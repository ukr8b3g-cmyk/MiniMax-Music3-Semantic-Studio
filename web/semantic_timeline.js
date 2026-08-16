import { clamp, el, formatTime } from "./semantic_studio_core.js";

const MIN_DURATION = 0.5;

export function sectionTimelineGeometry(sections = []) {
  let cursor = 0;
  return sections.map((section, index) => {
    const duration = Math.max(MIN_DURATION, Number(section?.duration) || MIN_DURATION);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    return { index, section, start, end, center: start + duration / 2, duration };
  });
}

export function fitTimelineScale(width, duration) {
  const available = Math.max(320, Number(width) || 900) - 150;
  return clamp(available / Math.max(Number(duration) || 1, 1), 3, 20);
}

export function resizeSectionDurations(sections, index, requestedDuration, preserveTotal = false) {
  const current = sections?.[index];
  if (!current) return null;
  const original = Math.max(MIN_DURATION, Number(current.duration) || MIN_DURATION);
  let nextDuration = clamp(requestedDuration, MIN_DURATION, 360);
  const next = sections[index + 1] || null;
  let adjustedNext = next ? Math.max(MIN_DURATION, Number(next.duration) || MIN_DURATION) : null;

  if (preserveTotal && next) {
    const originalNext = adjustedNext;
    const requestedDelta = nextDuration - original;
    adjustedNext = clamp(originalNext - requestedDelta, MIN_DURATION, 360);
    const actualDelta = originalNext - adjustedNext;
    nextDuration = clamp(original + actualDelta, MIN_DURATION, 360);
  }

  current.duration = nextDuration;
  if (preserveTotal && next) next.duration = adjustedNext;
  return { current: nextDuration, next: adjustedNext };
}

function summary(text, max = 78) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "—";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function addLabel(column, text, className = "") {
  column.appendChild(el("div", `m3ss-tl-fixed-label ${className}`.trim(), text));
}

function makeRow(stage, className = "") {
  const row = el("div", `m3ss-tl-row ${className}`.trim());
  stage.appendChild(row);
  return row;
}

function placeBlock(row, geometry, total, className, text, selected) {
  const block = el("button", `${className}${selected ? " is-selected" : ""}`, text);
  block.type = "button";
  block.style.left = `${geometry.start / total * 100}%`;
  block.style.width = `${Math.max(0.25, geometry.duration / total * 100)}%`;
  block.dataset.sectionIndex = String(geometry.index);
  row.appendChild(block);
  return block;
}

export function renderSemanticTimeline(container, project, selectedId, {
  pxPerSecond = 7,
  onSelect = null,
  onChange = null,
} = {}) {
  container.replaceChildren();
  const sections = project?.timeline?.sections || [];
  if (!sections.length) {
    container.appendChild(el("div", "m3ss-empty", "Add a section to use Timeline view."));
    return { width: 0, total: 0 };
  }

  const geometry = sectionTimelineGeometry(sections);
  const total = Math.max(MIN_DURATION, geometry.at(-1)?.end || MIN_DURATION);
  const stageWidth = Math.max(620, Math.round(total * clamp(pxPerSecond, 3, 20)));
  const secondsPerPixel = total / stageWidth;

  const shell = el("div", "m3ss-semantic-timeline");
  const labels = el("div", "m3ss-tl-labels");
  const scroll = el("div", "m3ss-tl-scroll");
  const stage = el("div", "m3ss-tl-stage");
  stage.style.width = `${stageWidth}px`;
  scroll.appendChild(stage);
  shell.append(labels, scroll);
  container.appendChild(shell);

  addLabel(labels, "Time", "is-ruler");
  addLabel(labels, "Structure", "is-structure");
  addLabel(labels, "Energy", "is-energy");
  addLabel(labels, "Lyrics", "is-detail");
  addLabel(labels, "Arrangement", "is-detail");
  addLabel(labels, "Vocal", "is-vocal");

  const ruler = makeRow(stage, "m3ss-tl-ruler");
  const tickStep = total > 240 ? 60 : total > 120 ? 30 : total > 60 ? 15 : 10;
  for (let time = 0; time <= total + 0.0001; time += tickStep) {
    const tick = el("span", "m3ss-tl-tick", formatTime(time));
    tick.style.left = `${time / total * 100}%`;
    ruler.appendChild(tick);
  }

  const structure = makeRow(stage, "m3ss-tl-structure-row");
  const lyrics = makeRow(stage, "m3ss-tl-detail-row m3ss-tl-lyrics-row");
  const arrangement = makeRow(stage, "m3ss-tl-detail-row m3ss-tl-arrangement-row");
  const vocal = makeRow(stage, "m3ss-tl-vocal-row");

  const structureBlocks = [];
  const detailRows = [lyrics, arrangement, vocal];
  const detailGetters = [
    (section) => summary(section.lyrics, 62),
    (section) => summary(section.instruments?.join(", ") || section.directives, 62),
    (section) => summary(section.vocal, 42),
  ];
  const detailClasses = ["m3ss-tl-detail-block", "m3ss-tl-detail-block", "m3ss-tl-vocal-block"];

  geometry.forEach((item) => {
    const block = placeBlock(
      structure,
      item,
      total,
      "m3ss-tl-section-block",
      item.section.label || item.section.type,
      item.section.id === selectedId,
    );
    const badge = el("span", "m3ss-tl-duration-badge", `${item.duration.toFixed(1)}s`);
    const resize = el("span", "m3ss-tl-duration-handle");
    resize.title = "Drag to change duration · Shift+drag keeps total length by adjusting the next section";
    block.append(badge, resize);
    block.onclick = () => onSelect?.(item.section.id);
    structureBlocks.push({ block, badge, resize, item });

    detailRows.forEach((row, rowIndex) => {
      const detail = placeBlock(
        row,
        item,
        total,
        detailClasses[rowIndex],
        detailGetters[rowIndex](item.section),
        item.section.id === selectedId,
      );
      detail.onclick = () => onSelect?.(item.section.id);
      detail.title = `${item.section.label || item.section.type} · ${detail.textContent}`;
    });
  });

  for (let index = 0; index < structureBlocks.length; index++) {
    const { block, badge, resize, item } = structureBlocks[index];
    resize.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      const startX = event.clientX;
      const original = Number(item.section.duration) || MIN_DURATION;
      const nextSection = sections[index + 1] || null;
      const originalNext = nextSection ? Number(nextSection.duration) || MIN_DURATION : null;
      let moved = false;
      resize.setPointerCapture?.(event.pointerId);

      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        if (!moved && Math.abs(dx) < 2) return;
        moved = true;
        const requested = original + dx * secondsPerPixel;
        const preserve = !!moveEvent.shiftKey && !!nextSection;
        if (nextSection) nextSection.duration = originalNext;
        item.section.duration = original;
        const result = resizeSectionDurations(sections, index, requested, preserve);
        badge.textContent = `${Number(result.current).toFixed(1)}s`;
        block.style.width = `${Math.max(14, result.current / total * stageWidth)}px`;
        if (preserve && nextSection) {
          const nextBlock = structureBlocks[index + 1]?.block;
          const nextBadge = structureBlocks[index + 1]?.badge;
          if (nextBlock) {
            nextBlock.style.left = `${(item.start + result.current) / total * 100}%`;
            nextBlock.style.width = `${Math.max(14, result.next / total * stageWidth)}px`;
          }
          if (nextBadge) nextBadge.textContent = `${Number(result.next).toFixed(1)}s`;
        }
      };

      const finish = (upEvent) => {
        resize.releasePointerCapture?.(upEvent.pointerId);
        resize.removeEventListener("pointermove", move);
        resize.removeEventListener("pointerup", finish);
        resize.removeEventListener("pointercancel", cancel);
        if (moved) onChange?.({ kind: "duration", section: item.section, index });
      };
      const cancel = (cancelEvent) => {
        item.section.duration = original;
        if (nextSection) nextSection.duration = originalNext;
        resize.releasePointerCapture?.(cancelEvent.pointerId);
        resize.removeEventListener("pointermove", move);
        resize.removeEventListener("pointerup", finish);
        resize.removeEventListener("pointercancel", cancel);
        onChange?.({ kind: "duration-cancel", section: item.section, index });
      };
      resize.addEventListener("pointermove", move);
      resize.addEventListener("pointerup", finish);
      resize.addEventListener("pointercancel", cancel);
    });
  }

  const energyRow = el("div", "m3ss-tl-row m3ss-tl-energy-row");
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("m3ss-tl-energy-svg");
  svg.setAttribute("viewBox", `0 0 ${stageWidth} 88`);
  svg.setAttribute("preserveAspectRatio", "none");
  energyRow.appendChild(svg);
  stage.insertBefore(energyRow, lyrics);

  const yFor = (energy) => 72 - clamp(energy, 0, 1) * 56;
  const xFor = (item) => item.center / total * stageWidth;
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  polyline.setAttribute("class", "m3ss-tl-energy-line");
  const updateEnergyLine = () => {
    polyline.setAttribute("points", geometry.map((item) => `${xFor(item)},${yFor(item.section.energy)}`).join(" "));
  };
  updateEnergyLine();
  svg.appendChild(polyline);

  geometry.forEach((item) => {
    const guide = document.createElementNS("http://www.w3.org/2000/svg", "line");
    guide.setAttribute("class", "m3ss-tl-energy-guide");
    guide.setAttribute("x1", String(xFor(item)));
    guide.setAttribute("x2", String(xFor(item)));
    guide.setAttribute("y1", "12");
    guide.setAttribute("y2", "78");
    svg.appendChild(guide);

    const point = document.createElementNS("http://www.w3.org/2000/svg", "circle");
    point.setAttribute("class", `m3ss-tl-energy-point${item.section.id === selectedId ? " is-selected" : ""}`);
    point.setAttribute("cx", String(xFor(item)));
    point.setAttribute("cy", String(yFor(item.section.energy)));
    point.setAttribute("r", "6");
    point.setAttribute("tabindex", "0");
    const value = document.createElementNS("http://www.w3.org/2000/svg", "text");
    value.setAttribute("class", "m3ss-tl-energy-text");
    value.setAttribute("x", String(xFor(item) + 8));
    value.setAttribute("y", String(yFor(item.section.energy) - 7));
    value.textContent = `${Math.round(clamp(item.section.energy, 0, 1) * 100)}%`;
    svg.append(point, value);

    point.addEventListener("pointerdown", (event) => {
      event.preventDefault();
      event.stopPropagation();
      onSelect?.(item.section.id, { render: false });
      point.setPointerCapture?.(event.pointerId);
      let moved = false;
      const move = (moveEvent) => {
        moved = true;
        const rect = svg.getBoundingClientRect();
        const y = clamp((moveEvent.clientY - rect.top) / Math.max(rect.height, 1) * 88, 12, 78);
        const energy = clamp((72 - y) / 56, 0, 1);
        item.section.energy = energy;
        point.setAttribute("cy", String(yFor(energy)));
        value.setAttribute("y", String(yFor(energy) - 7));
        value.textContent = `${Math.round(energy * 100)}%`;
        updateEnergyLine();
      };
      const up = (upEvent) => {
        point.releasePointerCapture?.(upEvent.pointerId);
        point.removeEventListener("pointermove", move);
        point.removeEventListener("pointerup", up);
        point.removeEventListener("pointercancel", up);
        if (moved) onChange?.({ kind: "energy", section: item.section, index: item.index });
      };
      point.addEventListener("pointermove", move);
      point.addEventListener("pointerup", up);
      point.addEventListener("pointercancel", up);
    });
    point.addEventListener("click", () => onSelect?.(item.section.id));
  });

  return { width: stageWidth, total };
}
