const INSTALLED = "m3ssNumericRoundingInstalled";

function decimalPlaces(step) {
  const value = Number(step);
  if (!Number.isFinite(value) || value <= 0) return null;
  const text = String(value).toLowerCase();
  if (text.includes("e-")) return Math.min(6, Number(text.split("e-")[1]) || 0);
  const fraction = text.split(".")[1] || "";
  return Math.min(6, fraction.length);
}

export function roundedNumericText(value, step) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value ?? "");
  const places = decimalPlaces(step);
  if (places == null) return String(number);
  const factor = 10 ** places;
  const scaled = Math.abs(number) * factor;
  const rounded = Math.sign(number) * (Math.round(scaled + Number.EPSILON) / factor);
  return String(Object.is(rounded, -0) ? 0 : rounded);
}

function roundInput(control) {
  if (!(control instanceof HTMLInputElement) || control.type !== "number") return;
  if (control.value === "") return;
  const next = roundedNumericText(control.value, control.step);
  if (next !== control.value) control.value = next;
}

function roundTree(root) {
  if (!root?.querySelectorAll) return;
  for (const control of root.querySelectorAll('input[type="number"]')) roundInput(control);
}

function install(dialog) {
  if (!dialog || dialog.dataset[INSTALLED] === "1") return;
  dialog.dataset[INSTALLED] = "1";

  const roundSoon = () => queueMicrotask(() => {
    if (dialog.isConnected) roundTree(dialog);
  });
  const focusIn = (event) => roundInput(event.target);
  const changeCapture = (event) => roundInput(event.target);
  const click = () => roundSoon();
  const workspaceChange = () => roundSoon();

  roundTree(dialog);
  dialog.addEventListener("focusin", focusIn, true);
  dialog.addEventListener("change", changeCapture, true);
  dialog.addEventListener("click", click, true);
  dialog.addEventListener("m3ss-workspace-mode-change", workspaceChange);

  const cleanup = () => {
    dialog.removeEventListener("focusin", focusIn, true);
    dialog.removeEventListener("change", changeCapture, true);
    dialog.removeEventListener("click", click, true);
    dialog.removeEventListener("m3ss-workspace-mode-change", workspaceChange);
  };
  dialog.addEventListener("m3ss-shell-close", cleanup, { once: true });
}

if (typeof document !== "undefined") {
  document.addEventListener("m3ss-audio-workspace-ready", (event) => {
    const dialog = event.target?.closest?.(".m3ssv2-dialog") || event.target;
    if (dialog?.matches?.(".m3ssv2-dialog")) install(dialog);
  });
}
