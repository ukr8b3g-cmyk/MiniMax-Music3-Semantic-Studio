const displayBuffers = new WeakMap();

export function bindWaveformDisplayBuffer(playbackBuffer, displayBuffer) {
  if (playbackBuffer && displayBuffer && playbackBuffer !== displayBuffer) {
    displayBuffers.set(playbackBuffer, displayBuffer);
  }
  return playbackBuffer;
}

export function waveformDisplayBuffer(playbackBuffer) {
  return displayBuffers.get(playbackBuffer) || playbackBuffer || null;
}
