import test from 'node:test';
import assert from 'node:assert/strict';
import { SemanticHistory } from '../../web/semantic_history.js';

test('semantic history restores full snapshots through undo and redo', () => {
  const history = new SemanticHistory({ limit: 10, coalesceMs: 0 });
  let state = { project: { value: 1 }, selectedId: 'a' };
  history.capture(state);
  state = { project: { value: 2 }, selectedId: 'b' };

  const previous = history.undo(state);
  assert.deepEqual(previous, { project: { value: 1 }, selectedId: 'a' });
  assert.equal(history.canRedo, true);

  const next = history.redo(previous);
  assert.deepEqual(next, { project: { value: 2 }, selectedId: 'b' });
});

test('semantic history coalesces a burst of edits with the same group', () => {
  const history = new SemanticHistory({ coalesceMs: 700 });
  history.capture({ value: 'a' }, 'title', 1000);
  history.capture({ value: 'ab' }, 'title', 1200);
  history.capture({ value: 'abc' }, 'title', 1400);
  assert.equal(history.undoStack.length, 1);

  history.capture({ value: 'abcd' }, 'title', 2200);
  assert.equal(history.undoStack.length, 2);
});

test('a new edit clears redo history', () => {
  const history = new SemanticHistory({ coalesceMs: 0 });
  history.capture({ value: 1 });
  const previous = history.undo({ value: 2 });
  assert.equal(history.canRedo, true);
  history.capture(previous);
  assert.equal(history.canRedo, false);
});
