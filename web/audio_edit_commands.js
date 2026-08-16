const EPS = 1e-6;

export const deepClone = (value) => JSON.parse(JSON.stringify(value));
export const commandClipDuration = (clip) => Math.max(0, Number(clip?.source_out) - Number(clip?.source_in));
export const commandClipEnd = (clip) => Number(clip?.timeline_start || 0) + commandClipDuration(clip);

function trimEnvelope(points, trimLeft, newDuration) {
  if (!Array.isArray(points)) return [];
  const end = trimLeft + newDuration;
  return points
    .filter((point) => Number(point?.time) >= trimLeft - EPS && Number(point?.time) <= end + EPS)
    .map((point) => ({
      time: Math.max(0, Math.min(newDuration, Number(point.time) - trimLeft)),
      gain_db: Number(point.gain_db) || 0,
    }))
    .sort((a, b) => a.time - b.time);
}

/**
 * Return the portion of one immutable-source clip that occupies [start, end) on
 * the edit timeline. Gain/pan/mute/reverse are retained. Fades are retained
 * only at an original clip edge and gain-envelope points are remapped to the
 * sliced clip's local time.
 */
export function sliceClipToRange(clip, start, end) {
  if (!clip || !(end > start)) return null;
  const clipStart = Number(clip.timeline_start) || 0;
  const clipEnd = commandClipEnd(clip);
  const overlapStart = Math.max(start, clipStart);
  const overlapEnd = Math.min(end, clipEnd);
  if (overlapEnd - overlapStart <= EPS) return null;

  const originalDuration = commandClipDuration(clip);
  const trimLeft = overlapStart - clipStart;
  const trimRight = clipEnd - overlapEnd;
  const next = deepClone(clip);

  if (next.reverse) {
    next.source_out = Number(clip.source_out) - trimLeft;
    next.source_in = Number(clip.source_in) + trimRight;
  } else {
    next.source_in = Number(clip.source_in) + trimLeft;
    next.source_out = Number(clip.source_out) - trimRight;
  }
  next.timeline_start = overlapStart;

  const duration = Math.max(0, overlapEnd - overlapStart);
  const fadeIn = deepClone(clip.fade_in || { duration: 0, curve: "linear" });
  const fadeOut = deepClone(clip.fade_out || { duration: 0, curve: "linear" });
  fadeIn.duration = trimLeft > EPS ? 0 : Math.min(Number(fadeIn.duration) || 0, duration);
  fadeOut.duration = trimRight > EPS ? 0 : Math.min(Number(fadeOut.duration) || 0, duration);
  next.fade_in = fadeIn;
  next.fade_out = fadeOut;
  next.gain_envelope = trimEnvelope(clip.gain_envelope, trimLeft, duration);

  // Guard against floating-point drift after source-range arithmetic.
  if (Number(next.source_out) <= Number(next.source_in) + EPS || originalDuration <= 0) return null;
  return next;
}

/** Create an internal clipboard payload from the selected timeline range. */
export function extractTimelineRange(track, start, end) {
  if (!track || !(end > start)) return { duration: 0, clips: [] };
  const clips = [];
  for (const clip of track.clips || []) {
    const sliced = sliceClipToRange(clip, start, end);
    if (!sliced) continue;
    sliced.timeline_start -= start;
    clips.push(sliced);
  }
  clips.sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
  return { duration: end - start, clips };
}

/**
 * Remove [start,end) from a track. ripple=false leaves a silence gap; ripple=true
 * closes the gap by shifting material at/after end to the left.
 */
export function removeTimelineRange(track, start, end, { ripple = false, makeId = null } = {}) {
  if (!track || !(end > start)) return [];
  const out = [];
  const delta = end - start;
  const idFactory = typeof makeId === "function" ? makeId : (() => null);

  for (const clip of track.clips || []) {
    const clipStart = Number(clip.timeline_start) || 0;
    const clipEnd = commandClipEnd(clip);

    if (clipEnd <= start + EPS) {
      out.push(clip);
      continue;
    }
    if (clipStart >= end - EPS) {
      if (ripple) clip.timeline_start = Math.max(0, clipStart - delta);
      out.push(clip);
      continue;
    }

    const left = clipStart < start - EPS ? sliceClipToRange(clip, clipStart, start) : null;
    const right = clipEnd > end + EPS ? sliceClipToRange(clip, end, clipEnd) : null;
    if (left) {
      left.id = clip.id;
      out.push(left);
    }
    if (right) {
      if (left) right.id = idFactory() || `${clip.id}-right`;
      else right.id = clip.id;
      if (ripple) right.timeline_start = Math.max(0, Number(right.timeline_start) - delta);
      out.push(right);
    }
  }

  track.clips = out.sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
  return track.clips;
}

/** Paste internal-clipboard clips at a playhead/timeline position. */
export function pasteTimelineClipboard(track, clipboard, at, { makeId = null } = {}) {
  if (!track || !clipboard || !Array.isArray(clipboard.clips) || !clipboard.clips.length) return [];
  const idFactory = typeof makeId === "function" ? makeId : (() => null);
  const anchor = Math.max(0, Number(at) || 0);
  const pasted = clipboard.clips.map((source, index) => {
    const clip = deepClone(source);
    clip.id = idFactory() || `pasted-${Date.now()}-${index}`;
    clip.timeline_start = anchor + Math.max(0, Number(source.timeline_start) || 0);
    return clip;
  });
  track.clips = [...(track.clips || []), ...pasted].sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
  return pasted;
}
