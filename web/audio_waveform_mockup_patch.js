import { fmtTime } from "./audio_editor_core.js";
import { WaveformView } from "./audio_waveform.js";

const originalRender = WaveformView.prototype.render;

function drawTopTimeRuler(view) {
  const canvas = view?.canvas;
  if (!canvas || !(view.duration > 0)) return;
  const width = canvas.clientWidth || view.contentWidth();
  const dpr = Math.min(devicePixelRatio || 1, 2);
  const context = canvas.getContext("2d");
  const top = 54;
  const bottom = 76;
  const step = view.duration > 180 ? 30 : view.duration > 60 ? 10 : 5;

  context.save();
  context.setTransform(dpr, 0, 0, dpr, 0, 0);
  context.fillStyle = "rgba(8,14,22,.94)";
  context.fillRect(0, top, width, bottom - top);
  context.strokeStyle = "rgba(255,255,255,.1)";
  context.beginPath();
  context.moveTo(0, bottom + .5);
  context.lineTo(width, bottom + .5);
  context.stroke();
  context.font = "10px ui-monospace,monospace";

  for (let time = 0; time <= view.duration + .0001; time += step) {
    const x = time / view.duration * width;
    context.strokeStyle = "rgba(255,255,255,.14)";
    context.beginPath();
    context.moveTo(x + .5, top);
    context.lineTo(x + .5, bottom);
    context.stroke();
    context.fillStyle = "rgba(225,233,242,.7)";
    context.fillText(fmtTime(time), x + 4, bottom - 6);
  }
  context.restore();
}

WaveformView.prototype.render = function mockupAlignedRender(...args) {
  const result = originalRender.apply(this, args);
  drawTopTimeRuler(this);
  return result;
};
