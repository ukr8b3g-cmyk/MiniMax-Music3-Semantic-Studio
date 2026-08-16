# Semantic Studio preset policy

Status: implemented before V2.0 UX Final.

The Semantic Studio uses preset catalogs as authoring aids, not as model-side enums. Every preset-backed field that can reasonably receive free-form MiniMax wording remains editable so Prompt Import and external-LLM output are never rejected merely because a value is not in the local catalog.

## Source policy

Genre, vocal-style, instrument/texture and BPM starting points are based on MiniMax's public music prompt-writing guide. The guide explicitly favors vivid descriptive English sentences over comma-only tag lists, so the Studio stores semantic values and the existing compiler turns them into structured natural-language Caption text.

Curated convenience lists such as mood and per-section vocal shorthand are UI suggestions only. They are not presented as official MiniMax enums.

## Controls

- Genre: searchable editable combo; official-guide genre catalog plus custom text.
- Subgenres / influences: multi-value chips; genre reference suggestions plus custom values.
- BPM: direct numeric input plus feel presets (50/70/95/120/140 BPM starting points).
- Meter: finite dropdown.
- Key: editable combo; common key suggestions plus custom imported wording.
- Scale / mode: editable combo; common modes plus custom imported wording.
- Mood / direction: multi-value chips with curated suggestions and custom values.
- Vocal mode: finite Vocal / Instrumental dropdown.
- Lead / voice type: editable combo.
- Timbre / character: editable combo using MiniMax vocal-style examples.
- Delivery: editable combo using MiniMax vocal-delivery examples.
- Instruments: searchable multi-value chips using the MiniMax instrument/texture reference, plus custom values.
- Production: free-form textarea with suggestion chips.

## Import compatibility

Prompt Import remains authoritative for imported values. If an imported genre, key, scale, vocal description, mood, instrument or production phrase is not in the preset catalog, the Studio displays and saves that custom value unchanged. No preset selection is required before `Save to Node`.

No V1 `project_json` schema migration is required for this UI change.
