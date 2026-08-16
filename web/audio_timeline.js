import { clamp, clipDuration, clipEnd, el, fmtTime, mainTrack } from "./audio_editor_core.js";

function percent(value, duration) {
  return clamp(value / Math.max(duration, 0.001) * 100, 0, 100);
}

export function renderTimeline(
  container,
  project,
  meta,
  selectedId,
  onSelect,
  begin,
  refresh,
  duration,
  {
    showTakes = false,
    pixelWidth = null,
    scrollSeconds = 0,
    onScrollSeconds = null,
  } = {},
) {
  container.replaceChildren();
  const track = mainTrack(project);
  const takeMap = new Map((meta?.takes || []).map((take) => [take.id, take]));
  const width = Math.max(640, Math.round(Number(pixelWidth) || duration * 28));

  const layout = el("div", "m3ssv2-timeline-layout");
  const labels = el("div", "m3ssv2-timeline-labels");
  const scroll = el("div", "m3ssv2-timeline-scroll");
  const stage = el("div", "m3ssv2-timeline-stage");
  stage.style.width = `${width}px`;
  scroll.appendChild(stage);
  layout.append(labels, scroll);
  container.appendChild(layout);

  function addLabel(text, className = "") {
    labels.appendChild(el("div", `m3ssv2-fixed-label ${className}`.trim(), text));
  }
  function addStageRow(className = "") {
    const row = el("div", `m3ssv2-stage-row ${className}`.trim());
    stage.appendChild(row);
    return row;
  }

  addLabel(track.name || "Main Comp", "is-header");
  const header = addStageRow("is-header");
  header.appendChild(el("span", "m3ssv2-render-plan-label", "Rendered clip plan"));

  addLabel("Main Comp", "is-main");
  const body = addStageRow("m3ssv2-clip-lane");

  for (const clip of track.clips) {
    const source = takeMap.get(clip.source_id);
    const item = el(
      "div",
      `m3ssv2-clip${clip.id === selectedId ? " is-selected" : ""}${clip.muted ? " is-muted" : ""}`,
    );
    item.dataset.clipId = clip.id;
    item.style.left = `${percent(clip.timeline_start, duration)}%`;
    item.style.width = `${Math.max(0.3, clipDuration(clip) / Math.max(duration, 0.001) * 100)}%`;
    item.title = `${source?.name || clip.source_id} · ${fmtTime(clip.timeline_start)}–${fmtTime(clipEnd(clip))}`;
    item.appendChild(el("span", "m3ssv2-clip-title", source?.name || clip.source_id));
    const left = el("span", "m3ssv2-trim-handle left");
    const right = el("span", "m3ssv2-trim-handle right");
    item.append(left, right);
    body.appendChild(item);

    item.addEventListener("pointerdown", (event) => {
      if (event.target === left || event.target === right) return;
      onSelect(clip.id);
      const startX = event.clientX;
      const startTime = Number(clip.timeline_start);
      const rect = body.getBoundingClientRect();
      let started = false;
      item.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        if (!started && Math.abs(dx) < 2) return;
        if (!started) {
          begin();
          started = true;
        }
        clip.timeline_start = Math.max(0, startTime + dx / rect.width * duration);
        item.style.left = `${percent(clip.timeline_start, duration)}%`;
      };
      const up = (upEvent) => {
        item.releasePointerCapture?.(upEvent.pointerId);
        item.removeEventListener("pointermove", move);
        item.removeEventListener("pointerup", up);
        item.removeEventListener("pointercancel", up);
        if (started) refresh();
      };
      item.addEventListener("pointermove", move);
      item.addEventListener("pointerup", up);
      item.addEventListener("pointercancel", up);
    });

    const trim = (side, event) => {
      event.stopPropagation();
      onSelect(clip.id);
      const sourceInfo = takeMap.get(clip.source_id);
      const max = Number(sourceInfo?.duration) || duration;
      const startX = event.clientX;
      const rect = body.getBoundingClientRect();
      const old = {
        source_in: clip.source_in,
        source_out: clip.source_out,
        timeline_start: clip.timeline_start,
      };
      let started = false;
      item.setPointerCapture?.(event.pointerId);
      const move = (moveEvent) => {
        const dx = moveEvent.clientX - startX;
        if (!started && Math.abs(dx) < 2) return;
        if (!started) {
          begin();
          started = true;
        }
        const delta = dx / rect.width * duration;
        if (side === "left") {
          const next = clamp(old.source_in + delta, 0, Number(old.source_out) - 0.01);
          const actual = next - old.source_in;
          clip.source_in = next;
          clip.timeline_start = Math.max(0, old.timeline_start + actual);
        } else {
          clip.source_out = clamp(old.source_out + delta, Number(old.source_in) + 0.01, max);
        }
        item.style.left = `${percent(clip.timeline_start, duration)}%`;
        item.style.width = `${Math.max(0.3, clipDuration(clip) / Math.max(duration, 0.001) * 100)}%`;
      };
      const up = (upEvent) => {
        item.releasePointerCapture?.(upEvent.pointerId);
        item.removeEventListener("pointermove", move);
        item.removeEventListener("pointerup", up);
        item.removeEventListener("pointercancel", up);
        if (started) refresh();
      };
      item.addEventListener("pointermove", move);
      item.addEventListener("pointerup", up);
      item.addEventListener("pointercancel", up);
    };
    left.addEventListener("pointerdown", (event) => trim("left", event));
    right.addEventListener("pointerdown", (event) => trim("right", event));
  }

  if (showTakes) {
    for (const take of meta?.takes || []) {
      addLabel(take.name || take.id, "is-take");
      const row = addStageRow("m3ssv2-take-row");
      const fill = el(
        "div",
        "m3ssv2-source-bar",
        `${take.channels}ch · ${take.sample_rate} Hz · ${Number(take.duration).toFixed(2)} s`,
      );
      fill.style.width = `${Math.min(100, Number(take.duration) / Math.max(duration, 0.001) * 100)}%`;
      row.appendChild(fill);
    }
  }

  let syncing = false;
  const applyScrollSeconds = (seconds) => {
    syncing = true;
    scroll.scrollLeft = clamp(seconds, 0, duration) / Math.max(duration, 0.001) * width;
    requestAnimationFrame(() => { syncing = false; });
  };
  applyScrollSeconds(scrollSeconds);
  scroll.addEventListener("scroll", () => {
    if (syncing) return;
    onScrollSeconds?.(scroll.scrollLeft / Math.max(width, 1) * duration);
  }, { passive: true });

  container._m3ssTimelineSetScrollSeconds = applyScrollSeconds;
  container._m3ssTimelinePixelWidth = width;
}
