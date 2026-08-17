import { WaveformView } from "./audio_waveform.js";
import { normalizeLoopRange, loopPlaybackJump } from "./audio_playback_loop.js";
import { setEffectParam } from "./audio_effects_core.js";
import { currentUiLocale } from "./ui_i18n.js";

const STYLE_ID = "m3ss-v2-dsp-ui-style";
const DIALOG_INSTALLED = "m3ssDspUiInstalled";
const PROTO_PATCHED = "_m3ssLoopPatched";

const tr = (en, ja) => currentUiLocale() === "ja" ? ja : en;

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./audio_dsp_ui.css", import.meta.url).href;
  document.head.appendChild(link);
}

function patchWaveformLoop() {
  const proto = WaveformView.prototype;
  if (proto[PROTO_PATCHED]) return;
  proto[PROTO_PATCHED] = true;

  const originalBuild = proto.build;
  proto.build = function (...args) {
    originalBuild.apply(this, args);
    this.root._m3ssWaveformView = this;
    this._m3ssLoopRange = null;
    this.audio.addEventListener("ended", () => {
      const loop = normalizeLoopRange(this._m3ssLoopRange, this.duration);
      if (!loop) return;
      this.audio.currentTime = loop.start;
      this.audio.play().then(() => this.startAnimation()).catch(() => {});
    });
  };

  proto.setLoopRange = function (range) {
    this._m3ssLoopRange = normalizeLoopRange(range, this.duration);
    this.root?.classList.toggle("is-looping", !!this._m3ssLoopRange);
    return this._m3ssLoopRange;
  };

  const originalPlay = proto.play;
  proto.play = async function (...args) {
    const loop = normalizeLoopRange(this._m3ssLoopRange, this.duration);
    if (loop && (this.currentTime() < loop.start || this.currentTime() >= loop.end)) {
      this.audio.currentTime = loop.start;
    }
    return originalPlay.apply(this, args);
  };

  const originalUpdatePlayhead = proto.updatePlayhead;
  proto.updatePlayhead = function (...args) {
    if (!this.audio.paused && this._m3ssLoopRange) {
      const jump = loopPlaybackJump(this.currentTime(), this._m3ssLoopRange, this.duration);
      if (jump !== null) this.audio.currentTime = jump;
    }
    return originalUpdatePlayhead.apply(this, args);
  };

  const originalSetSelection = proto.setSelection;
  proto.setSelection = function (selection) {
    const result = originalSetSelection.call(this, selection);
    this.root?.dispatchEvent(new CustomEvent("m3ss-selection-change", {
      detail: { selection: this.selection ? { ...this.selection } : null },
    }));
    return result;
  };
}

function compactKeyText(raw) {
  const text = String(raw || "").trim().replace(/\s*·\s*/g, " ").replace(/\s+/g, " ");
  if (!text || text === "—") return text || "—";
  const match = text.match(/^([A-G](?:#|b)?)(?:\s+)(harmonic minor|melodic minor|major|minor|ionian|dorian|phrygian|lydian|mixolydian|aeolian|locrian)\b/i);
  if (match) return `${match[1]} ${match[2]}`;
  if (text.length <= 18) return text;
  return `${text.slice(0, 17).trimEnd()}…`;
}

function polishKeyDisplay(dialog) {
  for (const field of dialog.querySelectorAll(".m3ssv2-reference-field")) {
    const label = field.querySelector(":scope > span");
    if (!/^(Key|キー)$/i.test(String(label?.textContent || "").trim())) continue;
    const output = field.querySelector("output");
    if (!output) continue;
    const current = String(output.textContent || "").trim();
    const previousCompact = output.dataset.m3ssCompactKey || "";
    if (current !== previousCompact) output.dataset.m3ssRawKey = current;
    const raw = output.dataset.m3ssRawKey || current;
    const compact = compactKeyText(raw);
    output.dataset.m3ssCompactKey = compact;
    output.textContent = compact;
    output.title = raw;
    field.classList.add("m3ssv2-key-reference-field");
  }
}

function waveformView(dialog) {
  return dialog.querySelector(".m3ssv2-wave-root")?._m3ssWaveformView || null;
}

function installLoopControl(dialog) {
  const transport = dialog.querySelector(".m3ssv2-command-group.is-transport");
  const wave = waveformView(dialog);
  if (!transport || !wave || transport.querySelector(".m3ssv2-loop-button")) return false;

  const loopButton = document.createElement("button");
  loopButton.type = "button";
  loopButton.className = "m3ssv2-command-button m3ssv2-loop-button";
  loopButton.textContent = tr("↻ Loop", "↻ リピート");
  loopButton.title = tr("Loop selected range · Shift+Space", "選択区間をリピート · Shift+Space");
  transport.appendChild(loopButton);

  let enabled = false;
  const validSelection = () => normalizeLoopRange(wave.selection, wave.duration);
  const refresh = () => {
    const range = validSelection();
    if (enabled && !range) {
      enabled = false;
      wave.setLoopRange(null);
    } else if (enabled && range) {
      wave.setLoopRange(range);
    }
    loopButton.disabled = !range;
    loopButton.classList.toggle("is-active", enabled);
    loopButton.setAttribute("aria-pressed", enabled ? "true" : "false");
  };

  const toggle = async () => {
    const range = validSelection();
    if (!range) return;
    enabled = !enabled;
    wave.setLoopRange(enabled ? range : null);
    refresh();
    if (enabled) {
      if (wave.currentTime() < range.start || wave.currentTime() >= range.end) wave.audio.currentTime = range.start;
      try { await wave.play(); } catch {}
    }
  };

  loopButton.onclick = () => { toggle(); };
  wave.root.addEventListener("m3ss-selection-change", refresh);
  dialog.addEventListener("keydown", (event) => {
    if (!(event.shiftKey && event.code === "Space")) return;
    event.preventDefault();
    event.stopPropagation();
    toggle();
  }, true);
  refresh();
  return true;
}

function previewPeak(wave) {
  const decoded = wave?.decoded;
  if (!decoded?.numberOfChannels || !decoded.length) return null;
  let peak = 0;
  for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
    const data = decoded.getChannelData(channel);
    for (let index = 0; index < data.length; index++) peak = Math.max(peak, Math.abs(data[index] || 0));
  }
  return peak > 1e-8 ? peak : null;
}

function findEffect(project, effectId) {
  for (const effect of project?.tracks?.[0]?.effects || []) if (effect?.id === effectId) return effect;
  for (const effect of project?.master?.effects || []) if (effect?.id === effectId) return effect;
  return null;
}

function installLimiterAuto(dialog) {
  const body = dialog.querySelector(".m3ssv2-inspector-body");
  const context = body?._m3ssEffectsContext;
  if (!body || !context?.project || typeof context.commit !== "function") return;
  const wave = waveformView(dialog);

  for (const card of body.querySelectorAll(".m3ssv2-fx-card[data-effect-id]")) {
    const effect = findEffect(context.project, card.dataset.effectId);
    if (effect?.type !== "limiter") continue;
    const actions = card.querySelector(".m3ssv2-fx-card-actions");
    if (!actions || actions.querySelector(".m3ssv2-limiter-auto")) continue;
    const auto = document.createElement("button");
    auto.type = "button";
    auto.className = "m3ssv2-button m3ssv2-limiter-auto";
    auto.textContent = tr("Auto Level", "オートレベル");
    auto.disabled = !!effect.enabled;
    auto.title = effect.enabled
      ? tr("Turn the Limiter off before Auto Level so the source peak can be measured.", "オートレベルの前にリミッターをOFFにして元のピークを測定してください。")
      : tr("Set Limiter Input Gain from the current preview peak.", "現在のプレビューピークからLimiter Input Gainを自動設定します。");
    auto.onclick = () => {
      const peak = previewPeak(wave);
      if (!peak) {
        alert(tr("No usable preview signal is available for Auto Level.", "オートレベルに使用できるプレビュー信号がありません。"));
        return;
      }
      const peakDb = 20 * Math.log10(peak);
      const ceiling = Number(effect.params?.ceiling_db ?? -1);
      const inputGain = Math.max(0, Math.min(24, ceiling - peakDb));
      context.commit(() => setEffectParam(effect, "input_gain_db", inputGain));
    };
    actions.prepend(auto);
  }
}

function installDialog(dialog) {
  if (!dialog || dialog.dataset.m3ssEmptyEditor === "1") return;
  ensureStyles();
  polishKeyDisplay(dialog);
  installLoopControl(dialog);
  installLimiterAuto(dialog);
  if (dialog.dataset[DIALOG_INSTALLED] === "1") return;
  dialog.dataset[DIALOG_INSTALLED] = "1";
  const observer = new MutationObserver(() => {
    if (!dialog.isConnected) return observer.disconnect();
    polishKeyDisplay(dialog);
    installLoopControl(dialog);
    installLimiterAuto(dialog);
  });
  observer.observe(dialog, { childList: true, subtree: true, characterData: true });
}

patchWaveformLoop();
if (typeof document !== "undefined") {
  ensureStyles();
  const scan = () => document.querySelectorAll(".m3ssv2-dialog").forEach(installDialog);
  scan();
  const observer = new MutationObserver(scan);
  observer.observe(document.body, { childList: true, subtree: true });
}
