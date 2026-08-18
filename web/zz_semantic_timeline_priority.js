const STYLE_ID = "m3ss-semantic-timeline-priority-style";
const MIGRATION_KEY = "m3ss-layout:semantic-main-vocal-default-v2";
const MAIN_VOCAL_KEY = "m3ss-layout:semantic-main-vocal-open";

if (typeof document !== "undefined" && !document.getElementById(STYLE_ID)) {
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./semantic_timeline_priority.css", import.meta.url).href;
  document.head.appendChild(link);
}

/*
 * Phase A originally opened Main Vocal by default. The timeline-priority layout
 * intentionally starts from the compact one-line summary instead. Apply this
 * once so existing installations with the old persisted default also receive
 * the new release default; subsequent user toggles continue to persist normally.
 */
try {
  if (globalThis.localStorage?.getItem(MIGRATION_KEY) !== "1") {
    globalThis.localStorage?.setItem(MAIN_VOCAL_KEY, "0");
    globalThis.localStorage?.setItem(MIGRATION_KEY, "1");
  }
} catch {
  // Hardened/private browser contexts may disable localStorage.
}
