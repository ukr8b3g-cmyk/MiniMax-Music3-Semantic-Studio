function clone(value) {
  return JSON.parse(JSON.stringify(value));
}

export class SemanticHistory {
  constructor({ limit = 100, coalesceMs = 700 } = {}) {
    this.limit = Math.max(1, Number(limit) || 100);
    this.coalesceMs = Math.max(0, Number(coalesceMs) || 0);
    this.undoStack = [];
    this.redoStack = [];
    this.lastGroup = null;
    this.lastGroupAt = 0;
  }

  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  capture(state, group = null, now = Date.now()) {
    const key = group == null ? null : String(group);
    const coalesced = key !== null && key === this.lastGroup && now - this.lastGroupAt <= this.coalesceMs;
    if (!coalesced) {
      this.undoStack.push(clone(state));
      if (this.undoStack.length > this.limit) this.undoStack.shift();
    }
    this.redoStack.length = 0;
    this.lastGroup = key;
    this.lastGroupAt = now;
    return !coalesced;
  }

  breakGroup() {
    this.lastGroup = null;
    this.lastGroupAt = 0;
  }

  undo(currentState) {
    if (!this.canUndo) return null;
    this.redoStack.push(clone(currentState));
    this.breakGroup();
    return clone(this.undoStack.pop());
  }

  redo(currentState) {
    if (!this.canRedo) return null;
    this.undoStack.push(clone(currentState));
    if (this.undoStack.length > this.limit) this.undoStack.shift();
    this.breakGroup();
    return clone(this.redoStack.pop());
  }

  clear() {
    this.undoStack.length = 0;
    this.redoStack.length = 0;
    this.breakGroup();
  }
}
