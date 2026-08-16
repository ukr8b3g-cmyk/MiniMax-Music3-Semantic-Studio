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
import {
  GENRE_PRESETS, INFLUENCE_PRESETS, MOOD_PRESETS, VOCAL_LEAD_PRESETS, VOCAL_TIMBRE_PRESETS,
  VOCAL_DELIVERY_PRESETS, SECTION_VOCAL_PRESETS, INSTRUMENT_PRESETS, PRODUCTION_SUGGESTIONS,
  KEY_PRESETS, SCALE_PRESETS,
} from "./semantic_presets.js";

const EXTENSION_NAME = "minimax.music3.semantic.studio";
const NODE_ID = "MiniMaxMusic3SemanticStudio";
const STYLE_ID = "m3ss-style-link";
const PHASE_A_STYLE_ID = "m3ss-phase-a-style-link";
const NAV = [["timeline", "Timeline"], ["lyrics", "Lyrics"], ["vocal", "Vocal"], ["prompt", "Prompt"]];
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
  let timelineInstrumentsOpen = readLayoutNumber("semantic-instruments-open", 1) !== 0;
  let moreSettingsOpen = readLayoutNumber("semantic-more-settings-open", 0) !== 0;
  let cleanup = () => {};

  const shell = createStudioWindow({
    title: "Music3 Semantic Studio",
    subtitle: `Phase A / Timeline authoring · ${summarizeProject(project)}`,
    storageKey: "m3ss-semantic-window",
    defaultWidth: 1460,
    defaultHeight: 900,
    minWidth: 860,
    minHeight: 580,
    onClose: () => cleanup(),
  });
  shell.window.classList.add("m3ss-dialog", "m3ss-phase-a");

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
  nav.appendChild(el("div", "m3ss-nav-note", "Timeline is the primary workspace. Detailed lyrics, main vocal design, and final MiniMax prompt output stay one click away."));

  const durationStatus = el("div", "m3ss-duration-status");
  const actions = el("div", "m3ss-footer-actions");
  const reset = button("Reset", "m3ss-button secondary");
  const cancel = button("Cancel", "m3ss-button secondary");
  const save = button("Save to Node", "m3ss-button primary");
  actions.append(reset, cancel, save);
  footer.append(durationStatus, actions);

  const selected = () => project.timeline.sections.find((section) => section.id === selectedId) || project.timeline.sections[0] || null;
  const mark = () => {
    shell.setSubtitle(`Phase A / Timeline authoring · ${summarizeProject(project)}`);
    durationStatus.textContent = `${totalDuration(project).toFixed(1)} s · ${project.timeline.sections.length} sections · semantic timing/energy remain generation targets`;
  };
  const update = (fn) => { fn(); mark(); };
  const refreshTimeline = () => { if (active === "timeline") renderTimelineView(); };

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
    mode.onchange = () => { global.vocal.mode = mode.value; mark(); };
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
    center.replaceChildren();
    center.appendChild(renderSongSettings());

    const head = el("div", "m3ss-center-head m3ss-timeline-view-head");
    const headText = el("div");
    headText.append(
      el("h3", "m3ss-view-title", "Song Timeline"),
      el("p", "m3ss-view-note", "Drag section edges for duration (0.1 s snap), Energy points vertically, and instrument cells on/off. Shift+drag shares duration with the next section."),
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

  function renderLyrics() {
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Lyrics"),
      el("p", "m3ss-view-note", "Accordion view keeps long songs compact. Empty or instrumental sections stay collapsed until you open them."),
    );
    const list = el("div", "m3ss-lyrics-list m3ss-lyrics-accordion");
    for (const section of project.timeline.sections) {
      const expanded = section.id === lyricsExpandedId;
      const empty = !String(section.lyrics || "").trim();
      const card = el("article", `m3ss-lyrics-card${section.id === selectedId ? " is-selected" : ""}${expanded ? " is-expanded" : ""}${empty ? " is-empty" : ""}`);
      const title = button("", "m3ss-lyrics-title m3ss-lyrics-accordion-title");
      const arrow = el("span", "m3ss-lyrics-arrow", expanded ? "▾" : "▸");
      const name = el("span", "m3ss-lyrics-name", section.label || section.type);
      const meta = el("span", "m3ss-lyrics-meta", `${Number(section.duration).toFixed(1)} s${empty ? " · No lyrics" : ""}`);
      title.append(arrow, name, meta);
      title.onclick = () => {
        selectedId = section.id;
        lyricsExpandedId = expanded ? null : section.id;
        render();
      };
      card.appendChild(title);
      if (expanded) {
        const area = textarea(section.lyrics, "Lyrics for this section. Do not include [Verse]/[Chorus] tags.", empty ? 2 : 4);
        area.classList.add("m3ss-lyrics-auto-textarea");
        area.dataset.minHeight = empty ? "58" : "82";
        area.oninput = () => {
          section.lyrics = area.value;
          mark();
          autoSizeTextarea(area);
        };
        card.appendChild(area);
        requestAnimationFrame(() => autoSizeTextarea(area));
      }
      list.appendChild(card);
    }
    center.appendChild(list);
  }

  function renderVocal() {
    center.replaceChildren();
    center.append(
      el("h3", "m3ss-view-title", "Vocal"),
      el("p", "m3ss-view-note", "Main Vocal defines the song-wide singer/character. Section Vocal Style changes performance expression without replacing the main singer."),
    );
    const vocal = project.global.vocal;
    const mainCard = el("section", "m3ss-vocal-main-card");
    mainCard.appendChild(el("h4", "m3ss-subheading", "Main Vocal"));
    const grid = el("div", "m3ss-form-grid m3ss-vocal-main-grid");

    const mode = selectInput([{ value: "vocal", label: "Vocal" }, { value: "instrumental", label: "Instrumental" }], vocal.mode || "vocal");
    mode.onchange = () => { vocal.mode = mode.value; mark(); };
    const lead = editableCombo({ value: vocal.gender, options: VOCAL_LEAD_PRESETS, placeholder: "female vocal, warm male baritone, duet…", onInput: (value) => { vocal.gender = value; mark(); } });
    const timbre = editableCombo({ value: vocal.timbre, options: VOCAL_TIMBRE_PRESETS, placeholder: "breathy and intimate, powerful and soulful…", onInput: (value) => { vocal.timbre = value; mark(); } });
    const delivery = editableCombo({ value: vocal.delivery, options: VOCAL_DELIVERY_PRESETS, placeholder: "intimate phrasing, rhythmic intensity…", onInput: (value) => { vocal.delivery = value; mark(); } });
    const harmony = textarea(vocal.harmony, "soft harmony in choruses, duet responses…", 3);
    harmony.oninput = () => { vocal.harmony = harmony.value; mark(); };
    const effects = textarea(vocal.effects, "room reverb, tape delay, lush reverb…", 3);
    effects.oninput = () => { vocal.effects = effects.value; mark(); };
    grid.append(
      field("Mode", mode), field("Lead / voice type", lead), field("Timbre / character", timbre),
      field("Delivery", delivery), field("Harmony / backing", harmony), field("Vocal effects description", effects),
    );
    mainCard.appendChild(grid);
    center.appendChild(mainCard);

    center.appendChild(el("h4", "m3ss-subheading m3ss-section-style-heading", "Section Vocal Style"));
    center.appendChild(el("p", "m3ss-view-note", "Curated compatible wording is editable. These are authoring suggestions, not closed model-side enums."));
    const sectionGrid = el("div", "m3ss-vocal-section-grid");
    for (const section of project.timeline.sections) {
      const row = el("div", `m3ss-vocal-section-row${section.id === selectedId ? " is-selected" : ""}`);
      const selectSection = button(`${section.label || section.type} · ${Number(section.duration).toFixed(1)} s`, "m3ss-vocal-section-name");
      selectSection.onclick = () => { selectedId = section.id; render(); };
      const style = editableCombo({
        value: section.vocal, options: SECTION_VOCAL_PRESETS, placeholder: "soft, breathy, powerful… or custom",
        onInput: (value) => { section.vocal = value; mark(); },
      });
      row.append(selectSection, style);
      sectionGrid.appendChild(row);
    }
    center.appendChild(sectionGrid);
  }

  function renderPrompt() {
    const compiled = compilePreview(project);
    center.replaceChildren();
    const head = el("div", "m3ss-center-head");
    const copy = el("div");
    copy.append(
      el("h3", "m3ss-view-title", "Prompt"),
      el("p", "m3ss-view-note", "Authoritative read-only preview of the Caption/Lyrics sent to MiniMax Music3. Import remains Analyze → Preview → Apply."),
    );
    const importButton = button("Import Prompt", "m3ss-button secondary");
    importButton.onclick = () => {
      openPromptImporter({
        project,
        onApply: (next) => {
          project = normalizeProject(next);
          selectedId = project.timeline.sections.find((section) => section.id === selectedId)?.id || project.timeline.sections[0]?.id || null;
          lyricsExpandedId = selectedId;
          mark();
          render();
        },
      });
    };
    head.append(copy, importButton);
    center.appendChild(head);
    center.appendChild(el("div", "m3ss-callout", "Timing, BPM, key, energy, vocal and instrument controls are semantic generation targets. Custom/imported wording remains editable."));

    const grid = el("div", "m3ss-preview-grid");
    const caption = el("section", "m3ss-preview-panel");
    const lyrics = el("section", "m3ss-preview-panel");
    caption.append(el("h4", "", "Caption"), el("pre", "m3ss-pre", compiled.caption));
    lyrics.append(el("h4", "", "Lyrics"), el("pre", "m3ss-pre", compiled.lyrics || "(section tags only)"));
    grid.append(caption, lyrics);
    center.appendChild(grid);
  }

  function renderCenter() {
    if (active === "timeline") renderTimelineView();
    else if (active === "lyrics") renderLyrics();
    else if (active === "vocal") renderVocal();
    else renderPrompt();
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
    lyricsExpandedId = selectedId;
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
