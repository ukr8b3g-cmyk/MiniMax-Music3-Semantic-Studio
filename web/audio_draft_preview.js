import { renderDraftProject } from "./audio_draft_core.js";

function writeAscii(view, offset, text) {
  for (let index = 0; index < text.length; index++) view.setUint8(offset + index, text.charCodeAt(index));
}

/** Encode PCM16 WAV for broad HTMLAudioElement compatibility. */
export function encodeWav16(rendered) {
  const channels = rendered.channels || [];
  const channelCount = Math.max(1, channels.length);
  const sampleRate = Math.max(1, Number(rendered.sampleRate) || 44100);
  const length = Math.max(1, Number(rendered.numSamples) || channels[0]?.length || 1);
  const bytesPerSample = 2;
  const dataSize = length * channelCount * bytesPerSample;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataSize, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, channelCount, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * channelCount * bytesPerSample, true);
  view.setUint16(32, channelCount * bytesPerSample, true);
  view.setUint16(34, 16, true);
  writeAscii(view, 36, "data");
  view.setUint32(40, dataSize, true);
  let offset = 44;
  for (let sample = 0; sample < length; sample++) {
    for (let channel = 0; channel < channelCount; channel++) {
      const value = Math.max(-1, Math.min(1, Number(channels[channel]?.[sample]) || 0));
      const encoded = value < 0 ? Math.round(value * 32768) : Math.round(value * 32767);
      view.setInt16(offset, encoded, true);
      offset += 2;
    }
  }
  return new Blob([buffer], { type: "audio/wav" });
}

function audioBufferToSource(buffer) {
  return {
    sampleRate: buffer.sampleRate,
    channels: Array.from({ length: buffer.numberOfChannels }, (_, index) => buffer.getChannelData(index).slice()),
  };
}

export class DraftPreviewRenderer {
  constructor(meta, urlForEntry) {
    this.meta = meta;
    this.urlForEntry = urlForEntry;
    this.context = null;
    this.sources = null;
    this.currentUrl = "";
    this.loading = null;
  }

  async ensureSources() {
    if (this.sources) return this.sources;
    if (this.loading) return this.loading;
    this.loading = this.#loadSources();
    try {
      this.sources = await this.loading;
      return this.sources;
    } finally {
      this.loading = null;
    }
  }

  async #loadSources() {
    const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextCtor) throw new Error("Web Audio API is unavailable in this browser.");
    this.context ||= new AudioContextCtor();
    const entries = this.meta?.takes || [];
    const sources = {};
    for (const take of entries) {
      const url = this.urlForEntry(take);
      if (!url) throw new Error(`No preview audio is available for ${take.name || take.id}.`);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio preview request failed for ${take.name || take.id}: ${response.status}`);
      const bytes = await response.arrayBuffer();
      const decoded = await this.context.decodeAudioData(bytes.slice(0));
      sources[take.id] = audioBufferToSource(decoded);
    }
    return sources;
  }

  async render(project) {
    const sources = await this.ensureSources();
    const rendered = renderDraftProject(project, sources);
    const buffer = this.context.createBuffer(rendered.channels.length, rendered.numSamples, rendered.sampleRate);
    rendered.channels.forEach((channel, index) => buffer.copyToChannel(channel, index));
    const url = URL.createObjectURL(encodeWav16(rendered));
    return { buffer, url, rendered };
  }

  acceptUrl(url) {
    const previous = this.currentUrl;
    this.currentUrl = url || "";
    if (previous && previous !== this.currentUrl) URL.revokeObjectURL(previous);
  }

  destroy() {
    if (this.currentUrl) URL.revokeObjectURL(this.currentUrl);
    this.currentUrl = "";
    this.sources = null;
    this.context?.close?.();
    this.context = null;
  }
}
