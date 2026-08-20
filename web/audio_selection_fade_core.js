import { commandClipEnd, commandClipDuration, sliceClipToRange } from "./audio_edit_commands.js";

const EPS = 1e-6;
const EDGE_SNAP_SECONDS = 0.05;
const VALID_DIRECTIONS = new Set(["fade_in", "fade_out"]);
const VALID_CURVES = new Set(["linear", "equal_power"]);

function normalizedRange(start, end) {
  const left = Math.max(0, Number(start) || 0);
  const right = Math.max(0, Number(end) || 0);
  return right > left + EPS ? { start: left, end: right } : null;
}

function selectionFadeTargetDetails(track, start, end) {
  const range = normalizedRange(start, end);
  if (!range) return null;
  const clips = track?.clips || [];
  const matches = clips.flatMap((clip) => {
    const clipStart = Math.max(0, Number(clip?.timeline_start) || 0);
    const clipEnd = commandClipEnd(clip);
    if (range.start < clipStart - EPS) return [];

    if (range.end <= clipEnd + EPS) {
      return [{ clip, start: Math.max(range.start, clipStart), end: Math.min(range.end, clipEnd) }];
    }

    const overshoot = range.end - clipEnd;
    if (overshoot > EDGE_SNAP_SECONDS + EPS) return [];

    // A small overshoot is usually caused by the UI showing a rounded clip end
    // (for example 54.988... as 0:55.00). Only snap when the overshoot does not
    // actually enter another clip, so genuine multi-clip selections stay invalid.
    const crossesAnotherClip = clips.some((other) => {
      if (other === clip) return false;
      const otherStart = Math.max(0, Number(other?.timeline_start) || 0);
      const otherEnd = commandClipEnd(other);
      return otherEnd > clipEnd + EPS && otherStart < range.end - EPS && otherEnd > clipEnd + EPS;
    });
    if (crossesAnotherClip) return [];

    return [{ clip, start: Math.max(range.start, clipStart), end: clipEnd }];
  });
  return matches.length === 1 ? matches[0] : null;
}

export function selectionFadeTarget(track, start, end) {
  return selectionFadeTargetDetails(track, start, end)?.clip || null;
}

export function canApplySelectionFade(track, start, end) {
  return !!selectionFadeTargetDetails(track, start, end);
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
  const targetDetails = selectionFadeTargetDetails(track, range.start, range.end);
  const target = targetDetails?.clip || null;
  if (!target) return null;

  const clips = Array.isArray(track?.clips) ? track.clips : null;
  const index = clips?.indexOf(target) ?? -1;
  if (!clips || index < 0) return null;

  const clipStart = Math.max(0, Number(target.timeline_start) || 0);
  const clipEnd = commandClipEnd(target);
  const effectiveStart = targetDetails.start;
  const effectiveEnd = targetDetails.end;
  const left = effectiveStart > clipStart + EPS
    ? sliceClipToRange(target, clipStart, effectiveStart)
    : null;
  const selected = sliceClipToRange(target, effectiveStart, effectiveEnd);
  const right = effectiveEnd < clipEnd - EPS
    ? sliceClipToRange(target, effectiveEnd, clipEnd)
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
