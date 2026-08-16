# Semantic Studio — Timeline / Lyrics UI

Status: implemented in frontend; ComfyUI visual/integration verification pending.

The V1 Semantic Studio is organized around two horizontal views without changing the public node contract or adding V2.1 audio effects.

## Navigation

Normal navigation contains only:

- Timeline (default)
- Lyrics

The former Overview / Global / Arrangement / Vocal / Advanced / Prompt pages are folded into these two views and the Timeline Section Inspector.

## Timeline song settings

The Timeline header exposes the high-frequency song-wide fields already stored in `project_json.global`:

- Genre
- BPM
- Key
- Scale / Mode
- Meter
- Vocal / Instrumental mode

`Main Vocal` is a compact expandable row containing song-wide lead/voice type, timbre/character, delivery, harmony and vocal-effects wording.

`More Settings` expands Working title, Subgenres / influences, Mood / direction and Production profile. Preset-backed expressive controls remain editable and imported/custom wording is not locked.

## Timeline rows

Timeline order:

1. Structure
2. Energy
3. Lyrics summary
4. Vocal Style
5. Instruments (collapsible)

Section type determines UI color only. Color is not added to `project_json`.

The selected section receives a low-opacity vertical highlight through all Timeline rows.

### Structure

- width represents section `duration`
- right-edge drag changes duration
- Shift + drag trades duration with the following section
- semantic duration is normalized to 0.1 second steps
- section type can be selected when adding a new section

### Vocal Style

Timeline Vocal Style displays the existing per-section `section.vocal` semantic wording. It is intentionally distinct from the song-wide Main Vocal character.

Long common values use compact display aliases only, for example:

- `soft half-sung half-spoken` -> `Soft / Half-spoken`
- `soft lead with murmured doubles` -> `Soft + Doubles`
- `hushed hums` -> `Hushed`
- `instrumental` -> `Inst.`

The underlying project wording is not rewritten by these display aliases. Detailed editing remains available in the Section Inspector.

### Instruments

Instrument lanes are derived directly from existing `section.instruments[]` values. There is no stem/separation model behind this view.

- Instruments is the bottom Timeline group
- a visible `▸ / ▾` affordance indicates collapse/expand state
- each unique instrument becomes one lane when expanded
- an active cell means that instrument is present in that section
- clicking a cell adds/removes the instrument from `section.instruments[]`
- custom instruments added in the Inspector automatically appear as lanes
- the collapsed state shows compact per-section instrument counts

## Lyrics view

On wide windows Lyrics uses three columns:

1. Caption
2. Full Lyrics
3. Section Lyrics

The view reflows responsively on smaller windows.

### Caption

Caption is the authoritative compiler output in normal mode and is read-only.

`Edit` switches the same field into a temporary Draft mode. Draft text is not authoritative project state. `Analyze & Import` opens the existing deterministic Analyze -> Import Preview -> Apply workflow prefilled with the edited Caption and current Lyrics. Caption Draft uses Merge by default because it begins from the current project.

`Import Prompt` remains available from the Caption panel. Normal external Prompt Import defaults to Replace section structure, while Merge remains selectable.

### Full Lyrics

Full Lyrics is an editable complete tagged representation using canonical section tags such as `[Intro]`, `[Verse]`, `[Chorus]` and `[Instrumental]`.

`Apply to Sections` uses the existing Prompt Import parser and merge engine, scoped so matching sections update only their Lyrics. Timing, energy, instruments, vocal style and existing labels are preserved for matching sections. New supported tagged sections may be appended using normal import defaults.

### Section Lyrics

Section Lyrics is a one-section-at-a-time accordion:

- every row always shows `▸ / ▾`
- empty sections remain compact
- empty/Instrumental sections show `No lyrics`
- textareas start small and grow with content until a bounded internal scroll height
- editing a Section updates the derived Full Lyrics display when the Full Lyrics draft is not independently dirty

## Prompt Import

Prompt parsing remains deterministic and local. No connected LLM, network service or model runtime is needed for Analyze / Preview / Apply.

The normal external import default is Replace section structure. Merge detected fields remains available for incremental edits.

## Data / compatibility

- public V1 node ID and `(CONDITIONING, seconds)` outputs are unchanged
- `project_json.schema_version` remains 1
- no new required project field is introduced
- section colors, top-tab choice, accordion state, Caption Draft and Full Lyrics Draft are presentation/session state only
- existing `global`, `timeline.sections`, `section.instruments`, `section.vocal`, `lyrics` and `directives` fields remain the saved source of truth
- Prompt Preview / normal Caption remains the authoritative compiler output
- no Python runtime dependency is added
- no V2.1 DSP/effects are included
