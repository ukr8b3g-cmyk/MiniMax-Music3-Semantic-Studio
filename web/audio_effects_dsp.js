const SUPPORTED_EFFECTS = new Set(["gain", "compressor", "limiter", "eq3", "high_pass", "low_pass", "stereo_width"]);
const DEFAULTS = {
  gain: { gain_db: 0 },
  compressor: { threshold_db: -18, ratio: 4, attack_ms: 10, release_ms: 80, makeup_db: 0 },
  limiter: { input_gain_db: 0, ceiling_db: -1, release_ms: 100, lookahead_ms: 1 },
  eq3: { low_db: 0, mid_db: 0, high_db: 0 },
  high_pass: { cutoff_hz: 120, slope_db_oct: 24 },
  low_pass: { cutoff_hz: 16000, slope_db_oct: 24 },
  stereo_width: { width_percent: 100 },
};

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};
export const dbToAmplitude = (db) => Math.pow(10, Number(db || 0) / 20);

function param(effect, key, min, max) {
  const fallback = DEFAULTS[effect?.type]?.[key] ?? 0;
  return clamp(effect?.params?.[key], min, max, fallback);
}

function normalizedBiquad(kind, sampleRate, frequency, { q = 1 / Math.sqrt(2), gainDb = 0 } = {}) {
  const nyquist = Math.max(1, sampleRate / 2);
  const hz = Math.max(5, Math.min(nyquist * .95, Number(frequency) || 5));
  const omega = 2 * Math.PI * hz / sampleRate;
  const cosW = Math.cos(omega);
  const sinW = Math.sin(omega);
  const alpha = sinW / (2 * Math.max(.05, q));
  let b0, b1, b2, a0, a1, a2;

  if (kind === "low_pass") {
    b0 = (1 - cosW) / 2; b1 = 1 - cosW; b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha;
  } else if (kind === "high_pass") {
    b0 = (1 + cosW) / 2; b1 = -(1 + cosW); b2 = b0;
    a0 = 1 + alpha; a1 = -2 * cosW; a2 = 1 - alpha;
  } else if (kind === "peaking") {
    const amp = Math.pow(10, gainDb / 40);
    b0 = 1 + alpha * amp; b1 = -2 * cosW; b2 = 1 - alpha * amp;
    a0 = 1 + alpha / amp; a1 = -2 * cosW; a2 = 1 - alpha / amp;
  } else if (kind === "low_shelf" || kind === "high_shelf") {
    const amp = Math.pow(10, gainDb / 40);
    const shelfAlpha = sinW / 2 * Math.sqrt(2);
    const beta = 2 * Math.sqrt(amp) * shelfAlpha;
    if (kind === "low_shelf") {
      b0 = amp * ((amp + 1) - (amp - 1) * cosW + beta);
      b1 = 2 * amp * ((amp - 1) - (amp + 1) * cosW);
      b2 = amp * ((amp + 1) - (amp - 1) * cosW - beta);
      a0 = (amp + 1) + (amp - 1) * cosW + beta;
      a1 = -2 * ((amp - 1) + (amp + 1) * cosW);
      a2 = (amp + 1) + (amp - 1) * cosW - beta;
    } else {
      b0 = amp * ((amp + 1) + (amp - 1) * cosW + beta);
      b1 = -2 * amp * ((amp - 1) + (amp + 1) * cosW);
      b2 = amp * ((amp + 1) + (amp - 1) * cosW - beta);
      a0 = (amp + 1) - (amp - 1) * cosW + beta;
      a1 = 2 * ((amp - 1) - (amp + 1) * cosW);
      a2 = (amp + 1) - (amp - 1) * cosW - beta;
    }
  } else {
    throw new Error(`Unknown biquad kind: ${kind}`);
  }
  return { b0: b0 / a0, b1: b1 / a0, b2: b2 / a0, a1: a1 / a0, a2: a2 / a0 };
}

function applyBiquad(channels, coeffs) {
  return channels.map((input) => {
    const out = new Float32Array(input.length);
    let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
    const { b0, b1, b2, a1, a2 } = coeffs;
    for (let i = 0; i < input.length; i++) {
      const x0 = Number(input[i]) || 0;
      const y0 = b0 * x0 + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
      out[i] = y0;
      x2 = x1; x1 = x0; y2 = y1; y1 = y0;
    }
    return out;
  });
}

function applyFilter(channels, sampleRate, effect, kind) {
  const cutoff = param(effect, "cutoff_hz", 20, Math.max(20, sampleRate * .475));
  const slope = Math.round(param(effect, "slope_db_oct", 12, 48) / 12) * 12;
  const stages = Math.max(1, Math.min(4, slope / 12));
  const coeffs = normalizedBiquad(kind, sampleRate, cutoff);
  let result = channels;
  for (let i = 0; i < stages; i++) result = applyBiquad(result, coeffs);
  return result;
}

function applyEq3(channels, sampleRate, effect) {
  const low = param(effect, "low_db", -12, 12);
  const mid = param(effect, "mid_db", -12, 12);
  const high = param(effect, "high_db", -12, 12);
  let result = channels;
  if (Math.abs(low) > 1e-9) result = applyBiquad(result, normalizedBiquad("low_shelf", sampleRate, Math.min(200, sampleRate * .18), { gainDb: low }));
  if (Math.abs(mid) > 1e-9) result = applyBiquad(result, normalizedBiquad("peaking", sampleRate, Math.min(1000, sampleRate * .28), { q: .8, gainDb: mid }));
  if (Math.abs(high) > 1e-9) result = applyBiquad(result, normalizedBiquad("high_shelf", sampleRate, Math.min(5000, sampleRate * .40), { gainDb: high }));
  return result;
}

function blockPeaks(channels, blockSize) {
  const length = channels[0]?.length || 0;
  const blocks = Math.max(1, Math.ceil(length / blockSize));
  const peaks = new Float64Array(blocks);
  for (let block = 0; block < blocks; block++) {
    const start = block * blockSize;
    const end = Math.min(length, start + blockSize);
    let peak = 0;
    for (const channel of channels) {
      for (let i = start; i < end; i++) peak = Math.max(peak, Math.abs(Number(channel[i]) || 0));
    }
    peaks[block] = peak;
  }
  return peaks;
}

function applyBlockGains(channels, gains, blockSize) {
  return channels.map((input) => {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * gains[Math.min(gains.length - 1, Math.floor(i / blockSize))];
    return out;
  });
}

function applyCompressor(channels, sampleRate, effect) {
  const threshold = param(effect, "threshold_db", -60, 0);
  const ratio = param(effect, "ratio", 1, 20);
  const attackMs = param(effect, "attack_ms", 1, 200);
  const releaseMs = param(effect, "release_ms", 10, 1000);
  const makeupDb = param(effect, "makeup_db", 0, 24);
  const blockSize = Math.max(1, Math.round(sampleRate * .002));
  const blockSeconds = blockSize / sampleRate;
  const attack = Math.exp(-blockSeconds / Math.max(attackMs / 1000, 1e-6));
  const release = Math.exp(-blockSeconds / Math.max(releaseMs / 1000, 1e-6));
  const peaks = blockPeaks(channels, blockSize);
  const gains = new Float64Array(peaks.length);
  let currentDb = 0;
  for (let i = 0; i < peaks.length; i++) {
    const levelDb = 20 * Math.log10(Math.max(peaks[i], 1e-12));
    const over = Math.max(0, levelDb - threshold);
    const desiredDb = over > 0 ? -(over - over / ratio) : 0;
    const coeff = desiredDb < currentDb ? attack : release;
    currentDb = coeff * currentDb + (1 - coeff) * desiredDb;
    gains[i] = dbToAmplitude(currentDb + makeupDb);
  }
  return applyBlockGains(channels, gains, blockSize);
}

function applyLimiter(channels, sampleRate, effect) {
  const inputGainDb = param(effect, "input_gain_db", 0, 24);
  const ceilingDb = param(effect, "ceiling_db", -20, 0);
  const releaseMs = param(effect, "release_ms", 10, 1000);
  const lookaheadMs = param(effect, "lookahead_ms", 0, 10);
  const inputGain = dbToAmplitude(inputGainDb);
  const driven = channels.map((input) => Float32Array.from(input, (value) => value * inputGain));
  const blockSize = Math.max(1, Math.round(sampleRate * .001));
  const blockMs = blockSize / sampleRate * 1000;
  const lookaheadBlocks = Math.max(0, Math.min(12, Math.ceil(lookaheadMs / Math.max(blockMs, 1e-6))));
  const peaks = blockPeaks(driven, blockSize);
  const future = Float64Array.from(peaks);
  for (let i = 0; i < peaks.length; i++) {
    for (let shift = 1; shift <= lookaheadBlocks && i + shift < peaks.length; shift++) future[i] = Math.max(future[i], peaks[i + shift]);
  }
  const ceilingAmp = dbToAmplitude(ceilingDb);
  const release = Math.exp(-(blockSize / sampleRate) / Math.max(releaseMs / 1000, 1e-6));
  const gains = new Float64Array(future.length);
  let current = 1;
  for (let i = 0; i < future.length; i++) {
    const desired = Math.min(1, ceilingAmp / Math.max(future[i], 1e-12));
    current = desired < current ? desired : release * current + (1 - release) * desired;
    gains[i] = current;
  }
  const limited = applyBlockGains(driven, gains, blockSize);
  for (const channel of limited) for (let i = 0; i < channel.length; i++) channel[i] = Math.max(-ceilingAmp, Math.min(ceilingAmp, channel[i]));
  return limited;
}

function applyStereoWidth(channels, effect) {
  if (channels.length < 2) return channels;
  const width = param(effect, "width_percent", 0, 200) / 100;
  const left = channels[0], right = channels[1];
  const outL = new Float32Array(left.length), outR = new Float32Array(right.length);
  for (let i = 0; i < left.length; i++) {
    const mid = (left[i] + right[i]) * .5;
    const side = (left[i] - right[i]) * .5 * width;
    outL[i] = mid + side;
    outR[i] = mid - side;
  }
  return [outL, outR, ...channels.slice(2)];
}

export function applyEffectChain(channels, sampleRate, effects, owner = "Track") {
  let result = channels;
  for (const effect of Array.isArray(effects) ? effects : []) {
    if (!effect || effect.enabled === false) continue;
    const type = String(effect.type || "");
    if (!SUPPORTED_EFFECTS.has(type)) {
      const label = type || String(effect.id || "unknown");
      throw new Error(`${owner} has enabled unsupported effect '${label}'; V2.1-B supports Gain, Filters, EQ, Compressor, Limiter, and Stereo Width.`);
    }
    if (type === "gain") {
      const gain = dbToAmplitude(param(effect, "gain_db", -24, 24));
      result = result.map((input) => Float32Array.from(input, (value) => value * gain));
    } else if (type === "high_pass" || type === "low_pass") {
      result = applyFilter(result, sampleRate, effect, type);
    } else if (type === "eq3") {
      result = applyEq3(result, sampleRate, effect);
    } else if (type === "compressor") {
      result = applyCompressor(result, sampleRate, effect);
    } else if (type === "limiter") {
      result = applyLimiter(result, sampleRate, effect);
    } else if (type === "stereo_width") {
      result = applyStereoWidth(result, effect);
    }
  }
  return result;
}
