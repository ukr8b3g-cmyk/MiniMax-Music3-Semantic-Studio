const EPS = 1e-6;

export const deepClone = (value) => JSON.parse(JSON.stringify(value));
export const commandClipDuration = (clip) => Math.max(0, Number(clip?.source_out) - Number(clip?.source_in));
export const commandClipEnd = (clip) => Number(clip?.timeline_start || 0) + commandClipDuration(clip);

function exactClipForRange(track, start, end) {
  const exact = (track?.clips || []).filter((clip) => {
    const clipStart = Number(clip?.timeline_start) || 0;
    return Math.abs(clipStart - start) <= EPS && Math.abs(commandClipEnd(clip) - end) <= EPS;
  });
  return exact.length === 1 ? exact[0] : null;
}

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

function sortedTrackEnvelope(track) {
  return (Array.isArray(track?.gain_envelope) ? track.gain_envelope : [])
    .map((point) => ({ time: Math.max(0, Number(point?.time) || 0), gain_db: Number(point?.gain_db) || 0 }))
    .sort((a, b) => a.time - b.time);
}

export function trackEnvelopeValueAt(track, time) {
  const points = sortedTrackEnvelope(track);
  if (!points.length) return 0;
  const target = Math.max(0, Number(time) || 0);
  if (target <= points[0].time) return points[0].gain_db;
  if (target >= points.at(-1).time) return points.at(-1).gain_db;
  const exact = points.find((point) => Math.abs(point.time - target) <= 1e-9);
  if (exact) return exact.gain_db;
  for (let index = 0; index < points.length - 1; index++) {
    const left = points[index];
    const right = points[index + 1];
    if (target < left.time - EPS || target > right.time + EPS) continue;
    const span = right.time - left.time;
    if (span <= EPS) return right.gain_db;
    const ratio = (target - left.time) / span;
    return left.gain_db + (right.gain_db - left.gain_db) * ratio;
  }
  return 0;
}

function extractTrackEnvelope(track, start, end) {
  const points = sortedTrackEnvelope(track);
  if (!points.length || !(end > start)) return [];
  const result = [
    { time: 0, gain_db: trackEnvelopeValueAt(track, start) },
    ...points
      .filter((point) => point.time > start + EPS && point.time < end - EPS)
      .map((point) => ({ time: point.time - start, gain_db: point.gain_db })),
    { time: end - start, gain_db: trackEnvelopeValueAt(track, end) },
  ];
  const deduped = new Map();
  for (const point of result) deduped.set(Number(point.time).toFixed(6), point);
  return [...deduped.values()].sort((a, b) => a.time - b.time);
}

function rippleTrackEnvelope(track, start, end) {
  if (!track || !(end > start)) return;
  const points = sortedTrackEnvelope(track);
  if (!points.length) return;
  const delta = end - start;
  const beforeValue = trackEnvelopeValueAt(track, start);
  const afterValue = trackEnvelopeValueAt(track, end);
  const output = [];
  for (const point of points) {
    if (point.time < start - EPS) output.push(point);
    else if (point.time > end + EPS) output.push({ ...point, time: Math.max(0, point.time - delta) });
  }
  // A tiny pair preserves a deliberate level discontinuity at the edit boundary.
  if (start > EPS && Math.abs(beforeValue - afterValue) > 1e-4) {
    output.push({ time: Math.max(0, start - .000001), gain_db: beforeValue });
  }
  output.push({ time: Math.max(0, start), gain_db: afterValue });
  const deduped = new Map();
  for (const point of output) deduped.set(Number(point.time).toFixed(6), point);
  track.gain_envelope = [...deduped.values()].sort((a, b) => a.time - b.time);
}

function pasteTrackEnvelope(track, envelope, at) {
  if (!track || !Array.isArray(envelope) || !envelope.length) return;
  const output = sortedTrackEnvelope(track);
  for (const point of envelope) output.push({ time: Math.max(0, at + Number(point.time || 0)), gain_db: Number(point.gain_db) || 0 });
  const deduped = new Map();
  for (const point of output) deduped.set(Number(point.time).toFixed(6), point);
  track.gain_envelope = [...deduped.values()].sort((a, b) => a.time - b.time);
}

/**
 * Return the portion of one immutable-source clip that occupies [start, end) on
 * the edit timeline. Gain/pan/mute/reverse are retained. Fades are retained
 * only at an original clip edge and legacy clip-envelope points are remapped.
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

  if (Number(next.source_out) <= Number(next.source_in) + EPS || originalDuration <= 0) return null;
  return next;
}

/** Create an internal clipboard payload from a selected range or an exact clip span. */
export function extractTimelineRange(track, start, end) {
  if (!track || !(end > start)) return { duration: 0, clips: [], track_envelope: [] };
  const exact = exactClipForRange(track, start, end);
  const sourceClips = exact ? [exact] : (track.clips || []);
  const clips = [];
  for (const clip of sourceClips) {
    const sliced = sliceClipToRange(clip, start, end);
    if (!sliced) continue;
    sliced.timeline_start -= start;
    clips.push(sliced);
  }
  clips.sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
  return { duration: end - start, clips, track_envelope: extractTrackEnvelope(track, start, end) };
}

/**
 * Remove [start,end) from a track. Exact clip-span deletion protects overlapping
 * crossfade material. Ripple deletion also shifts full-track envelope points.
 */
export function removeTimelineRange(track, start, end, { ripple = false, makeId = null } = {}) {
  if (!track || !(end > start)) return [];
  const delta = end - start;
  const exact = exactClipForRange(track, start, end);
  if (exact) {
    const out = [];
    for (const clip of track.clips || []) {
      if (clip === exact) continue;
      if (ripple && Number(clip.timeline_start) >= end - EPS) clip.timeline_start = Math.max(0, Number(clip.timeline_start) - delta);
      out.push(clip);
    }
    track.clips = out.sort((a, b) => Number(a.timeline_start) - Number(b.timeline_start));
    if (ripple) rippleTrackEnvelope(track, start, end);
    return track.clips;
  }

  const out = [];
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
  if (ripple) rippleTrackEnvelope(track, start, end);
  return track.clips;
}

/** Paste internal-clipboard clips and copied track automation at a timeline position. */
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
  pasteTrackEnvelope(track, clipboard.track_envelope, anchor);
  return pasted;
}
