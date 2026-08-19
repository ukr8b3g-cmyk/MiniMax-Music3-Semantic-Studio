import { commandClipEnd, commandClipDuration, sliceClipToRange } from "./audio_edit_commands.js";

const EPS = 1e-6;
const VALID_DIRECTIONS = new Set(["fade_in", "fade_out"]);
const VALID_CURVES = new Set(["linear", "equal_power"]);

function normalizedRange(start, end) {
  const left = Math.max(0, Number(start) || 0);
  const right = Math.max(0, Number(end) || 0);
  return right > left + EPS ? { start: left, end: right } : null;
}

export function selectionFadeTarget(track, start, end) {
  const range = normalizedRange(start, end);
  if (!range) return null;
  const matches = (track?.clips || []).filter((clip) => {
    const clipStart = Math.max(0, Number(clip?.timeline_start) || 0);
    const clipEnd = commandClipEnd(clip);
    return range.start >= clipStart - EPS && range.end <= clipEnd + EPS;
  });
  return matches.length === 1 ? matches[0] : null;
}

export function canApplySelectionFade(track, start, end) {
  return !!selectionFadeTarget(track, start, end);
}

/**
 * Audacity-style non-destructive fade for one selected timeline range.
 * The selected range is carved into its own clip segment and the existing
 * clip.fade_in / clip.fade_out engine is applied across the whole selection.
 * Browser Draft and queued Python rendering therefore stay on the same path.
 */
export function applySelectionFade(
  track,
  start,
  end,
  direction,
  { curve = "linear", makeId = null } = {},
) {
  const range = normalizedRange(start, end);
  if (!range || !VALID_DIRECTIONS.has(direction)) return null;
  const target = selectionFadeTarget(track, range.start, range.end);
  if (!target) return null;

  const clips = Array.isArray(track?.clips) ? track.clips : null;
  const index = clips?.indexOf(target) ?? -1;
  if (!clips || index < 0) return null;

  const clipStart = Math.max(0, Number(target.timeline_start) || 0);
  const clipEnd = commandClipEnd(target);
  const left = range.start > clipStart + EPS
    ? sliceClipToRange(target, clipStart, range.start)
    : null;
  const selected = sliceClipToRange(target, range.start, range.end);
  const right = range.end < clipEnd - EPS
    ? sliceClipToRange(target, range.end, clipEnd)
    : null;
  if (!selected) return null;

  const idFactory = typeof makeId === "function" ? makeId : (() => null);
  const originalId = String(target.id || "clip");
  if (left) left.id = idFactory() || `${originalId}-left`;
  selected.id = originalId;
  if (right) right.id = idFactory() || `${originalId}-right`;

  const duration = commandClipDuration(selected);
  const safeCurve = VALID_CURVES.has(curve) ? curve : "linear";
  if (direction === "fade_in") selected.fade_in = { duration, curve: safeCurve };
  else selected.fade_out = { duration, curve: safeCurve };

  clips.splice(index, 1, ...[left, selected, right].filter(Boolean));
  clips.sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
  return selected;
}
