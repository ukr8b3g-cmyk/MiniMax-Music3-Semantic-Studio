import { app } from "../../scripts/app.js";
import { createStudioWindow } from "./studio_shell.js";
import { hideNodeWidgets, installNodeSummary, getNodeWidget } from "./node_compact.js";
import { installCssSizeDrag, makeVerticalSplitter, readLayoutNumber, writeLayoutNumber } from "./layout_splitter.js";
import {
  SECTION_TYPES, METERS, clamp, uid, factoryProject, normalizeProject, snapSemanticDuration,
  parseList, totalDuration, summarizeProject, compilePreview, el, button, textInput, numberInput,
  selectInput, textarea, field,
} from "./semantic_studio_core.js";
import { editableCombo, chipEditor, textareaWithSuggestions } from "./semantic_controls.js";
import { fitTimelineScale, renderSemanticTimeline, sectionPalette } from "./semantic_timeline.js";
import { openPromptImporter } from "./prompt_import.js";
import { analyzePromptImport, applyPromptImport } from "./prompt_import_core.js";
import {
  GENRE_PRESETS, INFLUENCE_PRESETS, MOOD_PRESETS, VOCAL_LEAD_PRESETS, VOCAL_TIMBRE_PRESETS,
  VOCAL_DELIVERY_PRESETS, SECTION_VOCAL_PRESETS, INSTRUMENT_PRESETS, PRODUCTION_SUGGESTIONS,
  KEY_PRESETS, SCALE_PRESETS,
} from "./semantic_presets.js";

const EXTENSION_NAME = "minimax.music3.semantic.studio";
const NODE_ID = "MiniMaxMusic3SemanticStudio";
const STYLE_ID = "m3ss-style-link";
const PHASE_A_STYLE_ID = "m3ss-phase-a-style-link";
const NAV = [["timeline", "Timeline"], ["lyrics", "Lyrics"]];
const DEFAULT_SECTION_DURATION = { Intro: 8, Verse: 16, "Pre-Chorus": 8, Chorus: 16, "Post-Chorus": 8, Bridge: 12, Instrumental: 12, Solo: 12, Outro: 8 };
const DEFAULT_SECTION_ENERGY = { Intro: .2, Verse: .42, "Pre-Chorus": .62, Chorus: .82, "Post-Chorus": .72, Bridge: .48, Instrumental: .52, Solo: .68, Outro: .28 };

function ensureStyles() {
  if (!document.getElementById(STYLE_ID)) {
    const link = document.createElement("link");
    link.id = STYLE_ID;
    link.rel = "stylesheet";
    link.href = new URL("./semantic_studio.css", import.meta.url).href;
    document.head.appendChild(link);
  }
  if (!document.getElementById(PHASE_A_STYLE_ID)) {
    const link = document.createElement("link");
    link.id = PHASE_A_STYLE_ID;
    link.rel = "stylesheet";
    link.href = new URL("./semantic_phase_a.css", import.meta.url).href;
    document.head.appendChild(link);
  }
}

function nodeClass(node) {
  return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function autoSizeTextarea(area) {
  if (!area) return;
  area.style.height = "auto";
  const minimum = Math.max(58, Number(area.dataset.minHeight) || 58);
  area.style.height = `${Math.min(280, Math.max(minimum, area.scrollHeight + 2))}px`;
  area.style.overflowY = area.scrollHeight > 280 ? "auto" : "hidden";
}

async function copyText(value) {
  const text = String(value ?? "");
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch {
    const helper = document.createElement("textarea");
    helper.value = text;
    helper.style.position = "fixed";
    helper.style.opacity = "0";
    document.body.appendChild(helper);
    helper.select();
    const ok = document.execCommand?.("copy") !== false;
    helper.remove();
    return ok;
  }
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
  let active = "timeline";
  let selectedId = project.timeline.sections[0]?.id || null;
  let lyricsExpandedId = project.timeline.sections.find((section) => section.lyrics?.trim())?.id || selectedId;
  let timelinePxPerSecond = clamp(readLayoutNumber("semantic-timeline-scale", 3), 3, 20);
  let timelineInstrumentsOpen = readLayoutNumber("semantic-instruments-open", 0) !== 0;
  let moreSettingsOpen = readLayoutNumber("semantic-more-settings-open", 0) !== 0;
  let mainVocalOpen = readLayoutNumber("semantic-main-vocal-open", 1) !== 0;
  let captionEditMode = false;
  let captionDraft = "";
  let fullLyricsDraft = compilePreview(project).lyrics;
  let fullLyricsDirty = false;
  let cleanupLyricsSplitters = () => {};
  let cleanup = () => {};

  const shell = createStudioWindow({
    title: "Music3 Semantic Studio",
    subtitle: `Timeline / Lyrics · ${summarizeProject(project)}`,
    storageKey: "m3ss-semantic-window",
    defaultWidth: 1480,
    defaultHeight: 900,
    minWidth: 860,
    minHeight: 580,
    onClose: () => cleanup(),
  });
  shell.window.classList.add("m3ss-dialog", "m3ss-phase-a", "m3ss-two-view");

  const topTabs = el("nav", "m3ss-top-tabs");
  topTabs.setAttribute("role", "tablist");
  const workspace = el("div", "m3ss-workspace");
  const center = el("main", "m3ss-center");
  const paneSplitter = makeVerticalSplitter("m3ss-pane-splitter");
  const inspector = el("aside", "m3ss-inspector");
  const footer = el("footer", "m3ss-footer");
  shell.content.append(topTabs, workspace, footer);
  workspace.append(center, paneSplitter, inspector);

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
  cleanup = () => {
    cleanupLyricsSplitters();
    cleanupPaneSplitter();
  };

  const navButtons = new Map();
  for (const [id, label] of NAV) {
    const item = button(label, "m3ss-top-tab");
    item.dataset.view = id;
    item.setAttribute("role", "tab");
    item.onclick = () => { active = id; render(); };
    navButtons.set(id, item);
    topTabs.appendChild(item);
  }

  const durationStatus = el("div", "m3ss-duration-status");
  const actions = el("div", "m3ss-footer-actions");
  const reset = button("Reset", "m3ss-button secondary");
  const cancel = button("Cancel", "m3ss-button secondary");
  const save = button("Save to Node", "m3ss-button primary");
  actions.append(reset, cancel, save);
  footer.append(durationStatus, actions);

  const selected = () => project.timeline.sections.find((section) => section.id === selectedId) || project.timeline.sections[0] || null;
  const syncFullLyricsDraft = () => {
    if (!fullLyricsDirty) fullLyricsDraft = compilePreview(project).lyrics;
  };
  const mark = () => {
    syncFullLyricsDraft();
    shell.setSubtitle(`Timeline / Lyrics · ${summarizeProject(project)}`);
    durationStatus.textContent = `${totalDuration(project).toFixed(1)} s · ${project.timeline.sections.length} sections · semantic timing/energy remain generation targets`;
  };
  const update = (fn) => { fn(); mark(); };
  const refreshTimeline = () => { if (active === "timeline") renderTimelineView(); };

  function applyImportedProject(next) {
    project = normalizeProject(next);
    selectedId = project.timeline.sections.find((section) => section.id === selectedId)?.id || project.timeline.sections[0]?.id || null;
    lyricsExpandedId = selectedId;
    captionEditMode = false;
    captionDraft = "";
    fullLyricsDirty = false;
    fullLyricsDraft = compilePreview(project).lyrics;
    mark();
    render();
  }

  function nextSectionLabel(type) {
    const count = project.timeline.sections.filter((item) => item.type === type).length + 1;
    if (["Intro", "Bridge", "Outro"].includes(type)) return count === 1 ? type : `${type} ${count}`;
    if (type === "Chorus" && count >= 3) return count === 3 ? "Final Chorus" : `Chorus ${count}`;
    return `${type} ${count}`;
  }

  function addSection(type = "Verse") {
    if (project.timeline.sections.length >= 32) return alert("V1 supports up to 32 sections.");
    const safeType = SECTION_TYPES.includes(type) ? type : "Verse";
    const section = {
      id: uid(safeType.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "section"),
      type: safeType,
      label: nextSectionLabel(safeType),
      duration: DEFAULT_SECTION_DURATION[safeType] || 12,
      energy: DEFAULT_SECTION_ENERGY[safeType] ?? .5,
      lyrics: "",
      instruments: [],
      vocal: safeType === "Instrumental" || safeType === "Solo" ? "instrumental" : "",
      directives: "",
    };
    project.timeline.sections.push(section);
    selectedId = section.id;
    lyricsExpandedId = section.id;
    mark();
    render();
  }

  function renderMainVocal(panel) {
    const vocal = project.global.vocal;
    const summaryParts = (vocal.mode || "vocal") === "instrumental"
      ? ["Instrumental · no lead vocal"]
      : [vocal.gender || "Lead vocal", vocal.timbre, vocal.delivery].filter(Boolean);
    const toggle = button("", `m3ss-main-vocal-toggle${mainVocalOpen ? " is-open" : ""}`);
    toggle.append(
      el("span", "m3ss-main-vocal-arrow", mainVocalOpen ? "▾" : "▸"),
      el("strong", "", "Main Vocal"),
      el("span", "m3ss-main-vocal-summary", summaryParts.join(" · ")),
    );
    toggle.onclick = () => {
      mainVocalOpen = !mainVocalOpen;
      writeLayoutNumber("semantic-main-vocal-open", mainVocalOpen ? 1 : 0);
      renderTimelineView();
    };
    panel.appendChild(toggle);
    if (!mainVocalOpen) return;

    const grid = el("div", "m3ss-main-vocal-grid");
    const lead = editableCombo({ value: vocal.gender, options: VOCAL_LEAD_PRESETS, placeholder: "female vocal, warm male baritone, duet…", onInput: (value) => { vocal.gender = value; mark(); } });
    const timbre = editableCombo({ value: vocal.timbre, options: VOCAL_TIMBRE_PRESETS, placeholder: "breathy and intimate, powerful and soulful…", onInput: (value) => { vocal.timbre = value; mark(); } });
    const delivery = editableCombo({ value: vocal.delivery, options: VOCAL_DELIVERY_PRESETS, placeholder: "intimate phrasing, rhythmic intensity…", onInput: (value) => { vocal.delivery = value; mark(); } });
    const harmony = textInput(vocal.harmony, "soft harmonies, duet responses…");
    harmony.oninput = () => { vocal.harmony = harmony.value; mark(); };
    const effects = textInput(vocal.effects, "room reverb, tape delay…");
    effects.oninput = () => { vocal.effects = effects.value; mark(); };
    grid.append(
      field("Lead / voice type", lead),
      field("Timbre / character", timbre),
      field("Delivery", delivery),
      field("Harmony / backing", harmony),
      field("Vocal effects", effects),
    );
    panel.appendChild(grid);
  }

  function renderSongSettings() {
    const global = project.global;
    const panel = el("section", "m3ss-song-settings");
    const primary = el("div", "m3ss-song-settings-primary");

    const genre = editableCombo({
      value: global.genre, options: GENRE_PRESETS, placeholder: "Genre / style…",
      onInput: (value) => { global.genre = value; mark(); },
    });
    const bpm = numberInput(global.bpm || 120, 20, 400, 1);
    bpm.oninput = () => { global.bpm = Math.round(clamp(bpm.value, 20, 400)); mark(); };
    const key = editableCombo({
      value: global.key, options: KEY_PRESETS, placeholder: "Key…",
      onInput: (value) => { global.key = value; mark(); },
    });
    const scale = editableCombo({
      value: global.scale, options: SCALE_PRESETS, placeholder: "Scale / mode…",
      onInput: (value) => { global.scale = value; mark(); },
    });
    const meter = selectInput(METERS.includes(global.meter) ? METERS : [...METERS, global.meter], global.meter || "4/4");
    meter.onchange = () => { global.meter = meter.value; mark(); };
    const mode = selectInput([{ value: "vocal", label: "Vocal" }, { value: "instrumental", label: "Instrumental" }], global.vocal?.mode || "vocal");
    mode.onchange = () => { global.vocal.mode = mode.value; mark(); renderTimelineView(); };
    const more = button(`${moreSettingsOpen ? "▴" : "▾"} More Settings`, "m3ss-button secondary m3ss-more-settings-button");
    more.onclick = () => {
      moreSettingsOpen = !moreSettingsOpen;
      writeLayoutNumber("semantic-more-settings-open", moreSettingsOpen ? 1 : 0);
      renderTimelineView();
    };

    primary.append(
      field("Genre", genre), field("BPM", bpm), field("Key", key), field("Scale / Mode", scale),
      field("Meter", meter), field("Vocal", mode), more,
    );
    panel.appendChild(primary);
    renderMainVocal(panel);

    if (moreSettingsOpen) {
      const extra = el("div", "m3ss-song-settings-more");
      const title = textInput(global.title, "Optional project title");
      title.oninput = () => { global.title = title.value; mark(); };
      const influences = chipEditor({
        values: global.subgenres || [], suggestions: INFLUENCE_PRESETS, placeholder: "Add influence / subgenre…",
        onChange: (values) => { global.subgenres = values; mark(); },
      });
      const mood = chipEditor({
        values: parseList(global.mood), suggestions: MOOD_PRESETS, placeholder: "Add mood / direction…",
        onChange: (values) => { global.mood = values.join(", "); mark(); },
      });
      const production = textareaWithSuggestions({
        value: global.production, placeholder: "Production, room, texture, mix character…", rows: 3,
        suggestions: PRODUCTION_SUGGESTIONS, onInput: (value) => { global.production = value; mark(); },
      });
      extra.append(
        field("Working title", title, "Project-only; not injected into the caption."),
        field("Subgenres / influences", influences),
        field("Mood / direction", mood),
        field("Production profile", production),
      );
      panel.appendChild(extra);
    }
    return panel;
  }

  function renderTimelineView() {
    cleanupLyricsSplitters();
    cleanupLyricsSplitters = () => {};
    center.replaceChildren();
    center.appendChild(renderSongSettings());

    const head = el("div", "m3ss-center-head m3ss-timeline-view-head");
    const headText = el("div");
    headText.append(
      el("h3", "m3ss-view-title", "Song Timeline"),
      el("p", "m3ss-view-note", "Structure, Energy, lyric summary and Section Vocal Style stay visible; Instruments opens below when needed."),
    );
    const controls = el("div", "m3ss-timeline-controls");
    const addType = selectInput(SECTION_TYPES, "Verse");
    addType.className = "m3ss-add-section-type";
    const add = button("+ Section", "m3ss-button secondary");
    add.onclick = () => addSection(addType.value);
    const fit = button("Fit", "m3ss-button secondary");
    const zoom = document.createElement("input");
    zoom.type = "range";
    zoom.min = "3";
    zoom.max = "20";
    zoom.step = "0.5";
    zoom.value = String(timelinePxPerSecond);
    zoom.title = "Timeline horizontal scale";
    controls.append(addType, add, el("span", "m3ss-timeline-scale-label", "Scale"), zoom, fit);
    head.append(headText, controls);
    center.appendChild(head);

    const host = el("div", "m3ss-timeline-host");
    center.appendChild(host);
    renderSemanticTimeline(host, project, selectedId, {
      pxPerSecond: timelinePxPerSecond,
      showInstruments: timelineInstrumentsOpen,
      onToggleInstruments: (next) => {
        timelineInstrumentsOpen = !!next;
        writeLayoutNumber("semantic-instruments-open", timelineInstrumentsOpen ? 1 : 0);
        renderTimelineView();
      },
      onSelect: (id, options = {}) => {
        selectedId = id;
        if (options.render === false) {
          renderInspector();
          return;
        }
        render();
      },
      onChange: () => {
        project = normalizeProject(project);
        mark();
        renderTimelineView();
        renderInspector();
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

  function renderCaptionPanel(compiled) {
    const panel = el("section", "m3ss-lyrics-pane m3ss-caption-pane");
    const head = el("div", "m3ss-lyrics-pane-head");
    head.appendChild(el("h3", "", captionEditMode ? "Caption — Draft Editing" : "Caption"));
    const controls = el("div", "m3ss-inline-actions");
    const area = textarea(captionEditMode ? captionDraft : compiled.caption, "Structured Caption", 22);
    area.classList.add("m3ss-caption-editor");
    area.readOnly = !captionEditMode;

    if (captionEditMode) {
      const cancelEdit = button("Cancel", "m3ss-button secondary");
      const analyze = button("Analyze & Import", "m3ss-button primary");
      cancelEdit.onclick = () => { captionEditMode = false; captionDraft = ""; renderLyrics(); };
      analyze.onclick = () => {
        captionDraft = area.value;
        openPromptImporter({
          project,
          title: "Analyze Caption Draft",
          subtitle: "Review the edited Caption against the current Lyrics, then apply it back to Semantic Studio.",
          initialCaption: captionDraft,
          initialLyrics: compiled.lyrics,
          defaultMode: "merge",
          autoAnalyze: true,
          onApply: (next) => applyImportedProject(next),
        });
      };
      area.oninput = () => { captionDraft = area.value; };
      controls.append(cancelEdit, analyze);
    } else {
      const importButton = button("Import Prompt", "m3ss-button secondary");
      const copy = button("Copy", "m3ss-button secondary");
      const edit = button("Edit", "m3ss-button primary");
      importButton.onclick = () => {
        openPromptImporter({ project, defaultMode: "replace", onApply: (next) => applyImportedProject(next) });
      };
      copy.onclick = async () => { await copyText(compiled.caption); copy.textContent = "Copied"; setTimeout(() => { copy.textContent = "Copy"; }, 900); };
      edit.onclick = () => { captionDraft = compiled.caption; captionEditMode = true; renderLyrics(); };
      controls.append(importButton, copy, edit);
    }
    head.appendChild(controls);
    panel.append(head, area);
    panel.appendChild(el("p", "m3ss-lyrics-pane-note", captionEditMode
      ? "Draft changes are not authoritative until Analyze → Import Preview → Apply."
      : "Read-only compiler output. Edit switches this same field into a temporary Draft mode."));
    return panel;
  }

  function renderFullLyricsPanel(compiled) {
    const panel = el("section", "m3ss-lyrics-pane m3ss-full-lyrics-pane");
    const head = el("div", "m3ss-lyrics-pane-head");
    head.appendChild(el("h3", "", "Full Lyrics"));
    const controls = el("div", "m3ss-inline-actions");
    const apply = button("Apply to Sections", "m3ss-button primary");
    const resetDraft = button("Reset", "m3ss-button secondary");
    controls.append(apply, resetDraft);
    head.appendChild(controls);

    const area = textarea(fullLyricsDirty ? fullLyricsDraft : compiled.lyrics, "[Intro]\n...\n[Verse]\n...", 22);
    area.classList.add("m3ss-full-lyrics-editor");
    area.oninput = () => { fullLyricsDraft = area.value; fullLyricsDirty = true; };
    resetDraft.onclick = () => {
      fullLyricsDirty = false;
      fullLyricsDraft = compilePreview(project).lyrics;
      area.value = fullLyricsDraft;
    };
    apply.onclick = () => {
      const analysis = analyzePromptImport({ lyrics: area.value });
      if (!analysis.stats.lyrics_sections) {
        alert(analysis.warnings.join("\n") || "No supported [Verse]/[Chorus]-style Lyrics tags were detected.");
        return;
      }
      const lyricsOnly = {
        ...analysis,
        global: { values: {}, present: [] },
        vocal: { values: {}, present: [] },
        sections: analysis.sections.map((section) => ({ ...section, present: ["lyrics"] })),
      };
      project = applyPromptImport(project, lyricsOnly, "merge");
      selectedId = project.timeline.sections.find((section) => section.id === selectedId)?.id || project.timeline.sections[0]?.id || null;
      lyricsExpandedId = selectedId;
      fullLyricsDirty = false;
      fullLyricsDraft = compilePreview(project).lyrics;
      mark();
      render();
    };
    panel.append(head, area);
    panel.appendChild(el("p", "m3ss-lyrics-pane-note", "Edit the complete tagged Lyrics, then Apply to Sections. Section timing, energy, instruments and vocal style are preserved for matching sections."));
    return { panel, area };
  }

  function renderSectionLyricsPanel(fullLyricsArea) {
    const panel = el("section", "m3ss-lyrics-pane m3ss-section-lyrics-pane");
    const head = el("div", "m3ss-lyrics-pane-head");
    head.appendChild(el("h3", "", "Section Lyrics"));
    head.appendChild(el("span", "m3ss-lyrics-pane-note", "Per section"));
    panel.appendChild(head);
    const list = el("div", "m3ss-lyrics-list m3ss-lyrics-accordion");

    for (const section of project.timeline.sections) {
      const expanded = section.id === lyricsExpandedId;
      const empty = !String(section.lyrics || "").trim();
      const lines = empty ? 0 : String(section.lyrics).split(/\r?\n/).filter((line) => line.trim()).length;
      const card = el("article", `m3ss-lyrics-card${section.id === selectedId ? " is-selected" : ""}${expanded ? " is-expanded" : ""}${empty ? " is-empty" : ""}`);
      const title = button("", "m3ss-lyrics-title m3ss-lyrics-accordion-title");
      const arrow = el("span", "m3ss-lyrics-arrow", expanded ? "▾" : "▸");
      const name = el("span", "m3ss-lyrics-name", section.label || section.type);
      const meta = el("span", "m3ss-lyrics-meta", `${Number(section.duration).toFixed(1)} s · ${empty ? "No lyrics" : `${lines} line${lines === 1 ? "" : "s"}`}`);
      title.append(arrow, name, meta);
      title.onclick = () => {
        selectedId = section.id;
        lyricsExpandedId = expanded ? null : section.id;
        renderLyrics();
      };
      card.appendChild(title);
      if (expanded) {
        const area = textarea(section.lyrics, "Lyrics for this section. Do not include [Verse]/[Chorus] tags.", empty ? 2 : 4);
        area.classList.add("m3ss-lyrics-auto-textarea");
        area.dataset.minHeight = empty ? "58" : "82";
        area.oninput = () => {
          section.lyrics = area.value;
          mark();
          if (!fullLyricsDirty && fullLyricsArea) fullLyricsArea.value = fullLyricsDraft;
          autoSizeTextarea(area);
        };
        card.appendChild(area);
        requestAnimationFrame(() => autoSizeTextarea(area));
      }
      list.appendChild(card);
    }
    panel.appendChild(list);
    return panel;
  }

  function renderLyrics() {
    cleanupLyricsSplitters();
    cleanupLyricsSplitters = () => {};
    center.replaceChildren();
    const compiled = compilePreview(project);
    if (!fullLyricsDirty) fullLyricsDraft = compiled.lyrics;

    const intro = el("div", "m3ss-lyrics-view-head");
    intro.append(
      el("h3", "m3ss-view-title", "Lyrics & Caption"),
      el("p", "m3ss-view-note", "Caption → Full Lyrics → Section Lyrics. Drag the dividers to resize panes; double-click a divider to reset."),
    );
    center.appendChild(intro);

    const grid = el("div", "m3ss-lyrics-workspace");
    const captionPanel = renderCaptionPanel(compiled);
    const captionSplitter = makeVerticalSplitter("m3ss-lyrics-splitter");
    const full = renderFullLyricsPanel(compiled);
    const fullSplitter = makeVerticalSplitter("m3ss-lyrics-splitter");
    const sectionPanel = renderSectionLyricsPanel(full.area);
    grid.append(captionPanel, captionSplitter, full.panel, fullSplitter, sectionPanel);
    center.appendChild(grid);

    const cleanupCaptionWidth = installCssSizeDrag({
      handle: captionSplitter,
      target: grid,
      cssVariable: "--m3ss-caption-pane-width",
      storageKey: "semantic-caption-pane-width",
      defaultSize: 360,
      minSize: 250,
      maxSize: 620,
      step: 20,
    });
    const cleanupFullLyricsWidth = installCssSizeDrag({
      handle: fullSplitter,
      target: grid,
      cssVariable: "--m3ss-full-lyrics-pane-width",
      storageKey: "semantic-full-lyrics-pane-width",
      defaultSize: 380,
      minSize: 260,
      maxSize: 660,
      step: 20,
    });
    cleanupLyricsSplitters = () => {
      cleanupCaptionWidth();
      cleanupFullLyricsWidth();
    };
  }

  function renderCenter() {
    if (active === "timeline") renderTimelineView();
    else renderLyrics();
  }

  function renderInspector() {
    inspector.replaceChildren();
    const section = selected();
    inspector.appendChild(el("h3", "m3ss-inspector-title", "Section Inspector"));
    if (!section) {
      inspector.appendChild(el("div", "m3ss-empty", "Add a section to edit it."));
      return;
    }

    const palette = sectionPalette(section.type);
    const sectionChip = el("div", "m3ss-inspector-section-chip");
    sectionChip.style.setProperty("--m3ss-section-accent", palette.accent);
    sectionChip.style.setProperty("--m3ss-section-fill", palette.fill);
    sectionChip.append(el("strong", "", section.label || section.type), el("span", "", section.type));
    inspector.appendChild(sectionChip);

    const type = selectInput(SECTION_TYPES, section.type);
    const label = textInput(section.label, section.type);
    const duration = numberInput(section.duration, 0.5, 360, 0.1);
    duration.value = Number(section.duration).toFixed(1);
    const energy = document.createElement("input");
    const energyValue = el("span", "m3ss-energy-value", `${Math.round(section.energy * 100)}%`);
    const vocal = editableCombo({
      value: section.vocal, options: SECTION_VOCAL_PRESETS, placeholder: "soft, breathy, powerful… or custom",
      onInput: (value) => { update(() => { section.vocal = value; }); refreshTimeline(); },
    });
    const instruments = chipEditor({
      values: section.instruments || [], suggestions: INSTRUMENT_PRESETS, placeholder: "Add instrument / texture…",
      onChange: (values) => { update(() => { section.instruments = values; }); refreshTimeline(); },
    });
    const lyrics = textarea(section.lyrics, "Section lyrics", 4);
    const directive = textarea(section.directives, "Arrangement directive", 5);
    energy.type = "range";
    energy.min = "0";
    energy.max = "100";
    energy.step = "1";
    energy.value = String(Math.round(section.energy * 100));
    const energyWrap = el("div", "m3ss-energy-control");
    energyWrap.append(energy, energyValue);

    type.onchange = () => {
      update(() => {
        section.type = type.value;
        if (!section.label) section.label = type.value;
        if ((section.type === "Instrumental" || section.type === "Solo") && !section.vocal) section.vocal = "instrumental";
      });
      render();
    };
    label.oninput = () => { update(() => { section.label = label.value; }); refreshTimeline(); };
    duration.oninput = () => {
      update(() => { section.duration = snapSemanticDuration(duration.value); });
      duration.value = Number(section.duration).toFixed(1);
      refreshTimeline();
    };
    energy.oninput = () => { update(() => { section.energy = Number(energy.value) / 100; energyValue.textContent = `${energy.value}%`; }); refreshTimeline(); };
    lyrics.oninput = () => { update(() => { section.lyrics = lyrics.value; }); refreshTimeline(); };
    directive.oninput = () => { update(() => { section.directives = directive.value; }); };

    const move = el("div", "m3ss-inspector-actions");
    const up = button("↑", "m3ss-icon-button");
    const down = button("↓", "m3ss-icon-button");
    const duplicate = button("Duplicate", "m3ss-button secondary");
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
    duplicate.onclick = () => {
      if (project.timeline.sections.length >= 32) return alert("V1 supports up to 32 sections.");
      const copy = JSON.parse(JSON.stringify(section));
      copy.id = uid(section.type.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "section");
      copy.label = `${section.label || section.type} Copy`;
      project.timeline.sections.splice(index + 1, 0, copy);
      selectedId = copy.id;
      mark(); render();
    };
    remove.onclick = () => {
      if (project.timeline.sections.length <= 1) return alert("At least one section is required.");
      project.timeline.sections.splice(index, 1);
      selectedId = project.timeline.sections[Math.max(0, index - 1)]?.id || null;
      if (lyricsExpandedId === section.id) lyricsExpandedId = selectedId;
      mark(); render();
    };
    move.append(up, down, duplicate, remove);

    inspector.append(
      field("Type", type),
      field("Title", label),
      field("Duration (s)", duration, "Semantic timeline uses 0.1 s steps."),
      field("Energy", energyWrap),
      field("Vocal style", vocal, "Section performance expression; Main Vocal stays song-wide."),
      field("Instruments", instruments, "Search presets or add custom instruments."),
      field("Lyrics", lyrics),
      field("Arrangement", directive),
      move,
    );
  }

  function render() {
    for (const [id, item] of navButtons) {
      const isActive = id === active;
      item.classList.toggle("is-active", isActive);
      item.setAttribute("aria-selected", isActive ? "true" : "false");
    }
    workspace.classList.toggle("is-lyrics-view", active === "lyrics");
    renderCenter();
    if (active === "timeline") renderInspector();
    else inspector.replaceChildren();
    mark();
  }

  reset.onclick = () => {
    if (!confirm("Reset this editor session to V1 defaults? The node is unchanged until Save to Node.")) return;
    const keep = project.project_id;
    project = factoryProject();
    project.project_id = keep || uid("project");
    selectedId = project.timeline.sections[0]?.id || null;
    lyricsExpandedId = selectedId;
    captionEditMode = false;
    captionDraft = "";
    fullLyricsDirty = false;
    fullLyricsDraft = compilePreview(project).lyrics;
    active = "timeline";
    render();
  };
  cancel.onclick = () => shell.close();
  save.onclick = () => {
    project = normalizeProject(project);
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
