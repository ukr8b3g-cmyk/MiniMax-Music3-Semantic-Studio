const EPS = 1e-9;

export const dbToAmplitude = (db) => Math.pow(10, Number(db || 0) / 20);
const clamp = (value, minimum, maximum) => Math.max(minimum, Math.min(maximum, Number(value) || 0));
const secondsToSample = (seconds, sampleRate) => Math.max(0, Math.round(Number(seconds || 0) * sampleRate));
const clipDuration = (clip) => Math.max(0, Number(clip?.source_out || 0) - Number(clip?.source_in || 0));
const clipEnd = (clip) => Math.max(0, Number(clip?.timeline_start || 0)) + clipDuration(clip);

function normalizedEnvelopePoints(points, duration, zeroAnchors) {
  const map = new Map();
  if (zeroAnchors) map.set("0.000000000", { time: 0, gain_db: 0 });
  for (const raw of Array.isArray(points) ? points : []) {
    const time = clamp(raw?.time, 0, duration);
    map.set(time.toFixed(9), { time, gain_db: clamp(raw?.gain_db, -60, 24) });
  }
  if (zeroAnchors) map.set(duration.toFixed(9), { time: duration, gain_db: 0 });
  return [...map.values()].sort((a, b) => a.time - b.time);
}

/** Build a sample-accurate dB-linear amplitude curve. */
export function buildEnvelopeAmplitude(length, sampleRate, points, { zeroAnchors = false } = {}) {
  if (!(length > 0) || !Array.isArray(points) || !points.length) return null;
  const duration = length / sampleRate;
  const ordered = normalizedEnvelopePoints(points, duration, zeroAnchors);
  if (!ordered.length) return null;

  const out = new Float32Array(length);
  if (ordered.length === 1) {
    out.fill(dbToAmplitude(ordered[0].gain_db));
    return out;
  }

  const firstSample = Math.min(length, secondsToSample(ordered[0].time, sampleRate));
  out.fill(dbToAmplitude(ordered[0].gain_db), 0, firstSample);

  for (let index = 0; index < ordered.length - 1; index++) {
    const startPoint = ordered[index];
    const endPoint = ordered[index + 1];
    const start = Math.min(length, secondsToSample(startPoint.time, sampleRate));
    const end = Math.min(length, secondsToSample(endPoint.time, sampleRate));
    const count = end - start;
    if (count <= 0) continue;
    for (let offset = 0; offset < count; offset++) {
      const ratio = count === 1 ? 0 : offset / (count - 1);
      const db = startPoint.gain_db + (endPoint.gain_db - startPoint.gain_db) * ratio;
      out[start + offset] = dbToAmplitude(db);
    }
  }

  const last = ordered.at(-1);
  const lastSample = Math.min(length, secondsToSample(last.time, sampleRate));
  out.fill(dbToAmplitude(last.gain_db), lastSample);
  return out;
}

function fadeAmplitude(index, length, fadeIn, fadeOut) {
  let value = 1;
  const apply = (position, samples, curve, isIn) => {
    if (samples <= 0 || position < 0 || position >= samples) return 1;
    if (samples === 1) return isIn ? 1 : 0;
    const x = position / (samples - 1);
    if (curve === "equal_power") return isIn ? Math.sin(x * Math.PI / 2) : Math.cos(x * Math.PI / 2);
    return isIn ? x : 1 - x;
  };
  if (fadeIn.samples > 0 && index < fadeIn.samples) value *= apply(index, fadeIn.samples, fadeIn.curve, true);
  const fadeOutPosition = index - (length - fadeOut.samples);
  if (fadeOut.samples > 0 && fadeOutPosition >= 0) value *= apply(fadeOutPosition, fadeOut.samples, fadeOut.curve, false);
  return value;
}

function applyPan(left, right, pan) {
  if (pan > EPS) return [left * (1 - pan), right];
  if (pan < -EPS) return [left, right * (1 + pan)];
  return [left, right];
}

function assertSourceCompatibility(sources) {
  const primary = sources?.["take-1"];
  if (!primary) throw new Error("Draft preview requires take-1.");
  const sampleRate = Number(primary.sampleRate);
  const channels = primary.channels?.length || 0;
  if (!(sampleRate > 0) || !channels) throw new Error("take-1 draft source is invalid.");
  for (const [id, source] of Object.entries(sources)) {
    if (Number(source.sampleRate) !== sampleRate) throw new Error(`${id} sample rate differs from take-1.`);
    if ((source.channels?.length || 0) !== channels) throw new Error(`${id} channel layout differs from take-1.`);
  }
  return { primary, sampleRate, channelCount: channels };
}

function activeEffects(effects) {
  return (Array.isArray(effects) ? effects : []).filter((effect) => effect && effect.enabled !== false);
}

function assertEffectsDisabled(owner, effects) {
  const enabled = activeEffects(effects);
  if (enabled.length) throw new Error(`${owner} has enabled V2.1 effects that Draft Preview cannot render yet.`);
}

function timelineDuration(project) {
  let duration = 0;
  for (const track of project?.tracks || []) for (const clip of track?.clips || []) duration = Math.max(duration, clipEnd(clip));
  return Math.max(duration, 1 / 48000);
}

/**
 * Deterministic browser Draft renderer. `sources` is a map of
 * `{sampleRate, channels: Float32Array[]}`. The result mirrors Python render order.
 */
export function renderDraftProject(project, sources) {
  const { sampleRate, channelCount } = assertSourceCompatibility(sources);
  const duration = timelineDuration(project);
  const outputSamples = Math.max(1, secondsToSample(duration, sampleRate));
  const mixed = Array.from({ length: channelCount }, () => new Float32Array(outputSamples));
  const tracks = Array.isArray(project?.tracks) ? project.tracks : [];
  const anySolo = tracks.some((track) => !!track?.solo);

  for (const track of tracks) {
    if (track?.muted || (anySolo && !track?.solo)) continue;
    assertEffectsDisabled(`Track ${track?.name || track?.id || ""}`, track?.effects);
    const trackMix = Array.from({ length: channelCount }, () => new Float32Array(outputSamples));

    for (const clip of track?.clips || []) {
      if (clip?.muted) continue;
      const source = sources[clip.source_id];
      if (!source) throw new Error(`Clip ${clip.id || ""} references unavailable source ${clip.source_id}.`);
      const sourceStart = Math.min(source.channels[0].length, secondsToSample(clip.source_in, sampleRate));
      const sourceEnd = Math.min(source.channels[0].length, secondsToSample(clip.source_out, sampleRate));
      const length = sourceEnd - sourceStart;
      if (length <= 0) continue;
      const timelineStart = secondsToSample(clip.timeline_start, sampleRate);
      const clipEnvelope = buildEnvelopeAmplitude(length, sampleRate, clip.gain_envelope || [], { zeroAnchors: true });
      const clipGain = dbToAmplitude(clip.gain_db);
      const fadeIn = {
        samples: Math.min(length, secondsToSample(clip.fade_in?.duration, sampleRate)),
        curve: clip.fade_in?.curve || "linear",
      };
      const fadeOut = {
        samples: Math.min(length, secondsToSample(clip.fade_out?.duration, sampleRate)),
        curve: clip.fade_out?.curve || "linear",
      };
      const pan = clamp(clip.pan, -1, 1);

      for (let offset = 0; offset < length; offset++) {
        const target = timelineStart + offset;
        if (target >= outputSamples) break;
        const sourceIndex = clip.reverse ? sourceEnd - 1 - offset : sourceStart + offset;
        const gain = clipGain * (clipEnvelope ? clipEnvelope[offset] : 1) * fadeAmplitude(offset, length, fadeIn, fadeOut);
        if (channelCount === 1) {
          trackMix[0][target] += (source.channels[0][sourceIndex] || 0) * gain;
        } else {
          const [left, right] = applyPan(
            (source.channels[0][sourceIndex] || 0) * gain,
            (source.channels[1][sourceIndex] || 0) * gain,
            pan,
          );
          trackMix[0][target] += left;
          trackMix[1][target] += right;
        }
      }
    }

    const trackEnvelope = buildEnvelopeAmplitude(outputSamples, sampleRate, track.gain_envelope || [], { zeroAnchors: false });
    const trackGain = dbToAmplitude(track.gain_db);
    const pan = clamp(track.pan, -1, 1);
    for (let index = 0; index < outputSamples; index++) {
      const gain = trackGain * (trackEnvelope ? trackEnvelope[index] : 1);
      if (channelCount === 1) {
        mixed[0][index] += trackMix[0][index] * gain;
      } else {
        const [left, right] = applyPan(trackMix[0][index] * gain, trackMix[1][index] * gain, pan);
        mixed[0][index] += left;
        mixed[1][index] += right;
      }
    }
  }

  const master = project?.master || {};
  assertEffectsDisabled("Master", master.effects);
  let channels = mixed;
  const mode = master.channel_mode || "preserve";
  if (mode === "mono") {
    const mono = new Float32Array(outputSamples);
    for (let index = 0; index < outputSamples; index++) {
      let value = 0;
      for (const channel of channels) value += channel[index] / channels.length;
      mono[index] = value;
    }
    channels = [mono];
  } else if (mode === "stereo" && channels.length === 1) {
    channels = [channels[0].slice(), channels[0].slice()];
  } else if (mode === "left_only") {
    channels = [channels[0].slice()];
  } else if (mode === "right_only") {
    channels = [channels[Math.min(1, channels.length - 1)].slice()];
  } else if (mode === "swap_lr") {
    channels = channels.length >= 2 ? [channels[1], channels[0]] : [channels[0].slice(), channels[0].slice()];
  }

  const masterGain = dbToAmplitude(master.gain_db);
  let peak = 0;
  for (const channel of channels) {
    for (let index = 0; index < channel.length; index++) {
      const value = Number.isFinite(channel[index]) ? channel[index] * masterGain : 0;
      channel[index] = value;
      peak = Math.max(peak, Math.abs(value));
    }
  }

  if (master.normalize?.enabled && peak > 0) {
    const target = dbToAmplitude(master.normalize.target_peak_dbfs);
    const factor = target / peak;
    for (const channel of channels) for (let index = 0; index < channel.length; index++) channel[index] *= factor;
  }

  return { sampleRate, channels, numSamples: outputSamples, duration: outputSamples / sampleRate };
}
