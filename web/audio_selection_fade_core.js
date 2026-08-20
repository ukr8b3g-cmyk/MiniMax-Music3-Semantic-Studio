import { commandClipEnd, commandClipDuration, sliceClipToRange, deepClone } from "./audio_edit_commands.js";

const EPS = 1e-6;
const EDGE_SNAP_SECONDS = 0.05;
const VALID_DIRECTIONS = new Set(["fade_in", "fade_out"]);
const VALID_CURVES = new Set(["linear", "equal_power"]);

function normalizedRange(start, end) {
  const left = Math.max(0, Number(start) || 0);
  const right = Math.max(0, Number(end) || 0);
  return right > left + EPS ? { start: left, end: right } : null;
}

function clipStart(clip) {
  return Math.max(0, Number(clip?.timeline_start) || 0);
}

function approxEqual(a, b) {
  return Math.abs(Number(a) - Number(b)) <= EPS;
}

function sameLogicalControls(a, b) {
  return String(a?.source_id || "") === String(b?.source_id || "")
    && !!a?.reverse === !!b?.reverse
    && approxEqual(Number(a?.gain_db) || 0, Number(b?.gain_db) || 0)
    && approxEqual(Number(a?.pan) || 0, Number(b?.pan) || 0)
    && !!a?.muted === !!b?.muted
    && (!Array.isArray(a?.gain_envelope) || a.gain_envelope.length === 0)
    && (!Array.isArray(b?.gain_envelope) || b.gain_envelope.length === 0);
}

function sourceIsContinuous(left, right) {
  if (!!left?.reverse !== !!right?.reverse) return false;
  if (left?.reverse) {
    return approxEqual(Number(left?.source_in), Number(right?.source_out));
  }
  return approxEqual(Number(left?.source_out), Number(right?.source_in));
}

function chainIsContinuous(clips) {
  if (!clips.length) return false;
  for (let index = 1; index < clips.length; index++) {
    const left = clips[index - 1];
    const right = clips[index];
    if (!sameLogicalControls(left, right)) return false;
    if (!approxEqual(commandClipEnd(left), clipStart(right))) return false;
    if (!sourceIsContinuous(left, right)) return false;
  }
  return true;
}

function selectedClipChain(track, range) {
  const clips = [...(track?.clips || [])].sort((a, b) => clipStart(a) - clipStart(b));
  if (!clips.length) return null;

  let effectiveEnd = range.end;
  const finalClip = clips.at(-1);
  const finalEnd = commandClipEnd(finalClip);
  if (effectiveEnd > finalEnd + EPS && effectiveEnd - finalEnd <= EDGE_SNAP_SECONDS + EPS) {
    effectiveEnd = finalEnd;
  }

  const overlapping = clips.filter((clip) => {
    const start = clipStart(clip);
    const end = commandClipEnd(clip);
    return end > range.start + EPS && start < effectiveEnd - EPS;
  });
  if (!overlapping.length) return null;

  const first = overlapping[0];
  const last = overlapping.at(-1);
  const firstStart = clipStart(first);
  const lastEnd = commandClipEnd(last);
  if (range.start < firstStart - EPS) return null;
  if (effectiveEnd > lastEnd + EPS) return null;
  if (!chainIsContinuous(overlapping)) return null;

  return {
    clips: overlapping,
    start: Math.max(range.start, firstStart),
    end: Math.min(effectiveEnd, lastEnd),
  };
}

function selectionFadeTargetDetails(track, start, end) {
  const range = normalizedRange(start, end);
  if (!range) return null;
  return selectedClipChain(track, range);
}

export function selectionFadeTarget(track, start, end) {
  const details = selectionFadeTargetDetails(track, start, end);
  return details?.clips?.length === 1 ? details.clips[0] : details?.clips || null;
}

export function canApplySelectionFade(track, start, end) {
  return !!selectionFadeTargetDetails(track, start, end);
}

function mergedSelectedClip(details) {
  const first = details.clips[0];
  const slices = details.clips
    .map((clip) => sliceClipToRange(clip, details.start, details.end))
    .filter(Boolean);
  if (!slices.length) return null;

  const selected = deepClone(first);
  selected.timeline_start = details.start;
  selected.source_in = Math.min(...slices.map((clip) => Number(clip.source_in)));
  selected.source_out = Math.max(...slices.map((clip) => Number(clip.source_out)));
  selected.gain_envelope = [];
  selected.fade_in = { duration: 0, curve: "linear" };
  selected.fade_out = { duration: 0, curve: "linear" };
  return selected;
}

/**
 * Audacity-style non-destructive fade for one selected timeline range.
 * Contiguous fragments from the same immutable source are treated as one
 * logical clip when their source/timeline continuity and base controls match.
 * This allows fades to reach the true start/end even after prior edits split
 * the source into adjacent fragments, while still rejecting real multi-source
 * or gapped selections.
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
  const details = selectionFadeTargetDetails(track, range.start, range.end);
  if (!details) return null;

  const clips = Array.isArray(track?.clips) ? track.clips : null;
  if (!clips) return null;
  const selectedSet = new Set(details.clips);
  const first = details.clips[0];
  const last = details.clips.at(-1);
  const firstStart = clipStart(first);
  const lastEnd = commandClipEnd(last);

  const left = details.start > firstStart + EPS
    ? sliceClipToRange(first, firstStart, details.start)
    : null;
  const selected = mergedSelectedClip(details);
  const right = details.end < lastEnd - EPS
    ? sliceClipToRange(last, details.end, lastEnd)
    : null;
  if (!selected) return null;

  const idFactory = typeof makeId === "function" ? makeId : (() => null);
  const originalId = String(first.id || "clip");
  if (left) left.id = idFactory() || `${originalId}-left`;
  selected.id = originalId;
  if (right) right.id = idFactory() || `${String(last.id || originalId)}-right`;

  const duration = commandClipDuration(selected);
  if (Math.abs(duration - (details.end - details.start)) > EPS) return null;
  const safeCurve = VALID_CURVES.has(curve) ? curve : "linear";
  if (direction === "fade_in") selected.fade_in = { duration, curve: safeCurve };
  else selected.fade_out = { duration, curve: safeCurve };

  const replacement = [left, selected, right].filter(Boolean);
  track.clips = clips
    .flatMap((clip) => selectedSet.has(clip) ? [] : [clip])
    .concat(replacement)
    .sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
  return selected;
}
