# Semantic Studio quick controls

Version 1.0 keeps the Song Timeline as the primary authoring surface.

## Timeline-front generation controls

Only the frequently adjusted generation values are mirrored into the Timeline song-settings row:

- CFG
- Duration

Music Seed and Top-K remain in the Generation workspace. Auto Sync with Timeline also remains in Generation and is not promoted to the Timeline front. A manual Duration edit is treated as an explicit override and disables Auto Sync when the draft is synchronized.

The quick controls synchronize back into the existing Generation draft before Save to Node, so the stored node widgets and existing generation contract remain unchanged.
