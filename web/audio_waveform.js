import { clamp, clipDuration, el, fmtTime } from "./audio_editor_core.js";

const SVG_NS = "http://www.w3.org/2000/svg";

export class WaveformView {
  constructor(container, onSelection, options = {}) {
    this.container = container;
    this.onSelection = onSelection;
    this.onZoom = options.onZoom || null;
    this.onScroll = options.onScroll || null;
    this.cache = new Map();
    this.audio = new Audio();
    this.audio.preload = "auto";
    this.url = "";
    this.decoded = null;
    this.zoom = 28;
    this.duration = 1;
    this.selection = null;
    this.sections = [];
    this.envelopeClip = null;
    this.envelopeVisible = false;
    this.raf = null;
    this.build();
  }

  build() {
    this.root = el("div", "m3ssv2-wave-root");
    this.scroll = el("div", "m3ssv2-wave-scroll");
    this.stage = el("div", "m3ssv2-wave-stage");
    this.canvas = document.createElement("canvas");
    this.canvas.className = "m3ssv2-wave-canvas";
    this.sectionLayer = el("div", "m3ssv2-semantic-overlay");
    this.selectionEl = el("div", "m3ssv2-wave-selection");
    this.envelopeSvg = document.createElementNS(SVG_NS, "svg");
    this.envelopeSvg.classList.add("m3ssv2-wave-envelope");
    this.envelopeSvg.setAttribute("aria-hidden", "true");
    this.playhead = el("div", "m3ssv2-playhead");
    this.stage.append(this.canvas, this.sectionLayer, this.selectionEl, this.envelopeSvg, this.playhead);
    this.scroll.appendChild(this.stage);
    this.root.appendChild(this.scroll);
    this.container.appendChild(this.root);

    let drag = null;
    this.stage.addEventListener("pointerdown", (event) => {
      if (event.button !== 0) return;
      const rect = this.stage.getBoundingClientRect();
      drag = clamp((event.clientX - rect.left) / rect.width * this.duration, 0, this.duration);
      this.stage.setPointerCapture?.(event.pointerId);
      this.setSelection({ start: drag, end: drag });
    });
    this.stage.addEventListener("pointermove", (event) => {
      if (drag === null) return;
      const rect = this.stage.getBoundingClientRect();
      const now = clamp((event.clientX - rect.left) / rect.width * this.duration, 0, this.duration);
      this.setSelection({ start: Math.min(drag, now), end: Math.max(drag, now) });
    });
    const done = (event) => {
      if (drag === null) return;
      this.stage.releasePointerCapture?.(event.pointerId);
      if (this.selection && Math.abs(this.selection.end - this.selection.start) < 0.02) {
        this.audio.currentTime = this.selection.start;
        this.setSelection(null);
      }
      drag = null;
    };
    this.stage.addEventListener("pointerup", done);
    this.stage.addEventListener("pointercancel", done);

    this.scroll.addEventListener("wheel", (event) => {
      if (event.shiftKey) {
        event.preventDefault();
        this.scroll.scrollLeft += event.deltaY || event.deltaX;
        return;
      }
      event.preventDefault();
      const factor = Math.exp(-event.deltaY * 0.0016);
      this.setZoom(this.zoom * factor, event.clientX);
    }, { passive: false });
    this.scroll.addEventListener("scroll", () => {
      this.onScroll?.(this.scrollSeconds(), {
        scrollLeft: this.scroll.scrollLeft,
        pixelWidth: this.contentWidth(),
        duration: this.duration,
      });
    }, { passive: true });

    this.audio.addEventListener("timeupdate", () => this.updatePlayhead());
    this.audio.addEventListener("ended", () => this.stopAnimation());
  }

  destroy() {
    this.stopAnimation();
    this.audio.pause();
    this.audio.src = "";
  }

  async setSource(url) {
    if (!url) return;
    this.url = url;
    this.audio.src = url;
    let decoded = this.cache.get(url);
    if (!decoded) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio preview request failed: ${response.status}`);
      const bytes = await response.arrayBuffer();
      const context = new (window.AudioContext || window.webkitAudioContext)();
      try {
        decoded = await context.decodeAudioData(bytes.slice(0));
      } finally {
        await context.close();
      }
      this.cache.set(url, decoded);
    }
    if (this.url !== url) return;
    this.decoded = decoded;
    this.duration = decoded.duration || 1;
    this.selection = null;
    this.render();
  }

  contentWidth() {
    return Math.max(1, this.stage.getBoundingClientRect().width || this.scroll.clientWidth || 900);
  }

  scrollSeconds() {
    return this.scroll.scrollLeft / this.contentWidth() * this.duration;
  }

  setScrollSeconds(seconds) {
    this.scroll.scrollLeft = clamp(seconds, 0, this.duration) / Math.max(this.duration, 0.001) * this.contentWidth();
  }

  setZoom(value, anchorClientX = null) {
    const oldWidth = this.contentWidth();
    const rect = this.scroll.getBoundingClientRect();
    const cursor = anchorClientX == null ? rect.width / 2 : clamp(anchorClientX - rect.left, 0, rect.width);
    const absolute = this.scroll.scrollLeft + cursor;
    const ratio = clamp(absolute / oldWidth, 0, 1);
    this.zoom = clamp(value, 8, 120);
    this.render();
    const newWidth = this.contentWidth();
    this.scroll.scrollLeft = Math.max(0, ratio * newWidth - cursor);
    this.onZoom?.(this.zoom, { pixelWidth: newWidth, duration: this.duration });
  }

  fit() {
    const fitZoom = clamp((this.scroll.clientWidth || 900) / Math.max(this.duration, 0.001), 8, 120);
    this.zoom = fitZoom;
    this.render();
    this.scroll.scrollLeft = 0;
    this.onZoom?.(this.zoom, { pixelWidth: this.contentWidth(), duration: this.duration });
    this.onScroll?.(0, { scrollLeft: 0, pixelWidth: this.contentWidth(), duration: this.duration });
    return this.zoom;
  }

  resetZoom() {
    return this.fit();
  }

  setSemanticSections(sections) {
    this.sections = sections || [];
    this.renderSections();
  }

  setEnvelopeOverlay(clip, visible = true) {
    this.envelopeClip = clip || null;
    this.envelopeVisible = !!visible;
    this.renderEnvelope();
  }

  render() {
    const width = Math.min(40000, Math.max(this.scroll.clientWidth || 900, Math.round(this.duration * this.zoom)));
    const height = 180;
    const dpr = Math.min(devicePixelRatio || 1, 2);
    this.stage.style.width = `${width}px`;
    this.stage.style.height = `${height}px`;
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    this.canvas.style.width = `${width}px`;
    this.canvas.style.height = `${height}px`;
    const context = this.canvas.getContext("2d");
    context.setTransform(dpr, 0, 0, dpr, 0, 0);
    context.fillStyle = "#0b0f18";
    context.fillRect(0, 0, width, height);
    const step = this.duration > 180 ? 30 : this.duration > 60 ? 10 : 5;
    context.font = "10px ui-monospace,monospace";
    for (let time = 0; time <= this.duration; time += step) {
      const x = time / this.duration * width;
      context.strokeStyle = "rgba(255,255,255,.07)";
      context.beginPath();
      context.moveTo(x + 0.5, 0);
      context.lineTo(x + 0.5, height);
      context.stroke();
      context.fillStyle = "rgba(255,255,255,.48)";
      context.fillText(fmtTime(time), x + 4, height - 6);
    }
    if (this.decoded) {
      const length = this.decoded.length;
      const half = height / 2;
      context.strokeStyle = "rgba(92,210,190,.9)";
      context.beginPath();
      for (let x = 0; x < width; x++) {
        const start = Math.floor(x / width * length);
        const end = Math.max(start + 1, Math.floor((x + 1) / width * length));
        let low = 1;
        let high = -1;
        for (let channel = 0; channel < this.decoded.numberOfChannels; channel++) {
          const data = this.decoded.getChannelData(channel);
          const stride = Math.max(1, Math.floor((end - start) / 8));
          for (let index = start; index < end; index += stride) {
            const sample = data[index] || 0;
            low = Math.min(low, sample);
            high = Math.max(high, sample);
          }
        }
        context.moveTo(x + 0.5, half - high * half * 0.86);
        context.lineTo(x + 0.5, half - low * half * 0.86);
      }
      context.stroke();
    }
    this.renderSections();
    this.updateSelection();
    this.renderEnvelope();
    this.updatePlayhead();
  }

  renderSections() {
    if (!this.sectionLayer) return;
    this.sectionLayer.replaceChildren();
    for (const section of this.sections) {
      const start = clamp(section.start / this.duration * 100, 0, 100);
      const end = clamp(section.end / this.duration * 100, 0, 100);
      if (end <= start) continue;
      const node = el("div", "m3ssv2-semantic-section", section.label);
      node.style.left = `${start}%`;
      node.style.width = `${Math.max(0.2, end - start)}%`;
      node.title = `${section.label} · ${fmtTime(section.start)}–${fmtTime(section.end)}`;
      this.sectionLayer.appendChild(node);
    }
  }

  renderEnvelope() {
    const svg = this.envelopeSvg;
    if (!svg) return;
    svg.replaceChildren();
    const clip = this.envelopeClip;
    if (!this.envelopeVisible || !clip || this.duration <= 0) {
      svg.style.display = "none";
      return;
    }
    svg.style.display = "block";
    svg.setAttribute("viewBox", "0 0 1000 180");
    svg.setAttribute("preserveAspectRatio", "none");

    const clipStart = Math.max(0, Number(clip.timeline_start) || 0);
    const duration = Math.max(0.001, clipDuration(clip));
    const clipEnd = Math.min(this.duration, clipStart + duration);
    if (clipEnd <= clipStart) return;

    const shade = document.createElementNS(SVG_NS, "rect");
    shade.setAttribute("x", String(clipStart / this.duration * 1000));
    shade.setAttribute("width", String((clipEnd - clipStart) / this.duration * 1000));
    shade.setAttribute("y", "24");
    shade.setAttribute("height", "145");
    shade.setAttribute("class", "m3ssv2-envelope-range");
    svg.appendChild(shade);

    const points = [{ time: 0, gain_db: 0 }, ...(clip.gain_envelope || []), { time: duration, gain_db: 0 }];
    const deduped = new Map();
    for (const point of points) {
      const time = clamp(point.time, 0, duration);
      deduped.set(time.toFixed(6), { time, gain_db: clamp(point.gain_db, -60, 24) });
    }
    const ordered = [...deduped.values()].sort((a, b) => a.time - b.time);
    const toX = (point) => (clipStart + point.time) / this.duration * 1000;
    const toY = (point) => 28 + (24 - point.gain_db) / 84 * 132;

    const line = document.createElementNS(SVG_NS, "polyline");
    line.setAttribute("class", "m3ssv2-envelope-line");
    line.setAttribute("points", ordered.map((point) => `${toX(point)},${toY(point)}`).join(" "));
    svg.appendChild(line);

    for (const point of ordered) {
      const dot = document.createElementNS(SVG_NS, "circle");
      dot.setAttribute("class", "m3ssv2-envelope-point");
      dot.setAttribute("cx", String(toX(point)));
      dot.setAttribute("cy", String(toY(point)));
      dot.setAttribute("r", "3.5");
      svg.appendChild(dot);
    }
  }

  setSelection(selection) {
    this.selection = selection;
    this.updateSelection();
    this.onSelection?.(selection);
  }

  updateSelection() {
    if (!this.selection) {
      this.selectionEl.style.display = "none";
      return;
    }
    this.selectionEl.style.display = "block";
    this.selectionEl.style.left = `${this.selection.start / this.duration * 100}%`;
    this.selectionEl.style.width = `${Math.max(0.1, (this.selection.end - this.selection.start) / this.duration * 100)}%`;
  }

  currentTime() {
    return Number(this.audio.currentTime) || 0;
  }

  play() {
    this.audio.play();
    this.startAnimation();
  }

  pause() {
    this.audio.pause();
    this.stopAnimation();
    this.updatePlayhead();
  }

  stop() {
    this.audio.pause();
    this.audio.currentTime = 0;
    this.stopAnimation();
    this.updatePlayhead();
  }

  startAnimation() {
    this.stopAnimation();
    const tick = () => {
      this.updatePlayhead();
      if (!this.audio.paused) this.raf = requestAnimationFrame(tick);
    };
    this.raf = requestAnimationFrame(tick);
  }

  stopAnimation() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = null;
  }

  updatePlayhead() {
    this.playhead.style.left = `${clamp(this.currentTime() / Math.max(this.duration, 0.001) * 100, 0, 100)}%`;
  }
}
