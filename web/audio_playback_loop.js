const clamp = (value, min, max) => Math.max(min, Math.min(max, Number(value) || 0));

export function normalizeLoopRange(range, duration, minimumLength = .02) {
  if (!range || !(duration > 0)) return null;
  const start = clamp(range.start, 0, duration);
  const end = clamp(range.end, 0, duration);
  if (!(end - start >= minimumLength)) return null;
  return { start, end };
}

export function loopPlaybackJump(currentTime, range, duration, epsilon = .006) {
  const loop = normalizeLoopRange(range, duration);
  if (!loop) return null;
  const current = clamp(currentTime, 0, duration);
  if (current < loop.start - epsilon || current >= loop.end - epsilon) return loop.start;
  return null;
}
