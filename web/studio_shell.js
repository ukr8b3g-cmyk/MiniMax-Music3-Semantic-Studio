import { installUiLocalization, tr } from "./ui_i18n.js";

const STYLE_ID = "m3ss-common-shell-style";
const FINAL_STYLE_ID = "m3ss-editor-final-polish-style";

export function ensureStudioShellStyles() {
  if (!document.getElementById(STYLE_ID)) {
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = new URL("./studio_shell.css", import.meta.url).href;
    document.head.appendChild(link);
  }
  if (!document.getElementById(FINAL_STYLE_ID)) {
    const link = document.createElement("link");
    link.id = FINAL_STYLE_ID;
    link.rel = "stylesheet";
    link.href = new URL("./editor_final_polish.css", import.meta.url).href;
    document.head.appendChild(link);
  }
}

function make(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readStoredObject(storageKey, suffix) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(`${storageKey}:${suffix}`);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

function writeStoredObject(storageKey, suffix, value) {
  if (!storageKey) return;
  try {
    localStorage.setItem(`${storageKey}:${suffix}`, JSON.stringify(value));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
}

function readSize(storageKey) {
  const value = readStoredObject(storageKey, "size");
  if (!Number.isFinite(value?.width) || !Number.isFinite(value?.height)) return null;
  return value;
}

function writeSize(storageKey, width, height) {
  writeStoredObject(storageKey, "size", { width, height });
}

function readPosition(storageKey) {
  const value = readStoredObject(storageKey, "position");
  if (!Number.isFinite(value?.left) || !Number.isFinite(value?.top)) return null;
  return value;
}

function writePosition(storageKey, left, top) {
  writeStoredObject(storageKey, "position", { left, top });
}

function clampPosition(left, top, width, height) {
  const margin = 8;
  const maxLeft = Math.max(margin, window.innerWidth - Math.min(width, window.innerWidth - margin * 2) - margin);
  const maxTop = Math.max(margin, window.innerHeight - Math.min(height, window.innerHeight - margin * 2) - margin);
  return {
    left: Math.max(margin, Math.min(Number(left) || margin, maxLeft)),
    top: Math.max(margin, Math.min(Number(top) || margin, maxTop)),
  };
}

export function createStudioWindow({
  title,
  subtitle = "",
  storageKey = "m3ss-window",
  className = "",
  defaultWidth = 1240,
  defaultHeight = 820,
  minWidth = 760,
  minHeight = 520,
  maximizeLabel = "Maximize",
  restoreLabel = "Restore",
  startMaximized = storageKey === "m3ss-semantic-window" || storageKey === "m3ss-audio-window",
  onClose = null,
  onResize = null,
} = {}) {
  ensureStudioShellStyles();

  const overlay = make("div", "m3shell-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", title || "Studio editor");

  const windowEl = make("section", `m3shell-window ${className}`.trim());
  windowEl.style.minWidth = `${minWidth}px`;
  windowEl.style.minHeight = `${minHeight}px`;

  const stored = readSize(storageKey);
  const viewportWidth = Math.max(320, window.innerWidth - 32);
  const viewportHeight = Math.max(320, window.innerHeight - 32);
  windowEl.style.width = `${Math.min(stored?.width || defaultWidth, viewportWidth)}px`;
  windowEl.style.height = `${Math.min(stored?.height || defaultHeight, viewportHeight)}px`;

  const header = make("header", "m3shell-header");
  const heading = make("div", "m3shell-heading");
  const titleEl = make("h2", "m3shell-title", title || "Studio");
  const subtitleEl = make("p", "m3shell-subtitle", subtitle);
  heading.append(titleEl, subtitleEl);

  const controls = make("div", "m3shell-window-controls");
  const maximizeButton = make("button", "m3shell-control", "□");
  maximizeButton.type = "button";
  maximizeButton.title = tr(maximizeLabel);
  maximizeButton.setAttribute("aria-label", tr(maximizeLabel));
  const closeButton = make("button", "m3shell-control", "×");
  closeButton.type = "button";
  closeButton.title = tr("Close");
  closeButton.setAttribute("aria-label", tr("Close"));
  controls.append(maximizeButton, closeButton);
  header.append(heading, controls);

  const content = make("div", "m3shell-content");
  windowEl.append(header, content);
  overlay.appendChild(windowEl);

  let maximized = false;
  let closed = false;
  let beforeMaximize = null;
  let resizeObserver = null;
  let cleanupLocalization = () => {};
  let dragState = null;

  function placeWindow(left, top, persist = true) {
    const rect = windowEl.getBoundingClientRect();
    const next = clampPosition(left, top, rect.width, rect.height);
    windowEl.style.position = "absolute";
    windowEl.style.left = `${Math.round(next.left)}px`;
    windowEl.style.top = `${Math.round(next.top)}px`;
    if (persist && !maximized) writePosition(storageKey, Math.round(next.left), Math.round(next.top));
    return next;
  }

  function restoreStoredPosition(fallback = null) {
    const rect = windowEl.getBoundingClientRect();
    const storedPosition = fallback || readPosition(storageKey);
    if (storedPosition) return placeWindow(storedPosition.left, storedPosition.top, false);
    return placeWindow((window.innerWidth - rect.width) / 2, (window.innerHeight - rect.height) / 2, false);
  }

  function setMaximized(next) {
    if (closed || maximized === next) return;
    if (next) {
      const rect = windowEl.getBoundingClientRect();
      beforeMaximize = {
        width: rect.width,
        height: rect.height,
        left: rect.left,
        top: rect.top,
      };
      if (rect.width > 0 && rect.height > 0) {
        writeSize(storageKey, Math.round(rect.width), Math.round(rect.height));
        writePosition(storageKey, Math.round(rect.left), Math.round(rect.top));
      }
      windowEl.classList.add("is-maximized");
      windowEl.style.position = "absolute";
      windowEl.style.left = "8px";
      windowEl.style.top = "8px";
      windowEl.style.width = "";
      windowEl.style.height = "";
      maximizeButton.textContent = "❐";
      maximizeButton.title = tr(restoreLabel);
      maximizeButton.setAttribute("aria-label", tr(restoreLabel));
    } else {
      windowEl.classList.remove("is-maximized");
      const size = beforeMaximize || readSize(storageKey) || { width: defaultWidth, height: defaultHeight };
      windowEl.style.width = `${Math.min(size.width, Math.max(320, window.innerWidth - 32))}px`;
      windowEl.style.height = `${Math.min(size.height, Math.max(320, window.innerHeight - 32))}px`;
      maximized = false;
      restoreStoredPosition(beforeMaximize && Number.isFinite(beforeMaximize.left)
        ? { left: beforeMaximize.left, top: beforeMaximize.top }
        : null);
      maximizeButton.textContent = "□";
      maximizeButton.title = tr(maximizeLabel);
      maximizeButton.setAttribute("aria-label", tr(maximizeLabel));
      onResize?.(windowEl.getBoundingClientRect(), { maximized });
      return;
    }
    maximized = next;
    onResize?.(windowEl.getBoundingClientRect(), { maximized });
  }

  function finishDrag(event) {
    if (!dragState) return;
    header.releasePointerCapture?.(event.pointerId);
    header.removeEventListener("pointermove", dragMove);
    header.removeEventListener("pointerup", finishDrag);
    header.removeEventListener("pointercancel", finishDrag);
    header.classList.remove("is-dragging");
    if (dragState.started && !maximized) {
      const rect = windowEl.getBoundingClientRect();
      writePosition(storageKey, Math.round(rect.left), Math.round(rect.top));
    }
    dragState = null;
  }

  function dragMove(event) {
    if (!dragState || event.pointerId !== dragState.pointerId) return;
    const dx = event.clientX - dragState.startX;
    const dy = event.clientY - dragState.startY;
    if (!dragState.started && Math.hypot(dx, dy) < 4) return;

    if (!dragState.started) {
      dragState.started = true;
      if (dragState.wasMaximized) {
        const ratio = dragState.startRect.width > 0
          ? (dragState.startX - dragState.startRect.left) / dragState.startRect.width
          : .5;
        setMaximized(false);
        const restored = windowEl.getBoundingClientRect();
        const left = event.clientX - restored.width * Math.max(.08, Math.min(.92, ratio));
        const top = Math.max(8, event.clientY - Math.min(18, header.getBoundingClientRect().height / 2));
        const placed = placeWindow(left, top, false);
        dragState.baseLeft = placed.left;
        dragState.baseTop = placed.top;
        dragState.startX = event.clientX;
        dragState.startY = event.clientY;
      }
      header.classList.add("is-dragging");
    }

    placeWindow(
      dragState.baseLeft + (event.clientX - dragState.startX),
      dragState.baseTop + (event.clientY - dragState.startY),
      false,
    );
  }

  function dragStart(event) {
    if (closed || event.button !== 0) return;
    if (event.target.closest?.(".m3shell-window-controls,button,input,select,textarea,a")) return;
    event.preventDefault();
    const rect = windowEl.getBoundingClientRect();
    dragState = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      baseLeft: rect.left,
      baseTop: rect.top,
      startRect: rect,
      wasMaximized: maximized,
      started: false,
    };
    header.setPointerCapture?.(event.pointerId);
    header.addEventListener("pointermove", dragMove);
    header.addEventListener("pointerup", finishDrag);
    header.addEventListener("pointercancel", finishDrag);
  }

  function close() {
    if (closed) return;
    closed = true;
    cleanupLocalization();
    resizeObserver?.disconnect();
    header.removeEventListener("pointerdown", dragStart);
    document.removeEventListener("keydown", keyHandler);
    window.removeEventListener("resize", viewportHandler);
    overlay.remove();
    onClose?.();
  }

  function keyHandler(event) {
    if (event.key === "Escape" && overlay.isConnected) close();
  }

  function viewportHandler() {
    if (maximized) {
      windowEl.style.left = "8px";
      windowEl.style.top = "8px";
      onResize?.(windowEl.getBoundingClientRect(), { maximized });
      return;
    }
    const rect = windowEl.getBoundingClientRect();
    const maxWidth = Math.max(320, window.innerWidth - 32);
    const maxHeight = Math.max(320, window.innerHeight - 32);
    if (rect.width > maxWidth) windowEl.style.width = `${maxWidth}px`;
    if (rect.height > maxHeight) windowEl.style.height = `${maxHeight}px`;
    const nextRect = windowEl.getBoundingClientRect();
    placeWindow(nextRect.left, nextRect.top, true);
  }

  maximizeButton.addEventListener("click", () => setMaximized(!maximized));
  closeButton.addEventListener("click", close);
  header.addEventListener("pointerdown", dragStart);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", keyHandler);
  window.addEventListener("resize", viewportHandler);

  if (globalThis.ResizeObserver) {
    resizeObserver = new ResizeObserver(() => {
      const rect = windowEl.getBoundingClientRect();
      if (!maximized && rect.width > 0 && rect.height > 0) {
        writeSize(storageKey, Math.round(rect.width), Math.round(rect.height));
        placeWindow(rect.left, rect.top, true);
      }
      onResize?.(rect, { maximized });
    });
    resizeObserver.observe(windowEl);
  }

  function mount(parent = document.body) {
    parent.appendChild(overlay);
    cleanupLocalization = installUiLocalization(windowEl);
    if (startMaximized) setMaximized(true);
    else {
      restoreStoredPosition();
      onResize?.(windowEl.getBoundingClientRect(), { maximized });
    }
    return api;
  }

  const api = {
    overlay,
    window: windowEl,
    header,
    content,
    title: titleEl,
    subtitle: subtitleEl,
    controls,
    maximizeButton,
    closeButton,
    mount,
    close,
    maximize: () => setMaximized(true),
    restore: () => setMaximized(false),
    toggleMaximize: () => setMaximized(!maximized),
    isMaximized: () => maximized,
    setSubtitle: (value) => { subtitleEl.textContent = value || ""; },
  };

  return api;
}
