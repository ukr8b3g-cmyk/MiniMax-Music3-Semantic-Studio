# Semantic Studio quick controls

Version 1.0 keeps the Song Timeline as the primary authoring surface.

## Timeline-front generation controls

Only the frequently adjusted generation values are mirrored into the Timeline song-settings row:

- CFG
- Duration

Music Seed and Top-K remain in the Generation workspace. Auto Sync with Timeline also remains in Generation and is not promoted to the Timeline front.

While Auto Sync remains enabled, the front Duration display follows the current Song Timeline total. A manual Duration edit is an explicit override: it disables Auto Sync when committed, updates the existing Generation draft, and uses the same Semantic undo/redo history. CFG follows the same Generation draft and history rather than maintaining a separate value.

The stored node widgets and existing generation contract remain unchanged.
