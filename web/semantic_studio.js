import { app } from "../../scripts/app.js";

const EXTENSION_NAME = "minimax.music3.semantic.studio";
const NODE_ID = "MiniMaxMusic3SemanticStudio";
const STYLE_ID = "m3ss-style-link";
const SECTION_TYPES = [
  "Intro",
  "Verse",
  "Pre-Chorus",
  "Chorus",
  "Post-Chorus",
  "Bridge",
  "Instrumental",
  "Solo",
  "Outro",
];

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./semantic_studio.css", import.meta.url).href;
  document.head.appendChild(link);
}

function deepClone(value) {
  return JSON.parse(JSON.stringify(value));
}

function factoryProject() {
  return {
    schema_version: 1,
    project_id: "",
    global: {
      title: "",
      genre: "Pop",
      subgenres: [],
      bpm: 120,
      key: "",
      scale: "",
      meter: "4/4",
      mood: "",
      production: "",
      vocal: {
        mode: "vocal",
        gender: "",
        timbre: "",
        delivery: "",
        harmony: "",
        effects: "",
      },
    },
    timeline: {
      sections: [
        makeSection("Intro", "Intro", 8, 20, ["piano", "pad"], "instrumental", "Sparse opening; establish the main tone without a full groove."),
        makeSection("Verse", "Verse 1", 24, 38, ["piano", "bass", "light drums"], "soft", "Keep the arrangement restrained and leave space for the lead vocal."),
        makeSection("Chorus", "Chorus 1", 24, 82, ["full drums", "bass", "guitar", "piano", "pad"], "power", "Open into a wider, fuller arrangement with a clear melodic lift."),
        makeSection("Verse", "Verse 2", 24, 48, ["piano", "bass", "drums", "guitar"], "soft", "Retain momentum from the chorus while returning to a lighter texture."),
        makeSection("Chorus", "Chorus 2", 24, 88, ["full drums", "bass", "guitar", "piano", "pad"], "power", "Repeat the chorus identity with slightly more density and backing support."),
        makeSection("Bridge", "Bridge", 16, 45, ["piano", "strings", "pad"], "intimate", "Pull back the groove and create contrast before the final lift."),
        makeSection("Chorus", "Final Chorus", 28, 100, ["full drums", "bass", "guitar", "piano", "strings", "pad"], "power", "Peak arrangement density and emotional intensity; broaden the stereo image."),
        makeSection("Outro", "Outro", 12, 30, ["piano", "pad"], "fade", "Release the energy and finish with a clean, natural decay."),
      ],
    },
    audio_edits: [],
    takes: [],
    conditioning_tracks: [],
  };
}

function makeSection(type = "Verse", label = "Verse", duration = 16, energyPercent = 50, instruments = [], vocal = "", directives = "") {
  return {
    id: createId(type.toLowerCase().replace(/[^a-z0-9]+/g, "-") || "section"),
    type,
    label,
    duration,
    energy: energyPercent / 100,
    lyrics: "",
    instruments,
    vocal,
    directives,
  };
}

function createId(prefix = "section") {
  const token = globalThis.crypto?.randomUUID?.() || `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  return `${prefix}-${token}`;
}

function normalizeProject(raw) {
  const fallback = factoryProject();
  const p = raw && typeof raw === "object" ? deepClone(raw) : fallback;
  p.schema_version = 1;
  p.project_id = typeof p.project_id === "string" ? p.project_id : "";
  p.global = p.global && typeof p.global === "object" ? p.global : deepClone(fallback.global);
  p.global.vocal = p.global.vocal && typeof p.global.vocal === "object" ? p.global.vocal : deepClone(fallback.global.vocal);
  p.global.subgenres = Array.isArray(p.global.subgenres) ? p.global.subgenres : [];
  p.timeline = p.timeline && typeof p.timeline === "object" ? p.timeline : { sections: [] };
  p.timeline.sections = Array.isArray(p.timeline.sections) && p.timeline.sections.length
    ? p.timeline.sections
    : deepClone(fallback.timeline.sections);
  p.audio_edits = Array.isArray(p.audio_edits) ? p.audio_edits : [];
  p.takes = Array.isArray(p.takes) ? p.takes : [];
  p.conditioning_tracks = Array.isArray(p.conditioning_tracks) ? p.conditioning_tracks : [];
  return p;
}

function nodeClass(node) {
  return node?.comfyClass || node?.constructor?.comfyClass || node?.type || "";
}

function getWidget(node, name) {
  return node?.widgets?.find((widget) => widget.name === name);
}

function element(tag, className, text) {
  const el = document.createElement(tag);
  if (className) el.className = className;
  if (text !== undefined) el.textContent = text;
  return el;
}

function field(labelText, control, helper = "") {
  const wrapper = element("label", "m3ss-field");
  wrapper.appendChild(element("span", "m3ss-label", labelText));
  wrapper.appendChild(control);
  if (helper) wrapper.appendChild(element("span", "m3ss-helper", helper));
  return wrapper;
}

function textInput(value = "", placeholder = "") {
  const input = document.createElement("input");
  input.type = "text";
  input.value = value ?? "";
  input.placeholder = placeholder;
  return input;
}

function numberInput(value, min, max, step = 1) {
  const input = document.createElement("input");
  input.type = "number";
  input.value = Number.isFinite(Number(value)) ? String(value) : "0";
  input.min = String(min);
  input.max = String(max);
  input.step = String(step);
  return input;
}

function selectInput(options, value) {
  const select = document.createElement("select");
  for (const optionValue of options) {
    const option = document.createElement("option");
    option.value = optionValue;
    option.textContent = optionValue;
    if (optionValue === value) option.selected = true;
    select.appendChild(option);
  }
  return select;
}

function textarea(value = "", placeholder = "") {
  const area = document.createElement("textarea");
  area.value = value ?? "";
  area.placeholder = placeholder;
  rows(area, 3);
  return area;
}

function rows(area, count) {
  area.rows = count;
  return area;
}

function parseList(value) {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean)
    .filter((item, index, arr) => arr.findIndex((candidate) => candidate.toLowerCase() === item.toLowerCase()) === index);
}

function totalDuration(project) {
  return Math.round(project.timeline.sections.reduce((sum, section) => sum + (Number(section.duration) || 0), 0) * 100) / 100;
}

function formatTime(seconds) {
  const whole = Math.max(0, Math.round(seconds));
  const minutes = Math.floor(whole / 60);
  const secs = whole % 60;
  return `${minutes}:${String(secs).padStart(2, "0")}`;
}

function energyPhrase(value) {
  const e = Math.max(0, Math.min(1, Number(value) || 0));
  if (e < 0.18) return "very sparse and restrained";
  if (e < 0.38) return "low-density and restrained";
  if (e < 0.62) return "moderate and controlled";
  if (e < 0.82) return "full and energetic";
  if (e < 0.96) return "high-intensity and expansive";
  return "peak intensity and maximum arrangement density";
}

function compilePreview(project) {
  const g = project.global;
  const v = g.vocal || {};
  const sections = project.timeline.sections;
  const metadata = [];
  if (g.genre) {
    const influences = Array.isArray(g.subgenres) && g.subgenres.length ? ` with ${g.subgenres.join(", ")} influences` : "";
    metadata.push(`Genre: ${g.genre}${influences}.`);
  }
  metadata.push(`Tempo target: approximately ${g.bpm || 120} BPM in ${g.meter || "4/4"} meter.`);
  if (g.key) metadata.push(`Key/scale target: ${g.key}${g.scale ? ` ${g.scale}` : ""}.`);
  if (g.mood) metadata.push(`Mood and emotional direction: ${g.mood}.`);
  metadata.push(`Energy progression: ${sections.map((s) => `${s.label || s.type} ${energyPhrase(s.energy)}`).join("; then ")}.`);
  if (g.production) metadata.push(`Production profile: ${g.production}.`);

  let vocalDetails;
  if ((v.mode || "vocal").toLowerCase() === "instrumental") {
    vocalDetails = "Instrumental piece with no lead or backing vocals. Let the instrumental arrangement carry the melodic focus.";
  } else {
    const parts = [v.gender ? `Lead vocal: ${v.gender}` : "Lead vocal: present"];
    if (v.timbre) parts.push(`timbre ${v.timbre}`);
    if (v.delivery) parts.push(`delivery ${v.delivery}`);
    vocalDetails = `${parts.join("; ")}.`;
    if (v.harmony) vocalDetails += ` Harmony/backing vocals: ${v.harmony}.`;
    if (v.effects) vocalDetails += ` Vocal effects: ${v.effects}.`;
  }

  let cursor = 0;
  const arrangement = sections.map((s) => {
    const end = cursor + (Number(s.duration) || 0);
    const instruments = Array.isArray(s.instruments) && s.instruments.length ? s.instruments.join(", ") : "arrangement appropriate to the established palette";
    let line = `${s.label || s.type} (${formatTime(cursor)}–${formatTime(end)} target, ${energyPhrase(s.energy)}): Use ${instruments}.`;
    if (s.vocal) line += ` Vocal treatment: ${s.vocal}.`;
    if (s.directives) line += ` ${String(s.directives).replace(/[.\s]+$/, "")}.`;
    cursor = end;
    return line;
  });

  const caption = [
    `### Global Metadata\n${metadata.join(" ")}`,
    `### Vocal Details\n${vocalDetails}`,
    `### Arrangement\n${arrangement.join("\n")}`,
  ].join("\n\n");

  const instrumental = (v.mode || "vocal").toLowerCase() === "instrumental";
  const lyrics = sections.flatMap((s) => {
    const block = [`[${s.type}]`];
    const text = String(s.lyrics || "").replace(/^\s*\[[^\]]+\]\s*/gm, "").trim();
    if (text && !instrumental) block.push(text);
    return block;
  }).join("\n");

  return { caption, lyrics };
}

function openStudio(node) {
  ensureStyles();
  const projectWidget = getWidget(node, "project_json");
  if (!projectWidget) {
    alert("Music3 Semantic Studio: project_json widget was not found. Restart ComfyUI and reload the workflow.");
    return;
  }

  let parsed;
  try {
    parsed = JSON.parse(projectWidget.value || "{}");
  } catch (error) {
    const useDefault = confirm(`Studio Project JSON is invalid. Reset to V1 defaults?\n\n${error}`);
    if (!useDefault) return;
    parsed = factoryProject();
  }

  let project = normalizeProject(parsed);
  if (!project.project_id) project.project_id = createId("project");
  let activeTab = "global";

  const overlay = element("div", "m3ss-overlay");
  overlay.setAttribute("role", "dialog");
  overlay.setAttribute("aria-modal", "true");
  overlay.setAttribute("aria-label", "Music3 Semantic Studio V1 editor");

  const dialog = element("section", "m3ss-dialog");
  overlay.appendChild(dialog);

  const header = element("header", "m3ss-header");
  const headingWrap = element("div");
  headingWrap.appendChild(element("h2", "m3ss-title", "Music3 Semantic Studio"));
  headingWrap.appendChild(element("p", "m3ss-subtitle", "Phase 1 / V1 · Semantic generation timeline · ComfyUI core remains untouched"));
  header.appendChild(headingWrap);
  const closeButton = element("button", "m3ss-icon-button", "×");
  closeButton.type = "button";
  closeButton.setAttribute("aria-label", "Close editor");
  header.appendChild(closeButton);
  dialog.appendChild(header);

  const tabBar = element("nav", "m3ss-tabs");
  const tabs = [
    ["global", "Global"],
    ["timeline", "Timeline"],
    ["preview", "Compiled Preview"],
  ];
  const tabButtons = new Map();
  for (const [id, label] of tabs) {
    const button = element("button", "m3ss-tab", label);
    button.type = "button";
    button.dataset.tab = id;
    tabButtons.set(id, button);
    tabBar.appendChild(button);
  }
  dialog.appendChild(tabBar);

  const body = element("div", "m3ss-body");
  dialog.appendChild(body);

  const footer = element("footer", "m3ss-footer");
  const durationStatus = element("div", "m3ss-duration-status");
  footer.appendChild(durationStatus);
  const footerActions = element("div", "m3ss-footer-actions");
  const resetButton = element("button", "m3ss-button m3ss-button-secondary", "Reset V1 Defaults");
  resetButton.type = "button";
  const cancelButton = element("button", "m3ss-button m3ss-button-secondary", "Cancel");
  cancelButton.type = "button";
  const saveButton = element("button", "m3ss-button m3ss-button-primary", "Save to Node");
  saveButton.type = "button";
  footerActions.append(resetButton, cancelButton, saveButton);
  footer.appendChild(footerActions);
  dialog.appendChild(footer);

  function escapeHandler(event) {
    if (event.key === "Escape" && overlay.isConnected) close();
  }

  function close() {
    document.removeEventListener("keydown", escapeHandler);
    overlay.remove();
  }

  function updateDurationStatus() {
    durationStatus.textContent = `Timeline target: ${totalDuration(project).toFixed(2)} s · ${project.timeline.sections.length} sections`;
  }

  function renderGlobal() {
    body.replaceChildren();
    const grid = element("div", "m3ss-grid m3ss-grid-3");
    const g = project.global;
    const v = g.vocal;

    const title = textInput(g.title, "Optional working title");
    title.addEventListener("input", () => { g.title = title.value; });
    grid.appendChild(field("Working title", title, "Project-only metadata; not injected into the caption in V1."));

    const genre = textInput(g.genre, "Pop, J-Pop, cinematic...");
    genre.addEventListener("input", () => { g.genre = genre.value; });
    grid.appendChild(field("Genre", genre));

    const subgenres = textInput((g.subgenres || []).join(", "), "city pop, rock, orchestral");
    subgenres.addEventListener("input", () => { g.subgenres = parseList(subgenres.value); });
    grid.appendChild(field("Subgenres / influences", subgenres, "Comma-separated."));

    const bpm = numberInput(g.bpm || 120, 20, 400, 1);
    bpm.addEventListener("input", () => { g.bpm = Number(bpm.value) || 120; });
    grid.appendChild(field("BPM target", bpm, "Semantic target, not a strict symbolic guarantee."));

    const meter = textInput(g.meter || "4/4", "4/4");
    meter.addEventListener("input", () => { g.meter = meter.value; });
    grid.appendChild(field("Meter", meter));

    const key = textInput(g.key, "C, F#, Eb...");
    key.addEventListener("input", () => { g.key = key.value; });
    grid.appendChild(field("Key target", key, "Leave blank when not explicitly needed."));

    const scale = textInput(g.scale, "major, minor...");
    scale.addEventListener("input", () => { g.scale = scale.value; });
    grid.appendChild(field("Scale", scale));

    const mood = textInput(g.mood, "uplifting, intimate, dark...");
    mood.addEventListener("input", () => { g.mood = mood.value; });
    grid.appendChild(field("Mood / emotional direction", mood));

    const production = textInput(g.production, "polished, dry, wide, live-room...");
    production.addEventListener("input", () => { g.production = production.value; });
    grid.appendChild(field("Production profile", production));

    body.appendChild(grid);
    body.appendChild(element("h3", "m3ss-section-heading", "Vocal Details"));

    const vocalGrid = element("div", "m3ss-grid m3ss-grid-3");
    const mode = selectInput(["vocal", "instrumental"], v.mode || "vocal");
    mode.addEventListener("change", () => { v.mode = mode.value; });
    vocalGrid.appendChild(field("Mode", mode));

    for (const [keyName, label, placeholder] of [
      ["gender", "Lead configuration / gender", "female, male, duet..."],
      ["timbre", "Timbre", "clear, warm, breathy..."],
      ["delivery", "Delivery", "intimate, powerful, rhythmic..."],
      ["harmony", "Harmony / backing", "soft harmony in choruses..."],
      ["effects", "Vocal effects", "light room reverb..."],
    ]) {
      const input = textInput(v[keyName] || "", placeholder);
      input.addEventListener("input", () => { v[keyName] = input.value; });
      vocalGrid.appendChild(field(label, input));
    }
    body.appendChild(vocalGrid);
  }

  function renderTimeline() {
    body.replaceChildren();
    const toolbar = element("div", "m3ss-timeline-toolbar");
    const note = element("p", "m3ss-note", "Section duration and energy are compiled into semantic arrangement instructions. Duration also syncs the node's max_duration when saved.");
    const addButton = element("button", "m3ss-button m3ss-button-secondary", "+ Add Section");
    addButton.type = "button";
    addButton.addEventListener("click", () => {
      if (project.timeline.sections.length >= 32) {
        alert("V1 supports up to 32 sections.");
        return;
      }
      project.timeline.sections.push(makeSection());
      renderTimeline();
      updateDurationStatus();
    });
    toolbar.append(note, addButton);
    body.appendChild(toolbar);

    const list = element("div", "m3ss-section-list");
    project.timeline.sections.forEach((section, index) => {
      const card = element("article", "m3ss-section-card");
      const head = element("div", "m3ss-section-card-head");
      const indexLabel = element("span", "m3ss-section-index", `${index + 1}`);
      const name = element("strong", "m3ss-section-name", section.label || section.type || "Section");
      const controls = element("div", "m3ss-section-controls");
      const up = element("button", "m3ss-icon-button", "↑");
      const down = element("button", "m3ss-icon-button", "↓");
      const remove = element("button", "m3ss-icon-button m3ss-danger", "×");
      [up, down, remove].forEach((button) => { button.type = "button"; });
      up.disabled = index === 0;
      down.disabled = index === project.timeline.sections.length - 1;
      up.setAttribute("aria-label", `Move ${section.label || section.type} up`);
      down.setAttribute("aria-label", `Move ${section.label || section.type} down`);
      remove.setAttribute("aria-label", `Delete ${section.label || section.type}`);
      up.addEventListener("click", () => {
        if (index <= 0) return;
        [project.timeline.sections[index - 1], project.timeline.sections[index]] = [project.timeline.sections[index], project.timeline.sections[index - 1]];
        renderTimeline();
      });
      down.addEventListener("click", () => {
        if (index >= project.timeline.sections.length - 1) return;
        [project.timeline.sections[index + 1], project.timeline.sections[index]] = [project.timeline.sections[index], project.timeline.sections[index + 1]];
        renderTimeline();
      });
      remove.addEventListener("click", () => {
        if (project.timeline.sections.length === 1) {
          alert("At least one section is required.");
          return;
        }
        project.timeline.sections.splice(index, 1);
        renderTimeline();
        updateDurationStatus();
      });
      controls.append(up, down, remove);
      head.append(indexLabel, name, controls);
      card.appendChild(head);

      const firstRow = element("div", "m3ss-grid m3ss-grid-4");
      const typeSelect = selectInput(SECTION_TYPES, section.type || "Verse");
      typeSelect.addEventListener("change", () => {
        section.type = typeSelect.value;
        if (!section.label) section.label = typeSelect.value;
        renderTimeline();
      });
      firstRow.appendChild(field("Section type", typeSelect));

      const label = textInput(section.label || section.type, "Verse 1");
      label.addEventListener("input", () => {
        section.label = label.value;
        name.textContent = label.value || section.type;
      });
      firstRow.appendChild(field("Display label", label));

      const duration = numberInput(section.duration ?? 16, 0.5, 360, 0.5);
      duration.addEventListener("input", () => {
        section.duration = Math.max(0.5, Math.min(360, Number(duration.value) || 0.5));
        updateDurationStatus();
      });
      firstRow.appendChild(field("Target seconds", duration));

      const energyWrap = element("div", "m3ss-energy-control");
      const energy = document.createElement("input");
      energy.type = "range";
      energy.min = "0";
      energy.max = "100";
      energy.step = "1";
      energy.value = String(Math.round((Number(section.energy) || 0) * 100));
      const energyValue = element("span", "m3ss-energy-value", `${energy.value}%`);
      energyWrap.append(energy, energyValue);
      energy.addEventListener("input", () => {
        section.energy = Number(energy.value) / 100;
        energyValue.textContent = `${energy.value}%`;
      });
      firstRow.appendChild(field("Energy", energyWrap));
      card.appendChild(firstRow);

      const secondRow = element("div", "m3ss-grid m3ss-grid-2");
      const instruments = textInput((section.instruments || []).join(", "), "piano, bass, drums");
      instruments.addEventListener("input", () => { section.instruments = parseList(instruments.value); });
      secondRow.appendChild(field("Instruments", instruments, "Comma-separated; describes entries/exits, not literal stem routing."));

      const vocal = textInput(section.vocal || "", "soft, power, intimate, instrumental...");
      vocal.addEventListener("input", () => { section.vocal = vocal.value; });
      secondRow.appendChild(field("Section vocal treatment", vocal));
      card.appendChild(secondRow);

      const lyricArea = rows(textarea(section.lyrics || "", "Lyrics for this section. Do not include [Verse]/[Chorus] tags; the compiler adds them."), 4);
      lyricArea.addEventListener("input", () => { section.lyrics = lyricArea.value; });
      card.appendChild(field("Lyrics", lyricArea));

      const directives = rows(textarea(section.directives || "", "What enters, exits, intensifies, or changes in this section?"), 2);
      directives.addEventListener("input", () => { section.directives = directives.value; });
      card.appendChild(field("Arrangement directive", directives));

      list.appendChild(card);
    });
    body.appendChild(list);
  }

  function renderPreview() {
    body.replaceChildren();
    const compiled = compilePreview(project);
    const warning = element("div", "m3ss-callout");
    warning.textContent = "V1 compiles the timeline into text conditioning. BPM, key, section timing, energy, and instrumentation are generative targets rather than strict symbolic controls.";
    body.appendChild(warning);

    const previewGrid = element("div", "m3ss-preview-grid");
    const captionPanel = element("section", "m3ss-preview-panel");
    captionPanel.appendChild(element("h3", "m3ss-section-heading", "Caption sent to MiniMax Music3"));
    const captionPre = element("pre", "m3ss-pre", compiled.caption);
    captionPanel.appendChild(captionPre);
    previewGrid.appendChild(captionPanel);

    const lyricsPanel = element("section", "m3ss-preview-panel");
    lyricsPanel.appendChild(element("h3", "m3ss-section-heading", "Lyrics sent to MiniMax Music3"));
    const lyricsPre = element("pre", "m3ss-pre", compiled.lyrics || "(section tags only / no lyric text)");
    lyricsPanel.appendChild(lyricsPre);
    previewGrid.appendChild(lyricsPanel);
    body.appendChild(previewGrid);
  }

  function render() {
    for (const [id, button] of tabButtons) button.classList.toggle("is-active", id === activeTab);
    if (activeTab === "global") renderGlobal();
    else if (activeTab === "timeline") renderTimeline();
    else renderPreview();
    updateDurationStatus();
  }

  for (const [id, button] of tabButtons) {
    button.addEventListener("click", () => {
      activeTab = id;
      render();
    });
  }

  closeButton.addEventListener("click", close);
  cancelButton.addEventListener("click", close);
  overlay.addEventListener("mousedown", (event) => {
    if (event.target === overlay) close();
  });
  document.addEventListener("keydown", escapeHandler);

  resetButton.addEventListener("click", () => {
    if (!confirm("Reset this editor session to the V1 defaults? The node is not changed until Save to Node is pressed.")) return;
    const currentProjectId = project.project_id;
    project = factoryProject();
    project.project_id = currentProjectId || createId("project");
    render();
  });

  saveButton.addEventListener("click", () => {
    const sections = project.timeline.sections;
    if (!sections.length) {
      alert("At least one section is required.");
      return;
    }
    if (sections.length > 32) {
      alert("V1 supports up to 32 sections.");
      return;
    }

    const serialized = JSON.stringify(project);
    projectWidget.value = serialized;
    projectWidget.callback?.(serialized);

    const durationWidget = getWidget(node, "max_duration");
    if (durationWidget) {
      const optionsMax = Number(durationWidget.options?.max);
      const maxAllowed = Number.isFinite(optionsMax) ? optionsMax : 360;
      const duration = Math.max(0.04, Math.min(maxAllowed, totalDuration(project)));
      durationWidget.value = Math.round(duration * 100) / 100;
      durationWidget.callback?.(durationWidget.value);
    }

    node.setDirtyCanvas?.(true, true);
    app.graph?.setDirtyCanvas?.(true, true);
    close();
  });

  document.body.appendChild(overlay);
  render();
}

app.registerExtension({
  name: EXTENSION_NAME,
  async nodeCreated(node) {
    if (nodeClass(node) !== NODE_ID || node._m3ssButtonInstalled) return;
    node._m3ssButtonInstalled = true;
    ensureStyles();

    const button = node.addWidget?.("button", "Open Semantic Studio", null, () => openStudio(node), {
      serialize: false,
    });
    if (button) button.label = "Open Semantic Studio";
    node.setSize?.([Math.max(node.size?.[0] || 320, 320), node.size?.[1] || 180]);
  },
});
