const STYLE_ID = "m3ss-common-shell-style";

export function ensureStudioShellStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./studio_shell.css", import.meta.url).href;
  document.head.appendChild(link);
}

function make(tag, className = "", text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function readSize(storageKey) {
  if (!storageKey) return null;
  try {
    const raw = localStorage.getItem(`${storageKey}:size`);
    if (!raw) return null;
    const value = JSON.parse(raw);
    if (!Number.isFinite(value?.width) || !Number.isFinite(value?.height)) return null;
    return value;
  } catch {
    return null;
  }
}

function writeSize(storageKey, width, height) {
  if (!storageKey) return;
  try {
    localStorage.setItem(`${storageKey}:size`, JSON.stringify({ width, height }));
  } catch {
    // Storage can be unavailable in hardened/private browser contexts.
  }
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
  maximizeButton.title = maximizeLabel;
  maximizeButton.setAttribute("aria-label", maximizeLabel);
  const closeButton = make("button", "m3shell-control", "×");
  closeButton.type = "button";
  closeButton.title = "Close";
  closeButton.setAttribute("aria-label", "Close");
  controls.append(maximizeButton, closeButton);
  header.append(heading, controls);

  const content = make("div", "m3shell-content");
  windowEl.append(header, content);
  overlay.appendChild(windowEl);

  let maximized = false;
  let closed = false;
  let beforeMaximize = null;
  let resizeObserver = null;

  function setMaximized(next) {
    if (closed || maximized === next) return;
    if (next) {
      beforeMaximize = {
        width: windowEl.getBoundingClientRect().width,
        height: windowEl.getBoundingClientRect().height,
      };
      windowEl.classList.add("is-maximized");
      windowEl.style.width = "";
      windowEl.style.height = "";
      maximizeButton.textContent = "❐";
      maximizeButton.title = restoreLabel;
      maximizeButton.setAttribute("aria-label", restoreLabel);
    } else {
      windowEl.classList.remove("is-maximized");
      const size = beforeMaximize || readSize(storageKey) || { width: defaultWidth, height: defaultHeight };
      windowEl.style.width = `${Math.min(size.width, Math.max(320, window.innerWidth - 32))}px`;
      windowEl.style.height = `${Math.min(size.height, Math.max(320, window.innerHeight - 32))}px`;
      maximizeButton.textContent = "□";
      maximizeButton.title = maximizeLabel;
      maximizeButton.setAttribute("aria-label", maximizeLabel);
    }
    maximized = next;
    onResize?.(windowEl.getBoundingClientRect(), { maximized });
  }

  function close() {
    if (closed) return;
    closed = true;
    resizeObserver?.disconnect();
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
      onResize?.(windowEl.getBoundingClientRect(), { maximized });
      return;
    }
    const rect = windowEl.getBoundingClientRect();
    const maxWidth = Math.max(320, window.innerWidth - 32);
    const maxHeight = Math.max(320, window.innerHeight - 32);
    if (rect.width > maxWidth) windowEl.style.width = `${maxWidth}px`;
    if (rect.height > maxHeight) windowEl.style.height = `${maxHeight}px`;
  }

  maximizeButton.addEventListener("click", () => setMaximized(!maximized));
  closeButton.addEventListener("click", close);
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
      }
      onResize?.(rect, { maximized });
    });
    resizeObserver.observe(windowEl);
  }

  function mount(parent = document.body) {
    parent.appendChild(overlay);
    onResize?.(windowEl.getBoundingClientRect(), { maximized });
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
