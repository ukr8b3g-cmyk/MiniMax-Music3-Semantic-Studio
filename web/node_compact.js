export function getNodeWidget(node, name) {
  return node?.widgets?.find((widget) => widget.name === name) || null;
}

export function setNodeWidgetHidden(widget, hidden = true) {
  if (!widget) return;
  widget.hidden = hidden;
  widget.options = widget.options || {};
  widget.options.hidden = hidden;
}

export function hideNodeWidgets(node, names = []) {
  for (const name of names) setNodeWidgetHidden(getNodeWidget(node, name), true);
}

function releaseSummary(value) {
  return String(value || "")
    .replace(/\s*·\s*schema\s*\d+/gi, "")
    .replace(/\s{2,}/g, " ")
    .trim();
}

export function installNodeSummary(node, {
  widgetName = "Studio Summary",
  text = "",
  minWidth = 340,
} = {}) {
  if (widgetName === "Studio Summary") {
    return {
      widget: null,
      update() {},
    };
  }

  let widget = node?.widgets?.find((w) => w.name === widgetName);
  if (!widget) {
    widget = node.addWidget?.("text", widgetName, releaseSummary(text), () => {}, { serialize: false });
    if (widget) {
      widget.serialize = false;
      widget.disabled = true;
      widget.options = widget.options || {};
      widget.options.serialize = false;
    }
  }
  if (widget) widget.value = releaseSummary(text);
  const current = node?.size || [minWidth, 180];
  node?.setSize?.([Math.max(current[0] || minWidth, minWidth), Math.max(140, Math.min(current[1] || 180, 260))]);
  node?.setDirtyCanvas?.(true, true);
  return {
    widget,
    update(value) {
      if (widget) widget.value = releaseSummary(value);
      node?.setDirtyCanvas?.(true, true);
    },
  };
}
