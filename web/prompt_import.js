import { createStudioWindow } from "./studio_shell.js";
import { analyzePromptImport, applyPromptImport } from "./prompt_import_core.js";
import { el, button, textarea, selectInput } from "./semantic_studio_core.js";

const STYLE_ID = "m3ss-prompt-import-style";

function ensureStyles() {
  if (document.getElementById(STYLE_ID)) return;
  const link = document.createElement("link");
  link.id = STYLE_ID;
  link.rel = "stylesheet";
  link.href = new URL("./prompt_import.css", import.meta.url).href;
  document.head.appendChild(link);
}

function keyValue(label, value) {
  const row = el("div", "m3import-kv");
  row.append(el("span", "m3import-k", label), el("span", "m3import-v", String(value)));
  return row;
}

function summarizeGlobal(analysis) {
  const box = el("div", "m3import-summary-grid");
  for (const key of analysis.global.present || []) box.appendChild(keyValue(key, analysis.global.values[key]));
  for (const key of analysis.vocal.present || []) box.appendChild(keyValue(`vocal.${key}`, analysis.vocal.values[key]));
  if (!box.children.length) box.appendChild(el("div", "m3import-empty", "No Global/Vocal fields detected."));
  return box;
}

function sectionTable(analysis) {
  const wrap = el("div", "m3import-table-wrap"), table = el("table", "m3import-table");
  const head = document.createElement("thead"), headRow = document.createElement("tr");
  for (const heading of ["#", "Section", "Type", "Duration", "Energy", "Instruments", "Lyrics"]) headRow.appendChild(el("th", "", heading));
  head.appendChild(headRow); table.appendChild(head);
  const body = document.createElement("tbody");
  analysis.sections.forEach((section, index) => {
    const row = document.createElement("tr");
    const energy = section.energy === undefined ? "—" : `${Math.round(section.energy * 100)}%${section.energy_precision === "phrase" ? " ≈" : ""}`;
    for (const value of [index + 1, section.label || section.type, section.type, section.duration === undefined ? "—" : `${Number(section.duration).toFixed(1)}s`, energy, (section.instruments || []).join(", ") || "—", section.lyrics ? "Yes" : "—"]) row.appendChild(el("td", "", String(value)));
    body.appendChild(row);
  });
  table.appendChild(body); wrap.appendChild(table);
  return wrap;
}

export function openPromptImporter({
  project,
  onApply,
  title = "Import Music3 Prompt",
  subtitle = "Paste an external LLM Caption/Lyrics, analyze it, then apply after reviewing the detected structure.",
  initialCaption = "",
  initialLyrics = "",
  defaultMode = "replace",
  autoAnalyze = false,
} = {}) {
  ensureStyles();
  let analysis = null;
  let analysisStale = false;
  let mode = defaultMode === "merge" ? "merge" : "replace";
  const shell = createStudioWindow({ title, subtitle, storageKey: "m3ss-prompt-import-window", defaultWidth: 1180, defaultHeight: 820, minWidth: 780, minHeight: 560 });
  shell.window.classList.add("m3import-dialog");

  const root = el("div", "m3import-root"), inputs = el("section", "m3import-inputs"), results = el("section", "m3import-results"), footer = el("footer", "m3import-footer");
  shell.content.appendChild(root); root.append(inputs, results, footer);

  const captionField = el("label", "m3import-field"), caption = textarea(initialCaption, "Paste ### Global Metadata / ### Vocal Details / ### Arrangement here.", 14);
  captionField.append(el("span", "m3import-label", "Caption / Structured Caption"), caption);
  const lyricsField = el("label", "m3import-field"), lyrics = textarea(initialLyrics, "Paste [Intro] / [Verse] / [Chorus] tagged lyrics here. If a combined prompt contains ### Lyrics, you may paste everything in Caption.", 14);
  lyricsField.append(el("span", "m3import-label", "Lyrics"), lyrics);

  const importMode = selectInput([
    { value: "replace", label: "Replace section structure" },
    { value: "merge", label: "Merge detected fields" },
  ], mode);
  importMode.onchange = () => { mode = importMode.value; updateApplyHint(); };
  const modeRow = el("div", "m3import-mode-row");
  modeRow.append(el("span", "m3import-label", "Import mode"), importMode, el("span", "m3import-mode-help", "Replace rebuilds section order from the analyzed prompt. Merge updates matching section-type occurrences and appends missing sections. Reserved V2/V3 fields are always preserved."));
  inputs.append(captionField, lyricsField, modeRow);

  const resultHead = el("div", "m3import-result-head"), badges = el("div", "m3import-badges"), resultBody = el("div", "m3import-result-body");
  resultHead.append(el("h3", "", "Import Preview"), badges); results.append(resultHead, resultBody);

  const status = el("div", "m3import-status", "Paste Caption/Lyrics, then click Analyze."), cancel = button("Cancel", "m3import-button secondary"), clear = button("Clear", "m3import-button secondary"), analyze = button("Analyze", "m3import-button analyze"), apply = button("Apply Import", "m3import-button primary"), footerActions = el("div", "m3import-actions");
  apply.disabled = true;
  analyze.title = "Analyze pasted Caption/Lyrics · Ctrl+Enter";
  footerActions.append(cancel, clear, analyze, apply); footer.append(status, footerActions);

  const hasInput = () => !!(String(caption.value).trim() || String(lyrics.value).trim());

  function updateApplyHint() {
    if (analysisStale) {
      status.textContent = "Caption/Lyrics changed · click Analyze again before applying.";
      return;
    }
    status.textContent = analysis
      ? `${mode === "replace" ? "Replace section structure" : "Merge detected fields"} · ${analysis.sections.length} detected section(s) · review preview, then Apply Import.`
      : hasInput() ? "Ready to analyze · click Analyze (Ctrl+Enter)." : "Paste Caption/Lyrics, then click Analyze.";
  }

  function renderAnalysis() {
    resultBody.replaceChildren(); badges.replaceChildren();
    if (!analysis || analysisStale) {
      resultBody.appendChild(el("div", "m3import-empty", analysisStale
        ? "Input changed after the last analysis. Click Analyze again to refresh this preview."
        : "No analysis yet. Paste Caption/Lyrics, then click Analyze."));
      apply.disabled = true; updateApplyHint(); return;
    }
    badges.append(
      el("span", "m3import-badge", analysis.format),
      el("span", "m3import-badge", `${analysis.stats.global_fields} global`),
      el("span", "m3import-badge", `${analysis.stats.vocal_fields} vocal`),
      el("span", "m3import-badge", `${analysis.stats.sections} sections`),
    );
    resultBody.append(
      el("h4", "", "Detected Global / Vocal"), summarizeGlobal(analysis),
      el("h4", "", "Detected Sections"), analysis.sections.length ? sectionTable(analysis) : el("div", "m3import-empty", "No sections detected."),
    );
    if (analysis.warnings.length) {
      const warnings = el("div", "m3import-warnings"), list = document.createElement("ul");
      for (const warning of analysis.warnings) list.appendChild(el("li", "", warning));
      warnings.append(el("strong", "", "Warnings"), list); resultBody.appendChild(warnings);
    }
    apply.disabled = !(analysis.stats.global_fields || analysis.stats.vocal_fields || analysis.stats.sections);
    updateApplyHint();
  }

  const runAnalysis = () => {
    analysis = analyzePromptImport({ caption: caption.value, lyrics: lyrics.value });
    analysisStale = false;
    renderAnalysis();
  };
  const invalidateAnalysis = () => {
    if (analysis && !analysisStale) analysisStale = true;
    apply.disabled = true;
    renderAnalysis();
  };

  caption.addEventListener("input", invalidateAnalysis);
  lyrics.addEventListener("input", invalidateAnalysis);
  analyze.onclick = runAnalysis;
  clear.onclick = () => { caption.value = ""; lyrics.value = ""; analysis = null; analysisStale = false; renderAnalysis(); };
  cancel.onclick = () => shell.close();
  apply.onclick = () => {
    if (!analysis || analysisStale) return;
    const next = applyPromptImport(project, analysis, mode);
    onApply?.(next, analysis, { mode });
    shell.close();
  };
  shell.window.addEventListener("keydown", (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key === "Enter") {
      event.preventDefault();
      runAnalysis();
    }
  });

  shell.mount();
  if (autoAnalyze && (String(initialCaption).trim() || String(initialLyrics).trim())) runAnalysis();
  else renderAnalysis();
  return shell;
}
