# Semantic Studio quick controls

Version 1.0 keeps the Song Timeline as the primary authoring surface.

## Timeline-front generation controls

Only the frequently adjusted generation values are mirrored into the Timeline song-settings row:

- CFG
- Duration

Music Seed and Top-K remain in the Generation workspace. Auto Sync with Timeline also remains in Generation and is not promoted to the Timeline front.

While Auto Sync remains enabled, the front Duration display follows the current Song Timeline total. A manual Duration edit becomes an explicit override when the Generation workspace is opened or the project is saved; Auto Sync is then disabled and the existing Generation draft is updated. CFG follows the same Generation draft rather than maintaining a separate stored value.

The stored node widgets and existing generation contract remain unchanged.
