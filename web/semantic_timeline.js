import { clamp, el, formatTime, snapSemanticDuration } from "./semantic_studio_core.js";

const MIN_DURATION = 0.5;
const SCALE_MIN = 3;
const SCALE_MAX = 20;
const MAX_ZOOM_FACTOR = 4;

const SECTION_COLORS = {
  Intro: { fill: "#253c6f", border: "#5378c6", accent: "#7fa6ff" },
  Verse: { fill: "#5a3516", border: "#a86622", accent: "#e5a040" },
  "Pre-Chorus": { fill: "#49305f", border: "#8052a8", accent: "#b989df" },
  Chorus: { fill: "#632b2f", border: "#ad4b54", accent: "#ef7179" },
  "Post-Chorus": { fill: "#5d2f52", border: "#a04f8c", accent: "#db78c0" },
  Bridge: { fill: "#403263", border: "#745ca6", accent: "#a58be2" },
  Instrumental: { fill: "#1c4c4d", border: "#3b8183", accent: "#64b8b7" },
  Solo: { fill: "#5b2d5d", border: "#9b529e", accent: "#d27ed5" },
  Outro: { fill: "#334050", border: "#60748c", accent: "#8ba1b8" },
};

export function sectionPalette(type) {
  return SECTION_COLORS[type] || { fill: "#273644", border: "#51697d", accent: "#82a2bd" };
}

export function sectionTimelineGeometry(sections = []) {
  let cursor = 0;
  return sections.map((section, index) => {
    const duration = snapSemanticDuration(section?.duration ?? MIN_DURATION);
    const start = cursor;
    const end = start + duration;
    cursor = end;
    return { index, section, start, end, center: start + duration / 2, duration };
  });
}

export function timelineScaleFactor(value) {
  const normalized = (clamp(value, SCALE_MIN, SCALE_MAX) - SCALE_MIN) / (SCALE_MAX - SCALE_MIN);
  return 1 + normalized * (MAX_ZOOM_FACTOR - 1);
}

export function fitTimelineScale() {
  return SCALE_MIN;
}

export function resizeSectionDurations(sections, index, requestedDuration, preserveTotal = false) {
  const current = sections?.[index];
  if (!current) return null;
  const original = snapSemanticDuration(current.duration ?? MIN_DURATION);
  let nextDuration = snapSemanticDuration(requestedDuration);
  const next = sections[index + 1] || null;
  let adjustedNext = next ? snapSemanticDuration(next.duration ?? MIN_DURATION) : null;
  if (preserveTotal && next) {
    const originalNext = adjustedNext;
    adjustedNext = snapSemanticDuration(originalNext - (nextDuration - original));
    nextDuration = snapSemanticDuration(original + (originalNext - adjustedNext));
  }
  current.duration = nextDuration;
  if (preserveTotal && next) next.duration = adjustedNext;
  return { current: nextDuration, next: adjustedNext };
}

export function collectInstrumentRows(sections = []) {
  const result = [], seen = new Set();
  for (const section of sections) {
    for (const raw of section?.instruments || []) {
      const name = String(raw || "").trim(), key = name.toLowerCase();
      if (!name || seen.has(key)) continue;
      seen.add(key); result.push(name);
    }
  }
  return result;
}

export function sectionHasInstrument(section, instrument) {
  const needle = String(instrument || "").trim().toLowerCase();
  return (section?.instruments || []).some((item) => String(item || "").trim().toLowerCase() === needle);
}

export function toggleSectionInstrument(section, instrument) {
  if (!section || !instrument) return false;
  const values = Array.isArray(section.instruments) ? [...section.instruments] : [];
  const needle = String(instrument).trim().toLowerCase();
  const index = values.findIndex((item) => String(item || "").trim().toLowerCase() === needle);
  if (index >= 0) { values.splice(index, 1); section.instruments = values; return false; }
  values.push(String(instrument).trim()); section.instruments = values; return true;
}

function summary(text, max = 78) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (!clean) return "—";
  return clean.length > max ? `${clean.slice(0, max - 1)}…` : clean;
}

function addLabel(column, text, className = "") {
  const label = el("div", `m3ss-tl-fixed-label ${className}`.trim(), text);
  column.appendChild(label); return label;
}

function makeRow(stage, className = "") {
  const row = el("div", `m3ss-tl-row ${className}`.trim());
  stage.appendChild(row); return row;
}

function applyPalette(node, section) {
  const palette = sectionPalette(section?.type);
  node.style.setProperty("--m3ss-section-fill", palette.fill);
  node.style.setProperty("--m3ss-section-border", palette.border);
  node.style.setProperty("--m3ss-section-accent", palette.accent);
}

function placeBlock(row, item, total, className, text, selected) {
  const block = el("button", `${className}${selected ? " is-selected" : ""}`, text);
  block.type = "button";
  block.style.left = `${item.start / total * 100}%`;
  block.style.width = `${Math.max(.25, item.duration / total * 100)}%`;
  block.dataset.sectionIndex = String(item.index);
  applyPalette(block, item.section);
  row.appendChild(block); return block;
}

export function vocalLabel(value) {
  const clean = String(value || "").trim();
  if (!clean) return "—";
  const key = clean.toLowerCase();
  const aliases = {
    power: "Powerful",
    powerful: "Powerful",
    soft: "Soft",
    fade: "Fade",
    instrumental: "Inst.",
    "hushed hums": "Hushed",
    "soft half-sung half-spoken": "Soft / Half-spoken",
    "soft lead with murmured doubles": "Soft + Doubles",
  };
  if (aliases[key]) return aliases[key];
  const title = clean.replace(/\b\w/g, (char) => char.toUpperCase());
  return title.length > 24 ? `${title.slice(0, 23)}…` : title;
}

export function renderSemanticTimeline(container, project, selectedId, {
  pxPerSecond = 7,
  showInstruments = true,
  onToggleInstruments = null,
  onSelect = null,
  onChange = null,
} = {}) {
  container.replaceChildren();
  const sections = project?.timeline?.sections || [];
  if (!sections.length) {
    container.appendChild(el("div", "m3ss-empty", "Add a section to use Timeline view."));
    return { width: 0, total: 0, zoomFactor: 1 };
  }

  const geometry = sectionTimelineGeometry(sections);
  const total = Math.max(MIN_DURATION, geometry.at(-1)?.end || MIN_DURATION);
  const instruments = collectInstrumentRows(sections);
  const shell = el("div", "m3ss-semantic-timeline"), labels = el("div", "m3ss-tl-labels"), scroll = el("div", "m3ss-tl-scroll"), stage = el("div", "m3ss-tl-stage");
  scroll.appendChild(stage); shell.append(labels, scroll); container.appendChild(shell);

  const visibleWidth = Math.max(240, scroll.clientWidth || container.clientWidth || 620);
  const zoomFactor = timelineScaleFactor(pxPerSecond), stageWidth = Math.max(visibleWidth, Math.round(visibleWidth * zoomFactor)), secondsPerPixel = total / stageWidth;
  stage.style.width = `${stageWidth}px`;

  const selectedGeometry = geometry.find((item) => item.section.id === selectedId);
  if (selectedGeometry) {
    const highlight = el("div", "m3ss-tl-selected-column");
    highlight.style.left = `${selectedGeometry.start / total * 100}%`;
    highlight.style.width = `${Math.max(.25, selectedGeometry.duration / total * 100)}%`;
    applyPalette(highlight, selectedGeometry.section); stage.appendChild(highlight);
  }

  addLabel(labels, "Time", "is-ruler");
  addLabel(labels, "Structure", "is-structure");
  addLabel(labels, "Energy", "is-energy");
  addLabel(labels, "Lyrics", "is-detail");
  addLabel(labels, "Vocal Style", "is-vocal");
  const instrumentLabel = addLabel(labels, `${showInstruments ? "▾" : "▸"} Instruments (${instruments.length})`, "is-instruments");
  instrumentLabel.classList.toggle("is-collapsed", !showInstruments);
  instrumentLabel.title = "Click to show/hide instrument lanes"; instrumentLabel.tabIndex = 0;
  const toggleLabels = () => onToggleInstruments?.(!showInstruments);
  instrumentLabel.addEventListener("click", toggleLabels);
  instrumentLabel.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); toggleLabels(); } });

  const ruler = makeRow(stage, "m3ss-tl-ruler");
  const tickStep = total > 240 ? 60 : total > 120 ? 30 : total > 60 ? 15 : 10;
  for (let time = 0; time <= total + .0001; time += tickStep) {
    const tick = el("span", "m3ss-tl-tick", formatTime(time)); tick.style.left = `${time / total * 100}%`; ruler.appendChild(tick);
  }

  const structure = makeRow(stage, "m3ss-tl-structure-row"), lyrics = makeRow(stage, "m3ss-tl-detail-row m3ss-tl-lyrics-row"), structureBlocks = [];
  for (const item of geometry) {
    const block = placeBlock(structure, item, total, "m3ss-tl-section-block", item.section.label || item.section.type, item.section.id === selectedId);
    const badge = el("span", "m3ss-tl-duration-badge", `${item.duration.toFixed(1)}s`), resize = el("span", "m3ss-tl-duration-handle");
    resize.title = "Drag to change duration · Shift+drag keeps total length by adjusting the next section";
    block.append(badge, resize); block.onclick = () => onSelect?.(item.section.id); structureBlocks.push({ block, badge, resize, item });
    const lyric = placeBlock(lyrics, item, total, "m3ss-tl-detail-block", summary(item.section.lyrics, 62), item.section.id === selectedId);
    lyric.onclick = () => onSelect?.(item.section.id); lyric.title = `${item.section.label || item.section.type} · ${lyric.textContent}`;
  }

  structureBlocks.forEach(({ block, badge, resize, item }, index) => {
    resize.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation();
      const startX = event.clientX, original = snapSemanticDuration(item.section.duration ?? MIN_DURATION), nextSection = sections[index + 1] || null, originalNext = nextSection ? snapSemanticDuration(nextSection.duration ?? MIN_DURATION) : null;
      let moved = false; resize.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX; if (!moved && Math.abs(dx) < 2) return; moved = true;
        const requested = snapSemanticDuration(original + dx * secondsPerPixel), preserve = !!moveEvent.shiftKey && !!nextSection;
        if (nextSection) nextSection.duration = originalNext; item.section.duration = original;
        const result = resizeSectionDurations(sections, index, requested, preserve);
        badge.textContent = `${Number(result.current).toFixed(1)}s`; block.style.width = `${Math.max(14, result.current / total * stageWidth)}px`;
        if (preserve && nextSection) {
          const nextBlock = structureBlocks[index + 1]?.block, nextBadge = structureBlocks[index + 1]?.badge;
          if (nextBlock) { nextBlock.style.left = `${(item.start + result.current) / total * 100}%`; nextBlock.style.width = `${Math.max(14, result.next / total * stageWidth)}px`; }
          if (nextBadge) nextBadge.textContent = `${Number(result.next).toFixed(1)}s`;
        }
      };
      const finish = (upEvent) => { resize.releasePointerCapture?.(upEvent.pointerId); cleanup(); if (moved) onChange?.({ kind: "duration", section: item.section, index }); };
      const cancel = (cancelEvent) => { item.section.duration = original; if (nextSection) nextSection.duration = originalNext; resize.releasePointerCapture?.(cancelEvent.pointerId); cleanup(); onChange?.({ kind: "duration-cancel", section: item.section, index }); };
      const cleanup = () => { resize.removeEventListener("pointermove", move); resize.removeEventListener("pointerup", finish); resize.removeEventListener("pointercancel", cancel); };
      resize.addEventListener("pointermove", move); resize.addEventListener("pointerup", finish); resize.addEventListener("pointercancel", cancel);
    });
  });

  const energyRow = el("div", "m3ss-tl-row m3ss-tl-energy-row"), svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.classList.add("m3ss-tl-energy-svg"); svg.setAttribute("viewBox", `0 0 ${stageWidth} 88`); svg.setAttribute("preserveAspectRatio", "none"); energyRow.appendChild(svg); stage.insertBefore(energyRow, lyrics);
  const yFor = (energy) => 72 - clamp(energy, 0, 1) * 56, xFor = (item) => item.center / total * stageWidth;
  const polyline = document.createElementNS("http://www.w3.org/2000/svg", "polyline"); polyline.setAttribute("class", "m3ss-tl-energy-line"); svg.appendChild(polyline);
  const updateEnergyLine = () => polyline.setAttribute("points", geometry.map((item) => `${xFor(item)},${yFor(item.section.energy)}`).join(" ")); updateEnergyLine();
  for (const item of geometry) {
    const guide = document.createElementNS("http://www.w3.org/2000/svg", "line"); guide.setAttribute("class", "m3ss-tl-energy-guide"); guide.setAttribute("x1", xFor(item)); guide.setAttribute("x2", xFor(item)); guide.setAttribute("y1", "12"); guide.setAttribute("y2", "78"); svg.appendChild(guide);
    const point = document.createElementNS("http://www.w3.org/2000/svg", "circle"), value = document.createElementNS("http://www.w3.org/2000/svg", "text"), palette = sectionPalette(item.section.type);
    point.setAttribute("class", `m3ss-tl-energy-point${item.section.id === selectedId ? " is-selected" : ""}`); point.setAttribute("cx", xFor(item)); point.setAttribute("cy", yFor(item.section.energy)); point.setAttribute("r", "6"); point.setAttribute("tabindex", "0"); point.style.setProperty("--m3ss-section-accent", palette.accent);
    value.setAttribute("class", "m3ss-tl-energy-text"); value.setAttribute("x", xFor(item) + 8); value.setAttribute("y", yFor(item.section.energy) - 7); value.textContent = `${Math.round(clamp(item.section.energy, 0, 1) * 100)}%`; svg.append(point, value);
    point.addEventListener("pointerdown", (event) => {
      event.preventDefault(); event.stopPropagation(); onSelect?.(item.section.id, { render: false }); point.setPointerCapture?.(event.pointerId); let moved = false;
      const move = (moveEvent) => { moved = true; const rect = svg.getBoundingClientRect(), y = clamp((moveEvent.clientY - rect.top) / Math.max(rect.height, 1) * 88, 12, 78), energy = clamp((72 - y) / 56, 0, 1); item.section.energy = energy; point.setAttribute("cy", yFor(energy)); value.setAttribute("y", yFor(energy) - 7); value.textContent = `${Math.round(energy * 100)}%`; updateEnergyLine(); };
      const up = (upEvent) => { point.releasePointerCapture?.(upEvent.pointerId); point.removeEventListener("pointermove", move); point.removeEventListener("pointerup", up); point.removeEventListener("pointercancel", up); if (moved) onChange?.({ kind: "energy", section: item.section, index: item.index }); };
      point.addEventListener("pointermove", move); point.addEventListener("pointerup", up); point.addEventListener("pointercancel", up);
    });
    point.addEventListener("click", () => onSelect?.(item.section.id));
  }

  const vocal = makeRow(stage, "m3ss-tl-vocal-row");
  for (const item of geometry) {
    const cell = placeBlock(vocal, item, total, "m3ss-tl-vocal-block", vocalLabel(item.section.vocal), item.section.id === selectedId);
    cell.onclick = () => onSelect?.(item.section.id);
    cell.title = `${item.section.label || item.section.type} · ${item.section.vocal || "No section vocal style"}`;
  }

  const instrumentHeader = makeRow(stage, "m3ss-tl-instrument-header"), instrumentToggle = el("button", "m3ss-tl-instrument-toggle", `${showInstruments ? "▾" : "▸"} Instruments (${instruments.length})${showInstruments ? " · click cells to toggle" : ""}`);
  instrumentToggle.type = "button"; instrumentToggle.onclick = toggleLabels; instrumentHeader.appendChild(instrumentToggle);
  if (showInstruments) {
    const labelNames = el("div", "m3ss-tl-instrument-labels");
    labelNames.appendChild(el("div", "m3ss-tl-instrument-label-head", `▾ Instruments (${instruments.length})`));
    instrumentLabel.replaceChildren(labelNames);
    for (const instrument of instruments) labelNames.appendChild(el("div", "m3ss-tl-instrument-name", instrument));
    if (!instruments.length) {
      const emptyRow = makeRow(stage, "m3ss-tl-instrument-row is-empty"); emptyRow.appendChild(el("div", "m3ss-tl-instrument-empty", "Add instruments from the Section Inspector to create lanes."));
    } else {
      for (const instrument of instruments) {
        const row = makeRow(stage, "m3ss-tl-instrument-row");
        for (const item of geometry) {
          const active = sectionHasInstrument(item.section, instrument), cell = placeBlock(row, item, total, `m3ss-tl-instrument-cell${active ? " is-active" : ""}`, "", item.section.id === selectedId);
          cell.title = `${item.section.label || item.section.type} · ${instrument}: ${active ? "On" : "Off"}`; cell.setAttribute("aria-pressed", active ? "true" : "false");
          cell.onclick = () => { onSelect?.(item.section.id, { render: false }); toggleSectionInstrument(item.section, instrument); onChange?.({ kind: "instrument", section: item.section, instrument }); };
        }
      }
    }
  } else {
    const summaryRow = makeRow(stage, "m3ss-tl-instrument-summary-row");
    for (const item of geometry) {
      const cell = placeBlock(summaryRow, item, total, "m3ss-tl-instrument-summary", item.section.instruments?.length ? `${item.section.instruments.length} inst.` : "—", item.section.id === selectedId);
      cell.onclick = () => onSelect?.(item.section.id); cell.title = item.section.instruments?.join(", ") || "No instruments";
    }
  }
  return { width: stageWidth, total, zoomFactor, instrumentCount: instruments.length };
}
