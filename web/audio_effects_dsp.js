const SUPPORTED_EFFECTS = new Set([
  "gain", "compressor", "limiter", "eq3", "high_pass", "low_pass",
  "stereo_width", "reverb", "delay",
]);
const DEFAULTS = {
  gain: { gain_db: 0 },
  compressor: { threshold_db: -18, ratio: 4, attack_ms: 10, release_ms: 80, makeup_db: 0 },
  limiter: { input_gain_db: 0, ceiling_db: -1, release_ms: 100, lookahead_ms: 1 },
  eq3: { low_db: 0, mid_db: 0, high_db: 0 },
  high_pass: { cutoff_hz: 120, slope_db_oct: 24 },
  low_pass: { cutoff_hz: 16000, slope_db_oct: 24 },
  stereo_width: { width_percent: 100 },
  reverb: {
    room_size: 75, pre_delay_ms: 10, reverberance: 50, damping: 50,
    tone_low: 100, tone_high: 100, wet_db: -1, dry_db: -1, wet_only: false,
  },
  delay: { delay_ms: 350, feedback_percent: 35, wet_db: -6, dry_db: 0, ping_pong: false },
};

// Delay spacing follows the well-tested STK FreeVerb tuning (MIT). The browser
// implementation is a deterministic Schroeder-style companion to the Python
// offline renderer rather than a source copy of STK FreeVerb.
const REVERB_COMB_DELAYS_44K = [1617, 1557, 1491, 1422, 1356, 1277, 1188, 1116];
const REVERB_COMB_SIGNS = [1, -1, 1, 1, -1, 1, -1, 1];
const REVERB_STEREO_SPREAD_44K = 23;
const MAX_REVERB_TAIL_SECONDS = 12;
const MAX_DELAY_TAIL_SECONDS = 30;
const MAX_CHAIN_TAIL_SECONDS = 45;
const REVERB_INPUT_SCALE = .12;
const REVERB_EARLY_FRACTIONS = [.17, .29, .43, .61, .79];
const REVERB_EARLY_GAINS = [.26, -.20, .16, -.13, .10];
const REVERB_KERNEL_CACHE = new Map();

const clamp = (value, min, max, fallback = min) => {
  const number = Number(value);
  return Math.max(min, Math.min(max, Number.isFinite(number) ? number : fallback));
};
export const dbToAmplitude = (db) => Math.pow(10, Number(db || 0) / 20);

function param(effect, key, min, max) {
  const fallback = Number(DEFAULTS[effect?.type]?.[key] ?? 0);
  return clamp(effect?.params?.[key], min, max, fallback);
}

function boolParam(effect, key) {
  const fallback = !!DEFAULTS[effect?.type]?.[key];
  return effect?.params?.[key] == null ? fallback : !!effect.params[key];
}

function reverbDecaySeconds(effect) {
  const reverberance = param(effect, "reverberance", 0, 100) / 100;
  return .35 + Math.pow(reverberance, 1.55) * (MAX_REVERB_TAIL_SECONDS - .35);
}

export function effectTailSamples(effect, sampleRate) {
  if (!effect || typeof effect !== "object" || effect.enabled === false) return 0;
  const sr = Math.max(1, Math.round(Number(sampleRate) || 1));
  const type = String(effect.type || "");
  if (type === "reverb") {
    const preDelay = param(effect, "pre_delay_ms", 0, 200) / 1000;
    const seconds = Math.min(MAX_REVERB_TAIL_SECONDS + .2, preDelay + reverbDecaySeconds(effect));
    return Math.max(1, Math.ceil(seconds * sr));
  }
  if (type === "delay") {
    const delaySeconds = param(effect, "delay_ms", 10, 2000) / 1000;
    const feedback = param(effect, "feedback_percent", 0, 90) / 100;
    const repeats = feedback <= 1e-9
      ? 1
      : Math.max(1, Math.ceil(Math.log(.001) / Math.log(feedback)) + 1);
    return Math.max(1, Math.ceil(Math.min(MAX_DELAY_TAIL_SECONDS, delaySeconds * repeats) * sr));
  }
  return 0;
}

export function effectChainTailSamples(effects, sampleRate) {
  if (!Array.isArray(effects)) return 0;
  const sr = Math.max(1, Math.round(Number(sampleRate) || 1));
  const limit = Math.ceil(MAX_CHAIN_TAIL_SECONDS * sr);
  let total = 0;
  for (const effect of effects) {
    total += effectTailSamples(effect, sr);
    if (total >= limit) return limit;
  }
  return total;
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

function applyDelay(channels, sampleRate, effect) {
  const delaySamples = Math.max(1, Math.round(sampleRate * param(effect, "delay_ms", 10, 2000) / 1000));
  const feedback = param(effect, "feedback_percent", 0, 90) / 100;
  const wetGain = dbToAmplitude(param(effect, "wet_db", -60, 6));
  const dryGain = dbToAmplitude(param(effect, "dry_db", -60, 6));
  const pingPong = boolParam(effect, "ping_pong") && channels.length >= 2;
  const wet = channels.map((input) => new Float32Array(input.length));
  const length = channels[0]?.length || 0;

  if (pingPong) {
    for (let i = delaySamples; i < length; i++) {
      wet[0][i] = channels[1][i - delaySamples] + feedback * wet[1][i - delaySamples];
      wet[1][i] = channels[0][i - delaySamples] + feedback * wet[0][i - delaySamples];
    }
    for (let channel = 2; channel < channels.length; channel++) {
      for (let i = delaySamples; i < length; i++) wet[channel][i] = channels[channel][i - delaySamples] + feedback * wet[channel][i - delaySamples];
    }
  } else {
    for (let channel = 0; channel < channels.length; channel++) {
      const input = channels[channel], output = wet[channel];
      for (let i = delaySamples; i < length; i++) output[i] = input[i - delaySamples] + feedback * output[i - delaySamples];
    }
  }

  return channels.map((input, channel) => {
    const out = new Float32Array(input.length);
    for (let i = 0; i < input.length; i++) out[i] = input[i] * dryGain + wet[channel][i] * wetGain;
    return out;
  });
}

function reverbRoomScale(roomSize) {
  return .65 + roomSize / 100 * .85;
}

function reverbDampingCutoff(sampleRate, damping) {
  const nyquistSafe = sampleRate * .45;
  const openHz = Math.min(18000, nyquistSafe);
  const darkHz = Math.min(2400, nyquistSafe);
  return Math.max(40, openHz * Math.pow(Math.max(darkHz / Math.max(openHz, 1), 1e-4), damping / 100));
}

function reverbToneGain(percent) {
  return -12 * (1 - percent / 100);
}

function reverbKernel(effect, sampleRate) {
  const roomSize = param(effect, "room_size", 0, 100);
  const preDelayMs = param(effect, "pre_delay_ms", 0, 200);
  const reverberance = param(effect, "reverberance", 0, 100);
  const cacheKey = `${Math.round(sampleRate)}:${roomSize.toFixed(2)}:${preDelayMs.toFixed(2)}:${reverberance.toFixed(2)}`;
  const cached = REVERB_KERNEL_CACHE.get(cacheKey);
  if (cached) return cached;
  const tailSamples = effectTailSamples(effect, sampleRate);
  const decaySamples = Math.max(1, Math.round(reverbDecaySeconds(effect) * sampleRate));
  const preDelaySamples = Math.max(0, Math.round(preDelayMs * sampleRate / 1000));
  const roomScale = reverbRoomScale(roomSize);
  const fsScale = sampleRate / 44100;
  const spread = Math.max(1, Math.round(REVERB_STEREO_SPREAD_44K * fsScale * roomScale));
  const earlySpan = Math.max(1, Math.round(sampleRate * (.012 + .085 * roomSize / 100)));
  const irL = new Float32Array(tailSamples + 1);
  const irR = new Float32Array(tailSamples + 1);
  const early = [];

  for (let index = 0; index < REVERB_EARLY_FRACTIONS.length; index++) {
    const position = preDelaySamples + Math.max(1, Math.round(earlySpan * REVERB_EARLY_FRACTIONS[index]));
    if (position > tailSamples) continue;
    const gain = REVERB_EARLY_GAINS[index];
    const gainL = gain * (index % 2 === 0 ? 1 : .72);
    const gainR = gain * (index % 2 === 0 ? .72 : 1);
    irL[position] += gainL;
    irR[position] += gainR;
    early.push({ position, gainL, gainR });
  }

  const combsL = [], combsR = [];
  for (let combIndex = 0; combIndex < REVERB_COMB_DELAYS_44K.length; combIndex++) {
    const delayL = Math.max(1, Math.round(REVERB_COMB_DELAYS_44K[combIndex] * fsScale * roomScale));
    const delayR = Math.max(1, delayL + spread);
    const sign = REVERB_COMB_SIGNS[combIndex];
    for (const [channel, delay] of [[0, delayL], [1, delayR]]) {
      const feedback = Math.pow(.001, delay / decaySamples);
      let amplitude = REVERB_INPUT_SCALE * sign;
      for (let position = preDelaySamples + delay; position <= tailSamples && Math.abs(amplitude) > 1e-5; position += delay) {
        (channel === 0 ? irL : irR)[position] += amplitude;
        amplitude *= feedback;
      }
      (channel === 0 ? combsL : combsR).push({ delay, feedback, sign });
    }
  }

  let energyL = 0, energyR = 0;
  for (let i = 0; i < irL.length; i++) {
    energyL += irL[i] * irL[i];
    energyR += irR[i] * irR[i];
  }
  const scaleL = .45 / Math.sqrt(Math.max(energyL, 1e-12));
  const scaleR = .45 / Math.sqrt(Math.max(energyR, 1e-12));
  const kernel = { preDelaySamples, early, combsL, combsR, scaleL, scaleR };
  if (REVERB_KERNEL_CACHE.size >= 24) REVERB_KERNEL_CACHE.delete(REVERB_KERNEL_CACHE.keys().next().value);
  REVERB_KERNEL_CACHE.set(cacheKey, kernel);
  return kernel;
}

function processReverbChannel(mono, kernel, channel) {
  const out = new Float32Array(mono.length);
  const combs = channel === 0 ? kernel.combsL : kernel.combsR;
  const scale = channel === 0 ? kernel.scaleL : kernel.scaleR;
  const pre = kernel.preDelaySamples;

  for (const comb of combs) {
    const buffer = new Float32Array(comb.delay);
    let pointer = 0;
    const combScale = REVERB_INPUT_SCALE * comb.sign * scale;
    for (let i = 0; i < mono.length; i++) {
      const delayed = buffer[pointer];
      const sourceIndex = i - pre;
      const input = sourceIndex >= 0 ? mono[sourceIndex] : 0;
      buffer[pointer] = input + delayed * comb.feedback;
      out[i] += delayed * combScale;
      pointer++;
      if (pointer === comb.delay) pointer = 0;
    }
  }

  for (const reflection of kernel.early) {
    const gain = (channel === 0 ? reflection.gainL : reflection.gainR) * scale;
    for (let i = reflection.position; i < mono.length; i++) out[i] += mono[i - reflection.position] * gain;
  }
  return out;
}

function applyReverbTone(channels, sampleRate, effect) {
  const damping = param(effect, "damping", 0, 100);
  const toneLow = param(effect, "tone_low", 0, 100);
  const toneHigh = param(effect, "tone_high", 0, 100);
  let result = channels;
  const cutoff = reverbDampingCutoff(sampleRate, damping);
  if (cutoff < sampleRate * .44) result = applyBiquad(result, normalizedBiquad("low_pass", sampleRate, cutoff, { q: .707 }));
  const lowGain = reverbToneGain(toneLow);
  const highGain = reverbToneGain(toneHigh);
  if (Math.abs(lowGain) > 1e-9) result = applyBiquad(result, normalizedBiquad("low_shelf", sampleRate, Math.min(250, sampleRate * .18), { gainDb: lowGain }));
  if (Math.abs(highGain) > 1e-9) result = applyBiquad(result, normalizedBiquad("high_shelf", sampleRate, Math.min(6000, sampleRate * .40), { gainDb: highGain }));
  return result;
}

function applyReverb(channels, sampleRate, effect) {
  const length = channels[0]?.length || 0;
  if (!length) return channels;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i++) {
    let value = 0;
    for (const channel of channels) value += Number(channel[i]) || 0;
    mono[i] = value / channels.length;
  }
  const kernel = reverbKernel(effect, sampleRate);
  const wetL = processReverbChannel(mono, kernel, 0);
  const wetR = processReverbChannel(mono, kernel, 1);
  let wet = channels.length === 1
    ? [Float32Array.from(wetL, (value, i) => (value + wetR[i]) * .5)]
    : [wetL, wetR, ...channels.slice(2).map(() => new Float32Array(length))];
  wet = applyReverbTone(wet, sampleRate, effect);

  const wetGain = dbToAmplitude(param(effect, "wet_db", -24, 6));
  const dryGain = boolParam(effect, "wet_only") ? 0 : dbToAmplitude(param(effect, "dry_db", -24, 6));
  return channels.map((input, channel) => {
    const out = new Float32Array(length);
    const wetChannel = wet[Math.min(channel, wet.length - 1)];
    for (let i = 0; i < length; i++) out[i] = input[i] * dryGain + (wetChannel?.[i] || 0) * wetGain;
    return out;
  });
}

function applySingleEffect(channels, sampleRate, effect, owner) {
  const type = String(effect?.type || "");
  if (!SUPPORTED_EFFECTS.has(type)) {
    const label = type || String(effect?.id || "unknown");
    throw new Error(`${owner} has enabled unsupported effect '${label}'; V2.1-C supports Gain, Filters, EQ, Compressor, Limiter, Stereo Width, Reverb, and Delay.`);
  }
  if (type === "gain") {
    const gain = dbToAmplitude(param(effect, "gain_db", -24, 24));
    return channels.map((input) => Float32Array.from(input, (value) => value * gain));
  }
  if (type === "high_pass" || type === "low_pass") return applyFilter(channels, sampleRate, effect, type);
  if (type === "eq3") return applyEq3(channels, sampleRate, effect);
  if (type === "compressor") return applyCompressor(channels, sampleRate, effect);
  if (type === "limiter") return applyLimiter(channels, sampleRate, effect);
  if (type === "stereo_width") return applyStereoWidth(channels, effect);
  if (type === "delay") return applyDelay(channels, sampleRate, effect);
  if (type === "reverb") return applyReverb(channels, sampleRate, effect);
  return channels;
}

export function applyEffectChain(channels, sampleRate, effects, owner = "Track") {
  let result = channels;
  for (const effect of Array.isArray(effects) ? effects : []) {
    if (!effect || effect.enabled === false) continue;
    result = applySingleEffect(result, sampleRate, effect, owner);
  }
  return result;
}
