import { app } from "../../scripts/app.js";
import { createStudioWindow } from "./studio_shell.js";
import { hideNodeWidgets, installNodeSummary, getNodeWidget } from "./node_compact.js";
import { installCssSizeDrag, makeVerticalSplitter, readLayoutNumber, writeLayoutNumber } from "./layout_splitter.js";
import {
  SECTION_TYPES, METERS, clamp, uid, factoryProject, normalizeProject,
  parseList, totalDuration, summarizeProject, compilePreview, el, button, textInput, numberInput,
  selectInput, textarea, field,
} from "./semantic_studio_core.js";
import { editableCombo, chipEditor, textareaWithSuggestions, bpmControl } from "./semantic_controls.js";
import { fitTimelineScale, renderSemanticTimeline } from "./semantic_timeline.js";
import {
  GENRE_PRESETS, INFLUENCE_PRESETS, MOOD_PRESETS, VOCAL_LEAD_PRESETS, VOCAL_TIMBRE_PRESETS,
  VOCAL_DELIVERY_PRESETS, SECTION_VOCAL_PRESETS, INSTRUMENT_PRESETS, PRODUCTION_SUGGESTIONS,
  BPM_PRESETS, KEY_PRESETS, SCALE_PRESETS,
} from "./semantic_presets.js";

const EXTENSION_NAME = "minimax.music3.semantic.studio";
const NODE_ID = "MiniMaxMusic3SemanticStudio";
const STYLE_ID = "m3ss-style-link";
const NAV = [
  ["overview", "Overview"], ["timeline", "Timeline"], ["global", "Global"], ["lyrics", "Lyrics"], ["vocal", "Vocal"],
  ["arrangement", "Arrangement"], ["advanced", "Advanced"], ["preview", "Prompt Preview"],
];
const STRUCTURE_COLUMNS = [
  { key: "section", label: "Section", css: "--m3ss-col-section", defaultSize: 190, minSize: 120, maxSize: 420 },
  { key: "type", label: "Type", css: "--m3ss-col-type", defaultSize: 100, minSize: 78, maxSize: 180 },
  { key: "duration", label: "Duration", css: "--m3ss-col-duration", defaultSize: 92, minSize: 74, maxSize: 150 },
  { key: "energy", label: "Energy", css: "--m3ss-col-energy", defaultSize: 80, minSize: 68, maxSize: 130 },
  { key: "instruments", label: "Instruments", css: "--m3ss-col-instruments", defaultSize: 240, minSize: 160, maxSize: 620 },
];

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./semantic_studio.css", import.meta.url).href;
  document.head.appendChild(link);
}

function nodeClass(node) {
  return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function openStudio(node, compactSummary) {
  ensureStyles();
  const projectWidget = getNodeWidget(node, "project_json");
  if (!projectWidget) {
    alert("Music3 Semantic Studio: project_json widget was not found. Restart ComfyUI and reload the workflow.");
    return;
  }

  let raw;
  try {
    raw = JSON.parse(projectWidget.value || "{}");
  } catch (error) {
    if (!confirm(`Studio Project JSON is invalid. Reset to V1 defaults?\n\n${error}`)) return;
    raw = factoryProject();
  }

  let project = normalizeProject(raw);
  if (!project.project_id) project.project_id = uid("project");
  let active = "overview";
  let selectedId = project.timeline.sections[0]?.id || null;
  let timelinePxPerSecond = clamp(readLayoutNumber("semantic-timeline-scale", 7), 3, 20);
  let cleanup = () => {};

  const shell = createStudioWindow({
    title: "Music3 Semantic Studio",
    subtitle: `Phase 1 / Semantic authoring · ${summarizeProject(project)}`,
    storageKey: "m3ss-semantic-window",
    defaultWidth: 1360,
    defaultHeight: 860,
    minWidth: 820,
    minHeight: 560,
    onClose: () => cleanup(),
  });
  shell.window.classList.add("m3ss-dialog");

  const workspace = el("div", "m3ss-workspace");
  const nav = el("aside", "m3ss-nav");
  const center = el("main", "m3ss-center");
  const paneSplitter = makeVerticalSplitter("m3ss-pane-splitter");
  const inspector = el("aside", "m3ss-inspector");
  const footer = el("footer", "m3ss-footer");
  shell.content.append(workspace, footer);
  workspace.append(nav, center, paneSplitter, inspector);

  const cleanupPaneSplitter = installCssSizeDrag({
    handle: paneSplitter,
    target: workspace,
    cssVariable: "--m3ss-inspector-width",
    storageKey: "semantic-inspector-width",
    defaultSize: 390,
    minSize: 300,
    maxSize: 720,
    invert: true,
  });
  cleanup = cleanupPaneSplitter;

  const navButtons = new Map();
  for (const [id, label] of NAV) {
    const item = button(label, "m3ss-nav-button");
    item.dataset.view = id;
    item.onclick = () => { active = id; render(); };
    navButtons.set(id, item);
    nav.appendChild(item);
  }
  nav.appendChild(el("div", "m3ss-nav-note", "Preset lists are authoring aids only. Imported or custom Music3 wording is preserved."));

  const durationStatus = el("div", "m3ss-duration-status");
  const actions = el("div", "m3ss-footer-actions");
  const reset = button("Reset", "m3ss-button secondary");
  const cancel = button("Cancel", "m3ss-button secondary");
  const save = button("Save to Node", "m3ss-button primary");
  actions.append(reset, cancel, save);
  footer.append(durationStatus, actions);

  const selected = () => project.timeline.sections.find((section) => section.id === selectedId) || project.timeline.sections[0] || null;
  const mark = () => {
    shell.setSubtitle(`Phase 1 / Semantic authoring · ${summarizeProject(project)}`);
    durationStatus.textContent = `${totalDuration(project).toFixed(2)} s · ${project.timeline.sections.length} sections · changes stay local until Save to Node`;
  };
  const update = (fn) => { fn(); mark(); };
  const refreshTimeline = () => { if (active === "timeline") renderTimelineView(); };

  function sectionRow(section, index) {
    const row = el("button", `m3ss-structure-row m3ss-structure-grid${section.id === selectedId ? " is-selected" : ""}`);
    row.type = "button";
    row.onclick = () => { selectedId = section.id; render(); };
    row.append(
      el("span", "m3ss-structure-cell m3ss-row-index", String(index + 1)),
      el("span", "m3ss-structure-cell m3ss-row-name", section.label || section.type),
      el("span", "m3ss-structure-cell m3ss-row-type", section.type),
      el("span", "m3ss-structure-cell m3ss-row-duration", `${Number(section.duration).toFixed(1)} s`),
      el("span", "m3ss-structure-cell m3ss-row-energy", `${Math.round(Number(section.energy) * 100)}%`),
      el("span", "m3ss-structure-cell m3ss-row-inst", section.instruments?.join(", ") || "—"),
    );
    return row;
  }

  function buildStructureTable() {
    const table = el("div", "m3ss-structure");
    const header = el("div", "m3ss-structure-header m3ss-structure-grid");
    header.appendChild(el("div", "m3ss-head-cell is-index", "#"));
    for (const column of STRUCTURE_COLUMNS) {
      const cell = el("div", "m3ss-head-cell", column.label);
      const resizeHandle = el("span", "m3ss-column-splitter");
      resizeHandle.title = `${column.label} width · drag to resize · double-click to reset`;
      cell.appendChild(resizeHandle);
      header.appendChild(cell);
      installCssSizeDrag({
        handle: resizeHandle,
        target: table,
        cssVariable: column.css,
        storageKey: `semantic-structure-${column.key}`,
        defaultSize: column.defaultSize,
        minSize: column.minSize,
        maxSize: column.maxSize,
      });
    }
    table.appendChild(header);
    project.timeline.sections.forEach((section, index) => table.appendChild(sectionRow(section, index)));
    return table;
  }

  function renderOverview() {
    center.replaceChildren();
    const global = project.global;
    const head = el("div", "m3ss-center-head");
    const headText = el("div");
    headText.append(
      el("h3", "m3ss-view-title", "Global Overview"),
      el("p", "m3ss-view-note", "Choose a MiniMax-guided preset or type any custom wording. Presets never limit imported values."),
    );
    const add = button("+ Section", "m3ss-button secondary");
    head.append(headText, add);
    add.onclick = () => {
      if (project.timeline.sections.length >= 32) return alert("V1 supports up to 32 sections.");
      const section = {
        id: uid("verse"), type: "Verse",
        label: `Verse ${project.timeline.sections.filter((item) => item.type === "Verse").length + 1}`,
        duration: 16, energy: 0.5, lyrics: "", instruments: [], vocal: "", directives: "",
      };
      project.timeline.sections.push(section);
      selectedId = section.id;
      mark();
      render();
    };
    center.appendChild(head);

    const grid = el("div", "m3ss-overview-grid");
    const genre = editableCombo({ value: global.genre, options: GENRE_PRESETS, placeholder: "Search preset or type custom genre…", onInput: (value) => { global.genre = value; mark(); } });
    const mood = editableCombo({ value: global.mood, options: MOOD_PRESETS, placeholder: "Search mood or type custom direction…", onInput: (value) => { global.mood = value; mark(); } });
    const bpm = bpmControl({ value: global.bpm || 120, presets: BPM_PRESETS, onChange: (value) => { global.bpm = value; mark(); } });
    const meter = selectInput(METERS.includes(global.meter) ? METERS : [...METERS, global.meter], global.meter || "4/4");
    meter.onchange = () => { global.meter = meter.value; mark(); };
    const mode = selectInput([{ value: "vocal", label: "Vocal" }, { value: "instrumental", label: "Instrumental" }], global.vocal?.mode || "vocal");
    mode.onchange = () => { global.vocal.mode = mode.value; mark(); };
    const production = textInput(global.production, "vinyl, tape hiss, warm, wide…");
    production.oninput = () => { global.production = production.value; mark(); };
    grid.append(
      field("Genre / Style", genre), field("Mood", mood), field("BPM", bpm), field("Meter", meter),
      field("Vocal mode", mode), field("Production", production),
    );
    center.appendChild(grid);
    center.appendChild(el("h3", "m3ss-section-heading", "Song Structure"));
    center.appendChild(buildStructureTable());
  }

  function renderTimelineView() {
    center.replaceChildren();
    const head = el("div", "m3ss-center-head m3ss-timeline-view-head");
    const headText = el("div");
    headText.append(
      el("h3", "m3ss-view-title", "Song Timeline"),
      el("p", "m3ss-view-note", "Section width represents duration. Drag a section's right edge to change time; Shift+drag shares time with the next section. Drag Energy points vertically."),
    );
    const controls = el("div", "m3ss-timeline-controls");
    const fit = button("Fit", "m3ss-button secondary");
    const zoom = document.createElement("input");
    zoom.type = "range";
    zoom.min = "3";
    zoom.max = "20";
    zoom.step = "0.5";
    zoom.value = String(timelinePxPerSecond);
    zoom.title = "Timeline horizontal scale";
    controls.append(el("span", "m3ss-timeline-scale-label", "Scale"), zoom, fit);
    head.append(headText, controls);
    center.appendChild(head);

    const host = el("div", "m3ss-timeline-host");
    center.appendChild(host);
    renderSemanticTimeline(host, project, selectedId, {
      pxPerSecond: timelinePxPerSecond,
      onSelect: (id, options = {}) => {
        selectedId = id;
        if (options.render === false) {
          renderInspector();
          return;
        }
        render();
      },
      onChange: () => {
        mark();
        render();
      },
    });

    zoom.oninput = () => {
      timelinePxPerSecond = clamp(zoom.value, 3, 20);
      writeLayoutNumber("semantic-timeline-scale", timelinePxPerSecond);
      renderTimelineView();
    };
    fit.onclick = () => {
      timelinePxPerSecond = fitTimelineScale(center.clientWidth, totalDuration(project));
      writeLayoutNumber("semantic-timeline-scale", timelinePxPerSecond);
      renderTimelineView();
    };
  }

  function renderGlobal() {
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Global"),
      el("p", "m3ss-view-note", "Official-guide presets are searchable starting points. Every editable preset control accepts custom text, including values imported from an external LLM."),
    );
    const global = project.global;
    const grid = el("div", "m3ss-form-grid");

    const title = textInput(global.title, "Optional project title");
    title.oninput = () => { global.title = title.value; mark(); };
    grid.appendChild(field("Working title", title, "Project-only; not injected into the caption."));

    const genre = editableCombo({
      value: global.genre,
      options: GENRE_PRESETS,
      placeholder: "Pop, Lo-fi Hip-Hop, Jazz Fusion… or custom",
      onInput: (value) => { global.genre = value; mark(); },
    });
    grid.appendChild(field("Genre", genre, "Search the MiniMax genre reference or type a custom genre/blend."));

    const influences = chipEditor({
      values: global.subgenres || [],
      suggestions: INFLUENCE_PRESETS,
      placeholder: "Add influence / subgenre…",
      onChange: (values) => { global.subgenres = values; mark(); },
    });
    grid.appendChild(field("Subgenres / influences", influences, "Multiple values are allowed; custom influences are preserved."));

    const bpm = bpmControl({ value: global.bpm || 120, presets: BPM_PRESETS, onChange: (value) => { global.bpm = value; mark(); } });
    grid.appendChild(field("BPM", bpm, "Preset ranges follow the MiniMax prompt guide; the numeric value remains fully editable."));

    const meter = selectInput(METERS.includes(global.meter) ? METERS : [...METERS, global.meter], global.meter || "4/4");
    meter.onchange = () => { global.meter = meter.value; mark(); };
    grid.appendChild(field("Meter", meter));

    const key = editableCombo({ value: global.key, options: KEY_PRESETS, placeholder: "C, D flat, G sharp… or custom", onInput: (value) => { global.key = value; mark(); } });
    grid.appendChild(field("Key", key, "Custom imported key wording is accepted."));

    const scale = editableCombo({ value: global.scale, options: SCALE_PRESETS, placeholder: "major, minor, dorian… or custom", onInput: (value) => { global.scale = value; mark(); } });
    grid.appendChild(field("Scale / mode", scale, "Custom scale or extension descriptions are accepted."));

    const mood = chipEditor({
      values: parseList(global.mood),
      suggestions: MOOD_PRESETS,
      placeholder: "Add mood / direction…",
      onChange: (values) => { global.mood = values.join(", "); mark(); },
    });
    grid.appendChild(field("Mood / direction", mood, "Choose several descriptors or enter your own wording."));

    const production = textareaWithSuggestions({
      value: global.production,
      placeholder: "Describe production, room, texture, mix character…",
      rows: 5,
      suggestions: PRODUCTION_SUGGESTIONS,
      onInput: (value) => { global.production = value; mark(); },
    });
    grid.appendChild(field("Production profile", production, "Suggestion chips append phrases; free-form editing remains available."));

    center.appendChild(grid);
  }

  function renderLyrics() {
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Lyrics"),
      el("p", "m3ss-view-note", "Choose a section below. Section tags are generated automatically."),
    );
    const list = el("div", "m3ss-lyrics-list");
    for (const section of project.timeline.sections) {
      const card = el("article", `m3ss-lyrics-card${section.id === selectedId ? " is-selected" : ""}`);
      const title = button(`${section.label || section.type} · ${Number(section.duration).toFixed(1)} s`, "m3ss-lyrics-title");
      title.onclick = () => { selectedId = section.id; render(); };
      const area = textarea(section.lyrics, "Lyrics for this section. Do not include [Verse]/[Chorus] tags.", 7);
      area.oninput = () => { section.lyrics = area.value; mark(); };
      card.append(title, area);
      list.appendChild(card);
    }
    center.appendChild(list);
  }

  function renderVocal() {
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Vocal"),
      el("p", "m3ss-view-note", "MiniMax recommends describing vocals as a character rather than a vague label. Presets are editable and never treated as model-side enums."),
    );
    const vocal = project.global.vocal;
    const grid = el("div", "m3ss-form-grid");

    const mode = selectInput([{ value: "vocal", label: "Vocal" }, { value: "instrumental", label: "Instrumental" }], vocal.mode || "vocal");
    mode.onchange = () => { vocal.mode = mode.value; mark(); };
    grid.appendChild(field("Mode", mode));

    const lead = editableCombo({ value: vocal.gender, options: VOCAL_LEAD_PRESETS, placeholder: "female vocal, warm male baritone, duet…", onInput: (value) => { vocal.gender = value; mark(); } });
    grid.appendChild(field("Lead / voice type", lead, "Preset or custom voice description."));

    const timbre = editableCombo({ value: vocal.timbre, options: VOCAL_TIMBRE_PRESETS, placeholder: "breathy and intimate, powerful and soulful…", onInput: (value) => { vocal.timbre = value; mark(); } });
    grid.appendChild(field("Timbre / character", timbre));

    const delivery = editableCombo({ value: vocal.delivery, options: VOCAL_DELIVERY_PRESETS, placeholder: "intimate phrasing, rhythmic intensity…", onInput: (value) => { vocal.delivery = value; mark(); } });
    grid.appendChild(field("Delivery", delivery));

    const harmony = textarea(vocal.harmony, "soft harmony in choruses, duet responses…", 4);
    harmony.oninput = () => { vocal.harmony = harmony.value; mark(); };
    grid.appendChild(field("Harmony / backing", harmony));

    const effects = textarea(vocal.effects, "room reverb, tape delay, lush reverb…", 4);
    effects.oninput = () => { vocal.effects = effects.value; mark(); };
    grid.appendChild(field("Vocal effects", effects));

    center.appendChild(grid);
  }

  function renderArrangement() {
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Arrangement"),
      el("p", "m3ss-view-note", "Instrument suggestions come from the MiniMax prompt guide; custom instruments and production textures can be added freely."),
    );
    const list = el("div", "m3ss-arrangement-list");
    for (const section of project.timeline.sections) {
      const card = el("article", `m3ss-arrangement-card${section.id === selectedId ? " is-selected" : ""}`);
      const title = button(section.label || section.type, "m3ss-arrangement-title");
      title.onclick = () => { selectedId = section.id; render(); };
      const instruments = chipEditor({
        values: section.instruments || [], suggestions: INSTRUMENT_PRESETS, placeholder: "Add instrument / texture…",
        onChange: (values) => { section.instruments = values; mark(); },
      });
      const directive = textarea(section.directives, "What enters, exits, intensifies, or changes?", 5);
      directive.oninput = () => { section.directives = directive.value; mark(); };
      card.append(title, field("Instruments", instruments), field("Directive", directive));
      list.appendChild(card);
    }
    center.appendChild(list);
  }

  function renderAdvanced() {
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Advanced"),
      el("p", "m3ss-view-note", "Generation parameters remain on the ComfyUI node. This view exposes project-level diagnostics without requiring raw JSON editing."),
    );
    const panel = el("div", "m3ss-diagnostic");
    panel.append(
      el("strong", "", `Project ID: ${project.project_id || "(new project)"}`),
      el("span", "", `Schema: ${project.schema_version}`),
      el("span", "", `Reserved V2 audio edits: ${project.audio_edits?.length || 0}`),
      el("span", "", `Reserved takes: ${project.takes?.length || 0}`),
      el("span", "", `Reserved V3 conditioning tracks: ${project.conditioning_tracks?.length || 0}`),
    );
    center.appendChild(panel);
  }

  function renderPreview() {
    const compiled = compilePreview(project);
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Prompt Preview"),
      el("div", "m3ss-callout", "This is the semantic text sent to MiniMax Music3. Presets and custom values compile through the same caption path; timing, BPM, key and energy remain generative targets."),
    );
    const grid = el("div", "m3ss-preview-grid");
    const caption = el("section", "m3ss-preview-panel");
    const lyrics = el("section", "m3ss-preview-panel");
    caption.append(el("h4", "", "Caption"), el("pre", "m3ss-pre", compiled.caption));
    lyrics.append(el("h4", "", "Lyrics"), el("pre", "m3ss-pre", compiled.lyrics || "(section tags only)"));
    grid.append(caption, lyrics);
    center.appendChild(grid);
  }

  function renderCenter() {
    if (active === "overview") renderOverview();
    else if (active === "timeline") renderTimelineView();
    else if (active === "global") renderGlobal();
    else if (active === "lyrics") renderLyrics();
    else if (active === "vocal") renderVocal();
    else if (active === "arrangement") renderArrangement();
    else if (active === "advanced") renderAdvanced();
    else renderPreview();
  }

  function renderInspector() {
    inspector.replaceChildren();
    const section = selected();
    inspector.appendChild(el("h3", "m3ss-inspector-title", "Section Inspector"));
    if (!section) {
      inspector.appendChild(el("div", "m3ss-empty", "Add a section to edit it."));
      return;
    }

    const type = selectInput(SECTION_TYPES, section.type);
    const label = textInput(section.label, section.type);
    const duration = numberInput(section.duration, 0.5, 360, 0.5);
    const energy = document.createElement("input");
    const energyValue = el("span", "m3ss-energy-value", `${Math.round(section.energy * 100)}%`);
    const instruments = chipEditor({
      values: section.instruments || [], suggestions: INSTRUMENT_PRESETS, placeholder: "Add instrument / texture…",
      onChange: (values) => { update(() => { section.instruments = values; }); refreshTimeline(); },
    });
    const vocal = editableCombo({
      value: section.vocal, options: SECTION_VOCAL_PRESETS, placeholder: "soft, power, instrumental… or custom",
      onInput: (value) => { update(() => { section.vocal = value; }); refreshTimeline(); },
    });
    const lyrics = textarea(section.lyrics, "Section lyrics", 7);
    const directive = textarea(section.directives, "Arrangement directive", 7);
    energy.type = "range";
    energy.min = "0";
    energy.max = "100";
    energy.step = "1";
    energy.value = String(Math.round(section.energy * 100));
    const energyWrap = el("div", "m3ss-energy-control");
    energyWrap.append(energy, energyValue);

    type.onchange = () => { update(() => { section.type = type.value; if (!section.label) section.label = type.value; }); refreshTimeline(); };
    label.oninput = () => { update(() => { section.label = label.value; }); refreshTimeline(); };
    duration.oninput = () => { update(() => { section.duration = clamp(duration.value, 0.5, 360); }); refreshTimeline(); };
    energy.oninput = () => { update(() => { section.energy = Number(energy.value) / 100; energyValue.textContent = `${energy.value}%`; }); refreshTimeline(); };
    lyrics.oninput = () => { update(() => { section.lyrics = lyrics.value; }); refreshTimeline(); };
    directive.oninput = () => { update(() => { section.directives = directive.value; }); refreshTimeline(); };

    const move = el("div", "m3ss-inspector-actions");
    const up = button("↑", "m3ss-icon-button");
    const down = button("↓", "m3ss-icon-button");
    const remove = button("Delete", "m3ss-button danger");
    const index = project.timeline.sections.indexOf(section);
    up.disabled = index <= 0;
    down.disabled = index >= project.timeline.sections.length - 1;
    up.onclick = () => {
      if (index <= 0) return;
      [project.timeline.sections[index - 1], project.timeline.sections[index]] = [project.timeline.sections[index], project.timeline.sections[index - 1]];
      mark(); render();
    };
    down.onclick = () => {
      if (index >= project.timeline.sections.length - 1) return;
      [project.timeline.sections[index + 1], project.timeline.sections[index]] = [project.timeline.sections[index], project.timeline.sections[index + 1]];
      mark(); render();
    };
    remove.onclick = () => {
      if (project.timeline.sections.length <= 1) return alert("At least one section is required.");
      project.timeline.sections.splice(index, 1);
      selectedId = project.timeline.sections[Math.max(0, index - 1)]?.id || null;
      mark(); render();
    };
    move.append(up, down, remove);

    inspector.append(
      field("Type", type),
      field("Title", label),
      field("Duration (s)", duration, "Mouse wheel changes by 0.5 s while focused."),
      field("Energy", energyWrap),
      field("Instruments", instruments, "Search presets or add custom instruments."),
      field("Section vocal", vocal),
      field("Lyrics", lyrics),
      field("Arrangement", directive),
      move,
    );
  }

  function render() {
    for (const [id, item] of navButtons) item.classList.toggle("is-active", id === active);
    renderCenter();
    renderInspector();
    mark();
  }

  reset.onclick = () => {
    if (!confirm("Reset this editor session to V1 defaults? The node is unchanged until Save to Node.")) return;
    const keep = project.project_id;
    project = factoryProject();
    project.project_id = keep || uid("project");
    selectedId = project.timeline.sections[0]?.id || null;
    active = "overview";
    render();
  };
  cancel.onclick = () => shell.close();
  save.onclick = () => {
    const serialized = JSON.stringify(project);
    projectWidget.value = serialized;
    projectWidget.callback?.(serialized);
    const durationWidget = getNodeWidget(node, "max_duration");
    if (durationWidget) {
      const max = Number(durationWidget.options?.max);
      const limit = Number.isFinite(max) ? max : 360;
      durationWidget.value = Math.round(clamp(totalDuration(project), 0.04, limit) * 100) / 100;
      durationWidget.callback?.(durationWidget.value);
    }
    compactSummary?.update(summarizeProject(project));
    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    shell.close();
  };

  shell.mount();
  render();
}

app.registerExtension({
  name: EXTENSION_NAME,
  async nodeCreated(node) {
    if (nodeClass(node) !== NODE_ID || node._m3ssStudioInstalled) return;
    node._m3ssStudioInstalled = true;
    ensureStyles();
    const projectWidget = getNodeWidget(node, "project_json");
    hideNodeWidgets(node, ["project_json"]);
    let summary = "Semantic project";
    try { summary = summarizeProject(normalizeProject(JSON.parse(projectWidget?.value || "{}"))); } catch {}
    const compact = installNodeSummary(node, { widgetName: "Studio Summary", text: summary, minWidth: 360 });
    const open = node.addWidget?.("button", "Open Semantic Studio", null, () => openStudio(node, compact), { serialize: false });
    if (open) {
      open.label = "Open Semantic Studio";
      open.serialize = false;
    }
    node.setSize?.([
      Math.max(node.size?.[0] || 360, 360),
      Math.min(Math.max(node.computeSize?.()[1] || 180, 180), 330),
    ]);
  },
});
