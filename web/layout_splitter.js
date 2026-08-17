const STORAGE_PREFIX = "m3ss-layout";
const SESSION_DEFAULT_KEYS = new Set(["semantic-song-timeline-open"]);

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || min));
}

function storageKey(key) {
  return `${STORAGE_PREFIX}:${key}`;
}

export function readLayoutNumber(key, fallback) {
  if (!key) return fallback;
  if (SESSION_DEFAULT_KEYS.has(key)) return fallback;
  try {
    const value = Number(localStorage.getItem(storageKey(key)));
    return Number.isFinite(value) ? value : fallback;
  } catch {
    return fallback;
  }
}

export function writeLayoutNumber(key, value) {
  if (!key || SESSION_DEFAULT_KEYS.has(key)) return;
  try {
    localStorage.setItem(storageKey(key), String(Math.round(Number(value) || 0)));
  } catch {
    // Local storage may be disabled in hardened/private browser contexts.
  }
}

/**
 * Bind a vertical drag handle to a CSS pixel variable on target.
 * `invert` is useful for a right-side pane: dragging the separator left grows it.
 */
export function installCssSizeDrag({
  handle,
  target,
  cssVariable,
  storageKey: key,
  defaultSize,
  minSize,
  maxSize,
  invert = false,
  step = 16,
  onChange = null,
}) {
  if (!handle || !target || !cssVariable) return () => {};

  const minimum = Number(minSize) || 0;
  const maximum = Math.max(minimum, Number(maxSize) || 4096);
  const initial = clamp(readLayoutNumber(key, defaultSize), minimum, maximum);

  function setSize(value, persist = true) {
    const next = clamp(value, minimum, maximum);
    target.style.setProperty(cssVariable, `${next}px`);
    handle.setAttribute("aria-valuenow", String(Math.round(next)));
    if (persist) writeLayoutNumber(key, next);
    onChange?.(next);
    return next;
  }

  setSize(initial, false);
  handle.setAttribute("role", "separator");
  handle.setAttribute("aria-orientation", "vertical");
  handle.setAttribute("aria-valuemin", String(minimum));
  handle.setAttribute("aria-valuemax", String(maximum));
  handle.tabIndex = 0;

  function pointerDown(event) {
    if (event.button !== 0) return;
    event.preventDefault();
    const startX = event.clientX;
    const raw = getComputedStyle(target).getPropertyValue(cssVariable);
    const startSize = clamp(parseFloat(raw) || initial, minimum, maximum);
    let latest = startSize;
    handle.classList.add("is-dragging");
    handle.setPointerCapture?.(event.pointerId);

    const move = (moveEvent) => {
      const dx = moveEvent.clientX - startX;
      latest = setSize(startSize + (invert ? -dx : dx), false);
    };
    const up = (upEvent) => {
      handle.releasePointerCapture?.(upEvent.pointerId);
      handle.removeEventListener("pointermove", move);
      handle.removeEventListener("pointerup", up);
      handle.removeEventListener("pointercancel", up);
      handle.classList.remove("is-dragging");
      writeLayoutNumber(key, latest);
      onChange?.(latest);
    };

    handle.addEventListener("pointermove", move);
    handle.addEventListener("pointerup", up);
    handle.addEventListener("pointercancel", up);
  }

  function keyDown(event) {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight" && event.key !== "Home") return;
    event.preventDefault();
    if (event.key === "Home") {
      setSize(defaultSize);
      return;
    }
    const raw = getComputedStyle(target).getPropertyValue(cssVariable);
    const current = clamp(parseFloat(raw) || initial, minimum, maximum);
    const physicalDelta = event.key === "ArrowRight" ? step : -step;
    setSize(current + (invert ? -physicalDelta : physicalDelta));
  }

  function reset() {
    setSize(defaultSize);
  }

  handle.addEventListener("pointerdown", pointerDown);
  handle.addEventListener("keydown", keyDown);
  handle.addEventListener("dblclick", reset);

  return () => {
    handle.removeEventListener("pointerdown", pointerDown);
    handle.removeEventListener("keydown", keyDown);
    handle.removeEventListener("dblclick", reset);
  };
}

export function makeVerticalSplitter(className = "m3ss-splitter") {
  const handle = document.createElement("div");
  handle.className = className;
  handle.title = "Drag to resize · double-click to reset";
  return handle;
}
