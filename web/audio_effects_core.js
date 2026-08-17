const clone = (value) => JSON.parse(JSON.stringify(value));
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));

const range = (key, label, minimum, maximum, step, unit, defaultValue) => ({
  key, label, kind: "range", minimum, maximum, step, unit, defaultValue,
});
const choice = (key, label, values, defaultValue) => ({ key, label, kind: "select", values, defaultValue });
const toggle = (key, label, defaultValue = false) => ({ key, label, kind: "boolean", defaultValue });

export const EFFECT_CATALOG = Object.freeze([
  {
    type: "gain",
    label: "Gain / Amplify",
    shortLabel: "Gain",
    category: "Level",
    params: [range("gain_db", "Gain", -24, 24, .1, "dB", 0)],
  },
  {
    type: "compressor",
    label: "Compressor",
    category: "Dynamics",
    params: [
      range("threshold_db", "Threshold", -60, 0, .1, "dB", -18),
      range("ratio", "Ratio", 1, 20, .1, ":1", 4),
      range("attack_ms", "Attack", 1, 200, 1, "ms", 10),
      range("release_ms", "Release", 10, 1000, 5, "ms", 80),
      range("makeup_db", "Makeup", 0, 24, .1, "dB", 0),
    ],
  },
  {
    type: "limiter",
    label: "Limiter",
    category: "Dynamics",
    params: [
      range("input_gain_db", "Input Gain", 0, 24, .1, "dB", 0),
      range("ceiling_db", "Ceiling", -20, 0, .1, "dB", -1),
      range("release_ms", "Release", 10, 1000, 5, "ms", 100),
      range("lookahead_ms", "Lookahead", 0, 10, .1, "ms", 1),
    ],
  },
  {
    type: "eq3",
    label: "EQ (3-Band)",
    category: "EQ / Filter",
    params: [
      range("low_db", "Low", -12, 12, .1, "dB", 0),
      range("mid_db", "Mid", -12, 12, .1, "dB", 0),
      range("high_db", "High", -12, 12, .1, "dB", 0),
    ],
  },
  {
    type: "high_pass",
    label: "High-Pass Filter",
    category: "EQ / Filter",
    params: [
      range("cutoff_hz", "Cutoff", 20, 2000, 1, "Hz", 120),
      choice("slope_db_oct", "Slope", [12, 24, 36, 48], 24),
    ],
  },
  {
    type: "low_pass",
    label: "Low-Pass Filter",
    category: "EQ / Filter",
    params: [
      range("cutoff_hz", "Cutoff", 1000, 20000, 10, "Hz", 16000),
      choice("slope_db_oct", "Slope", [12, 24, 36, 48], 24),
    ],
  },
  {
    type: "stereo_width",
    label: "Stereo Width",
    category: "Stereo",
    params: [range("width_percent", "Width", 0, 200, 1, "%", 100)],
  },
  {
    type: "reverb",
    label: "Reverb",
    category: "Space",
    params: [
      range("room_size", "Room Size", 0, 100, 1, "%", 75),
      range("pre_delay_ms", "Pre-delay", 0, 200, 1, "ms", 10),
      range("reverberance", "Reverberance", 0, 100, 1, "%", 50),
      range("damping", "Damping", 0, 100, 1, "%", 50),
      range("tone_low", "Tone Low", 0, 100, 1, "%", 100),
      range("tone_high", "Tone High", 0, 100, 1, "%", 100),
      range("wet_db", "Wet Gain", -24, 6, .1, "dB", -1),
      range("dry_db", "Dry Gain", -24, 6, .1, "dB", -1),
      toggle("wet_only", "Wet Only", false),
    ],
  },
]);

const DEFINITIONS = new Map(EFFECT_CATALOG.map((item) => [item.type, item]));

export function effectDefinition(type) {
  return DEFINITIONS.get(String(type || "")) || null;
}

export function effectCategories() {
  const output = [];
  const seen = new Set();
  for (const effect of EFFECT_CATALOG) {
    if (seen.has(effect.category)) continue;
    seen.add(effect.category);
    output.push(effect.category);
  }
  return output;
}

export function defaultEffectParams(type) {
  const definition = effectDefinition(type);
  if (!definition) return {};
  return Object.fromEntries(definition.params.map((param) => [param.key, clone(param.defaultValue)]));
}

export function createEffect(type, idFactory = null) {
  const definition = effectDefinition(type);
  if (!definition) throw new Error(`Unknown V2.1 effect type: ${type}`);
  const createId = typeof idFactory === "function"
    ? idFactory
    : () => `effect-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return {
    id: String(createId("effect")),
    type: definition.type,
    enabled: false,
    params: defaultEffectParams(definition.type),
  };
}

export function resetEffectParams(effect) {
  if (!effect || typeof effect !== "object") return effect;
  const definition = effectDefinition(effect.type);
  if (!definition) return effect;
  const existing = effect.params && typeof effect.params === "object" ? clone(effect.params) : {};
  const knownKeys = new Set(definition.params.map((param) => param.key));
  const unknown = Object.fromEntries(Object.entries(existing).filter(([key]) => !knownKeys.has(key)));
  effect.params = { ...unknown, ...defaultEffectParams(effect.type) };
  return effect;
}

export function setEffectParam(effect, key, rawValue) {
  if (!effect || typeof effect !== "object") return undefined;
  const definition = effectDefinition(effect.type);
  const param = definition?.params.find((item) => item.key === key);
  if (!param) return undefined;
  effect.params ||= {};
  let value;
  if (param.kind === "boolean") {
    value = !!rawValue;
  } else if (param.kind === "select") {
    const candidate = Number(rawValue);
    value = param.values.includes(candidate) ? candidate : param.defaultValue;
  } else {
    value = clamp(rawValue, param.minimum, param.maximum);
    value = Math.round(value / param.step) * param.step;
    value = Number(value.toFixed(6));
  }
  effect.params[key] = value;
  return value;
}

export function moveEffect(effects, effectId, direction) {
  if (!Array.isArray(effects)) return false;
  const index = effects.findIndex((effect) => effect?.id === effectId);
  if (index < 0) return false;
  const delta = direction < 0 ? -1 : direction > 0 ? 1 : 0;
  const target = index + delta;
  if (!delta || target < 0 || target >= effects.length) return false;
  [effects[index], effects[target]] = [effects[target], effects[index]];
  return true;
}

export function effectOwner(project, owner = "track") {
  if (owner === "master") {
    project.master ||= { effects: [] };
    project.master.effects = Array.isArray(project.master.effects) ? project.master.effects : [];
    return project.master;
  }
  const track = project?.tracks?.[0];
  if (!track) return null;
  track.effects = Array.isArray(track.effects) ? track.effects : [];
  return track;
}
