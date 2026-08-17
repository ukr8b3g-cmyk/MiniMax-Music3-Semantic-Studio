export const SNAP_MODES = ["off", "1/4", "1/8", "1/16"];

const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

export function formatClock(seconds, precision = 3) {
  const safePrecision = Math.max(0, Math.min(6, Math.trunc(Number(precision) || 0)));
  const safe = Math.max(0, Number(seconds) || 0);
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe - hours * 3600) / 60);
  const remaining = safe - hours * 3600 - minutes * 60;
  const secondWidth = safePrecision > 0 ? 3 + safePrecision : 2;
  return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${remaining.toFixed(safePrecision).padStart(secondWidth, "0")}`;
}

export function parseClock(value) {
  if (typeof value === "number") return Number.isFinite(value) && value >= 0 ? value : null;
  const text = String(value ?? "").trim();
  if (!text) return null;
  if (/^\d+(?:\.\d+)?$/.test(text)) {
    const seconds = Number(text);
    return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
  }
  const parts = text.split(":").map((part) => part.trim());
  if (parts.length < 2 || parts.length > 3 || parts.some((part) => !/^\d+(?:\.\d+)?$/.test(part))) return null;
  const values = parts.map(Number);
  const seconds = parts.length === 3
    ? values[0] * 3600 + values[1] * 60 + values[2]
    : values[0] * 60 + values[1];
  return Number.isFinite(seconds) && seconds >= 0 ? seconds : null;
}

export function snapIntervalSeconds(bpm, mode) {
  const tempo = Number(bpm);
  if (!(tempo > 0) || !SNAP_MODES.includes(mode) || mode === "off") return 0;
  const quarter = 60 / tempo;
  if (mode === "1/4") return quarter;
  if (mode === "1/8") return quarter / 2;
  if (mode === "1/16") return quarter / 4;
  return 0;
}

export function snapTime(seconds, bpm, mode, maximum = Infinity) {
  const safe = Math.max(0, Number(seconds) || 0);
  const interval = snapIntervalSeconds(bpm, mode);
  const snapped = interval > 0 ? Math.round(safe / interval) * interval : safe;
  return clamp(snapped, 0, Number.isFinite(maximum) ? maximum : Number.MAX_SAFE_INTEGER);
}

export function semanticDisplayValue(value, fallback = "—") {
  const text = String(value ?? "").trim();
  return text || fallback;
}
