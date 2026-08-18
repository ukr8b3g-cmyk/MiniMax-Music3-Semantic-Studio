const STYLE_ID = "m3ss-audio-phase2d-style";

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./audio_phase2d.css", import.meta.url).href;
  document.head.appendChild(link);
}
