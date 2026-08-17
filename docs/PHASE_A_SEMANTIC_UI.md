# Semantic Studio — Timeline / Lyrics / Generation UI

Status: implemented in frontend; ComfyUI visual/integration verification pending.

The V1 Semantic Studio uses three horizontal authoring views without changing the public node contract, `project_json.schema_version`, MiniMax Music3 backend, KSampler, or V2.1 DSP/effects.

## Navigation

Normal navigation contains:

- **Timeline** (default)
- **Lyrics**
- **Generation**

The tabs use explicit bordered/background states rather than text-only navigation. Undo / Redo is grouped on the left with distinct accents.

Both Semantic Studio and the Audio Editor open maximized by default. Restore returns to the remembered normal window size.

## Undo / Redo

Semantic Studio keeps editor-session history with visible **Undo / Redo** controls.

- `Ctrl/Cmd+Z` — Undo
- `Ctrl/Cmd+Shift+Z` or `Ctrl/Cmd+Y` — Redo
- text/slider bursts are coalesced
- section add/delete/duplicate/reorder, duration/energy/instrument edits, Global/Main Vocal/Inspector edits, Prompt Import apply, Full Lyrics apply, and Generation-tab edits participate in history
- history is session-only and is not serialized into `project_json`

## Timeline

Timeline keeps the existing song-wide fields and semantic structure.

Song Settings exposes:

- Genre
- BPM
- Key
- Scale / Mode
- Effective Key (derived display such as `D minor`; it does not rewrite the stored Key/Scale)
- Meter
- Vocal / Instrumental mode

`Main Vocal` remains a visually differentiated accordion and defaults open for new UI state.

`More Settings` contains Working title, Subgenres / influences, Mood / direction and Production profile.

### Song Timeline accordion

The complete timeline editor is wrapped in a **Song Timeline** accordion. New UI state defaults open and the open/closed state is remembered locally.

Timeline row order remains:

1. Structure
2. Energy
3. Lyrics summary
4. Vocal Style
5. Instruments

Structure blocks can be reordered by drag/drop or Inspector arrows. New sections are inserted after the current selection. Duration edges, Energy points and Instrument cells remain directly editable and participate in Undo / Redo.

### Instruments

Instrument lanes still represent `section.instruments[]`; they are semantic generation guidance, not separated audio stems.

- group is collapsible
- each unique instrument becomes one lane when expanded
- active cells add/remove the instrument for that section
- active states use a thicker rounded colored lane for better visibility
- underlying saved values remain unchanged

## Lyrics

Lyrics remains a three-pane authoring view on wide windows:

1. Caption
2. Full Lyrics
3. Section Lyrics

Pane dividers remain draggable and remembered. Caption stays the authoritative compiled preview unless switched into temporary Draft Editing. Normal Prompt Import defaults to Replace section structure; Merge remains available.

## Generation

Generation is the dedicated UI for the existing MiniMax Music3 autoregressive generation widgets:

- **Music Seed (AR)** → existing node `seed`
- **Duration Limit** → existing node `max_duration`
- **Music CFG (AR)** → existing node `cfg_scale`
- **Music Top-K** → existing node `top_k`

These values are not duplicated into `project_json`. The Generation tab reads the existing node widgets when opened and writes them back when **Save to Node** is used.

The naming intentionally distinguishes them from KSampler controls:

- Music Seed (AR) affects MiniMax Music3's autoregressive music/token generation stage.
- KSampler Seed creates diffusion latent noise later in the graph.
- Music CFG (AR) guides the MiniMax autoregressive token stage.
- KSampler CFG guides diffusion later in the graph.
- Music Top-K has no KSampler counterpart.

### Duration synchronization

Generation displays both **Timeline Total** and **Duration Limit**.

`Auto Sync with Timeline` defaults on and is remembered as local UI state. When enabled, Duration Limit follows the semantic section-duration total. When disabled, the user can set an independent AR generation ceiling. Duration Limit remains a maximum; MiniMax Music3 may stop before that limit.

The compact graph node hides the routine AR widgets while keeping them alive as the actual serialized ComfyUI widgets; Generation is only a clearer editing surface for those same values.

## English / Japanese UI

The extension supports English and Japanese UI chrome.

- `Comfy.Locale = ja...` → Japanese labels
- all other locales → English fallback
- custom-node `locales/en/nodeDefs.json` and `locales/ja/nodeDefs.json` provide node-definition labels/tooltips
- Studio / Audio Editor custom frontend surfaces use the current ComfyUI locale through the extension-facing settings API
- prompt values, preset values and data written to MiniMax/project JSON are **not translated**

Japanese translation is therefore a presentation layer only; it does not change prompt semantics or saved schemas.

## Audio Editor visual consistency

The Audio Editor keeps the Unified Waveform architecture and schema 2. This UI-polish pass only clarifies competing highlights:

- playhead uses a thin cyan line
- selected clip uses violet emphasis
- waveform selection uses blue/cyan emphasis
- gain envelope remains orange/amber

No V2.1 DSP effects are introduced by this pass.

## Data / compatibility

- V1 node ID `MiniMaxMusic3SemanticStudio` unchanged
- V1 outputs `(CONDITIONING, seconds)` unchanged
- `project_json.schema_version` remains 1
- V2 Audio Editor remains a separate `AUDIO -> AUDIO` node
- Generation uses the existing node widgets rather than new project fields
- unknown project fields remain preserved by the existing normalization path
- no Python runtime dependency added
- no ComfyUI core, KSampler, MiniMax built-in node, VAE, or sampler patch
- no V2.1 DSP/effects included
