import { SECTION_TYPES, clone, factoryProject, makeSection, normalizeProject, parseList, uid, clamp } from "./semantic_studio_core.js";

const TAG_ALIASES = new Map([
  ["intro", "Intro"], ["verse", "Verse"], ["pre-chorus", "Pre-Chorus"], ["prechorus", "Pre-Chorus"],
  ["chorus", "Chorus"], ["hook", "Chorus"], ["refrain", "Chorus"], ["post-chorus", "Post-Chorus"], ["postchorus", "Post-Chorus"],
  ["bridge", "Bridge"], ["instrumental", "Instrumental"], ["instrumental break", "Instrumental"],
  ["solo", "Solo"], ["guitar solo", "Solo"], ["outro", "Outro"],
]);
const DEFAULT_DURATION = { Intro: 8, Verse: 24, "Pre-Chorus": 8, Chorus: 20, "Post-Chorus": 8, Bridge: 16, Instrumental: 16, Solo: 16, Outro: 8 };
const ENERGY_PHRASES = [
  [/very sparse and restrained/i, .10], [/low-density and restrained/i, .28], [/moderate and controlled/i, .50],
  [/full and energetic/i, .72], [/high-intensity and expansive/i, .90], [/peak intensity and maximum arrangement density/i, 1.0],
];

const clean = (value) => String(value ?? "").replace(/\r\n?/g, "\n").trim();
const fieldMatch = (text, regex) => { const match = text.match(regex); return match ? clean(match[1]) : ""; };

function normalizeTag(raw) {
  let key = clean(raw).toLowerCase().replace(/[‐‑‒–—]/g, "-").replace(/\s+/g, " ");
  key = key.replace(/\s*(?:#?\d+|\d+(?:st|nd|rd|th))\s*$/i, "").trim();
  if (key.startsWith("final chorus")) return "Chorus";
  if (TAG_ALIASES.has(key)) return TAG_ALIASES.get(key);
  for (const [alias, type] of TAG_ALIASES) if (key.startsWith(alias + " ")) return type;
  return null;
}

function labelFor(type, occurrence, raw = "") {
  const explicit = clean(raw);
  if (explicit) return explicit;
  if (type === "Intro" || type === "Bridge" || type === "Outro") return occurrence === 1 ? type : `${type} ${occurrence}`;
  return `${type} ${occurrence}`;
}

function parseTime(value) {
  const match = clean(value).match(/^(?:(\d+):)?(\d+)(?::(\d+(?:\.\d+)?))?$/);
  if (!match) return null;
  if (match[3] !== undefined) return Number(match[1] || 0) * 3600 + Number(match[2]) * 60 + Number(match[3]);
  return Number(match[1] || 0) * 60 + Number(match[2]);
}

function parseEnergy(text) {
  const numeric = text.match(/(?:energy\s*[:=]?\s*)?(\d{1,3}(?:\.\d+)?)\s*%/i);
  if (numeric) return { value: clamp(Number(numeric[1]) / 100, 0, 1), precision: "exact" };
  for (const [regex, value] of ENERGY_PHRASES) if (regex.test(text)) return { value, precision: "phrase" };
  return null;
}

function splitHeadings(caption) {
  const blocks = { global: "", vocal: "", arrangement: "" };
  let current = null;
  for (const line of clean(caption).split("\n")) {
    const heading = line.match(/^\s*#{1,6}\s*(Global Metadata|Vocal Details|Arrangement)\s*$/i);
    if (heading) {
      const key = heading[1].toLowerCase();
      current = key.startsWith("global") ? "global" : key.startsWith("vocal") ? "vocal" : "arrangement";
      continue;
    }
    if (current) blocks[current] += (blocks[current] ? "\n" : "") + line;
  }
  return blocks;
}

function parseGlobal(text) {
  const values = {}, present = [];
  const genre = fieldMatch(text, /\bGenre\s*:\s*([^\n.]+)/i);
  if (genre) {
    const parts = genre.match(/^(.*?)\s+with\s+(.+?)\s+influences?$/i);
    values.genre = clean(parts ? parts[1] : genre); present.push("genre");
    if (parts) { values.subgenres = parseList(parts[2]); present.push("subgenres"); }
  }
  const tempo = text.match(/(?:Tempo(?:\s+target)?|BPM)\s*:\s*(?:approximately\s*)?(\d+(?:\.\d+)?)\s*BPM?(?:\s+in\s+([0-9]+\/[0-9]+)\s*(?:meter)?)?/i);
  if (tempo) {
    values.bpm = Math.round(Number(tempo[1])); present.push("bpm");
    if (tempo[2]) { values.meter = tempo[2]; present.push("meter"); }
  }
  if (!values.meter) {
    const meter = fieldMatch(text, /(?:Meter|Time signature)\s*:\s*([^\n.]+)/i);
    if (meter) { values.meter = meter; present.push("meter"); }
  }
  const keyScale = fieldMatch(text, /(?:Key\/scale target|Key\/Scale|Key)\s*:\s*([^\n.]+)/i);
  if (keyScale) { values.key = keyScale; present.push("key"); }
  const mood = fieldMatch(text, /(?:Mood and emotional direction|Mood)\s*:\s*([^\n]+)/i);
  if (mood) { values.mood = mood.replace(/\.$/, ""); present.push("mood"); }
  const production = fieldMatch(text, /(?:Production profile|Production)\s*:\s*([^\n]+)/i);
  if (production) { values.production = production.replace(/\.$/, ""); present.push("production"); }
  return { values, present };
}

function parseVocal(text) {
  const values = {}, present = [];
  if (!clean(text)) return { values, present };
  if (/instrumental piece|no lead or backing vocals|\binstrumental\b/i.test(text)) { values.mode = "instrumental"; present.push("mode"); }
  const lead = fieldMatch(text, /Lead vocal\s*:\s*([^\n.]+)/i);
  if (lead) {
    values.mode = "vocal"; if (!present.includes("mode")) present.push("mode");
    for (const [index, rawPart] of lead.split(";").entries()) {
      const part = clean(rawPart); if (!part) continue;
      if (/^timbre\s+/i.test(part)) { values.timbre = part.replace(/^timbre\s+/i, ""); present.push("timbre"); }
      else if (/^delivery\s+/i.test(part)) { values.delivery = part.replace(/^delivery\s+/i, ""); present.push("delivery"); }
      else if (index === 0) { values.gender = part; present.push("gender"); }
    }
  }
  const harmony = fieldMatch(text, /Harmony\/backing vocals\s*:\s*([^\n.]+)/i);
  if (harmony) { values.harmony = harmony; present.push("harmony"); }
  const effects = fieldMatch(text, /Vocal effects\s*:\s*([^\n.]+)/i);
  if (effects) { values.effects = effects; present.push("effects"); }
  return { values, present: [...new Set(present)] };
}

function sectionStart(line) {
  const match = line.match(/^\s*(?:[-*]\s*)?((?:Final\s+)?(?:Intro|Verse|Pre[- ]?Chorus|Chorus|Post[- ]?Chorus|Bridge|Instrumental(?:\s+Break)?|Solo|Outro)(?:\s*#?\d+)?)\s*(?:\(([^)]*)\))?\s*:\s*(.*)$/i);
  if (!match) return null;
  const type = normalizeTag(match[1]);
  return type ? { label: clean(match[1]), type, meta: clean(match[2]), body: clean(match[3]) } : null;
}

function parseArrangement(text, warnings) {
  const lines = clean(text).split("\n"), rawSections = [];
  let current = null;
  for (const line of lines) {
    const start = sectionStart(line);
    if (start) { if (current) rawSections.push(current); current = start; }
    else if (current && clean(line)) current.body += (current.body ? " " : "") + clean(line);
  }
  if (current) rawSections.push(current);
  const counts = new Map();
  return rawSections.map((raw, index) => {
    const occurrence = (counts.get(raw.type) || 0) + 1; counts.set(raw.type, occurrence);
    const section = { type: raw.type, label: raw.label || labelFor(raw.type, occurrence), present: ["type", "label"] };
    const range = raw.meta.match(/(\d+:\d+(?::\d+(?:\.\d+)?)?)\s*[–—-]\s*(\d+:\d+(?::\d+(?:\.\d+)?)?)/);
    if (range) {
      const start = parseTime(range[1]), end = parseTime(range[2]);
      if (start !== null && end !== null && end > start) { section.duration = Number((end - start).toFixed(3)); section.present.push("duration"); }
    }
    const energy = parseEnergy(`${raw.meta} ${raw.body}`);
    if (energy) {
      section.energy = energy.value; section.energy_precision = energy.precision; section.present.push("energy");
      if (energy.precision === "phrase") warnings.push(`${section.label}: energy was inferred approximately from descriptive text.`);
    }
    const instruments = raw.body.match(/(?:^|\s)Use\s+([^.;]+(?:,\s*[^.;]+)*)\./i) || raw.body.match(/(?:^|\s)Instruments?\s*:\s*([^.;]+(?:,\s*[^.;]+)*)\./i);
    if (instruments) { section.instruments = parseList(instruments[1].replace(/\band\b/gi, ",")); section.present.push("instruments"); }
    const vocal = raw.body.match(/Vocal treatment\s*:\s*([^.;]+)/i);
    if (vocal) { section.vocal = clean(vocal[1]); section.present.push("vocal"); }
    let directive = raw.body;
    directive = directive.replace(/(?:^|\s)(?:Use\s+[^.]+\.|Instruments?\s*:\s*[^.]+\.)/i, " ").replace(/Vocal treatment\s*:\s*[^.]+\.?/i, " ").replace(/\s+/g, " ").trim().replace(/^[-:;,.\s]+|[-:;,.\s]+$/g, "");
    if (directive) { section.directives = directive; section.present.push("directives"); }
    section.source_index = index;
    return section;
  });
}

function parseLyrics(text, warnings) {
  const input = clean(text);
  if (!input) return [];
  const tagRegex = /^\s*\[([^\]]+)\]\s*$/gm, matches = [...input.matchAll(tagRegex)];
  if (!matches.length) { warnings.push("Lyrics were provided but no recognized [Verse]/[Chorus]-style section tags were found."); return []; }
  const counts = new Map(), blocks = [];
  for (let index = 0; index < matches.length; index++) {
    const type = normalizeTag(matches[index][1]);
    const start = matches[index].index + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : input.length;
    const blockText = clean(input.slice(start, end));
    if (!type) { warnings.push(`Lyrics tag [${matches[index][1]}] is unsupported and was skipped.`); continue; }
    const occurrence = (counts.get(type) || 0) + 1; counts.set(type, occurrence);
    blocks.push({ type, label: labelFor(type, occurrence), lyrics: blockText, present: ["type", "label", "lyrics"] });
  }
  const prefix = clean(input.slice(0, matches[0].index));
  if (prefix) warnings.push("Text before the first Lyrics section tag was not imported.");
  return blocks;
}

function combineSections(arrangement, lyrics, warnings) {
  const sections = arrangement.map((section) => clone(section)), byType = new Map();
  for (const section of sections) { const items = byType.get(section.type) || []; items.push(section); byType.set(section.type, items); }
  const seen = new Map();
  for (const block of lyrics) {
    const occurrence = seen.get(block.type) || 0; seen.set(block.type, occurrence + 1);
    const target = (byType.get(block.type) || [])[occurrence];
    if (target) {
      target.lyrics = block.lyrics; if (!target.present.includes("lyrics")) target.present.push("lyrics");
    } else {
      const created = { ...block, duration: DEFAULT_DURATION[block.type] || 16, energy: .5, instruments: [], vocal: "", directives: "", present: [...block.present, "duration", "energy", "instruments", "vocal", "directives"], duration_defaulted: true };
      sections.push(created); const items = byType.get(block.type) || []; items.push(created); byType.set(block.type, items);
      warnings.push(`${created.label}: section was created from Lyrics only; duration/energy use defaults.`);
    }
  }
  return sections;
}

function splitCombined(caption, lyrics) {
  if (clean(lyrics)) return { caption: clean(caption), lyrics: clean(lyrics) };
  const source = clean(caption), match = source.match(/(?:^|\n)#{1,6}\s*Lyrics\s*\n/i);
  if (!match) return { caption: source, lyrics: "" };
  const index = (match.index || 0) + match[0].length;
  return { caption: source.slice(0, match.index).trim(), lyrics: source.slice(index).trim() };
}

export function analyzePromptImport({ caption = "", lyrics = "" } = {}) {
  const split = splitCombined(caption, lyrics), warnings = [], blocks = splitHeadings(split.caption);
  const structured = !!(blocks.global || blocks.vocal || blocks.arrangement);
  const global = parseGlobal(blocks.global || split.caption), vocal = parseVocal(blocks.vocal || split.caption);
  const arrangement = parseArrangement(blocks.arrangement || "", warnings), lyricSections = parseLyrics(split.lyrics, warnings);
  const sections = combineSections(arrangement, lyricSections, warnings);
  if (split.caption && !structured && !Object.keys(global.values).length && !Object.keys(vocal.values).length) warnings.push("Caption is not in a recognized structured Music3 format. No caption fields were imported.");
  if (!split.caption && !split.lyrics) warnings.push("Paste a Caption and/or tagged Lyrics before analyzing.");
  return {
    caption: split.caption, lyrics: split.lyrics, format: structured ? "structured" : split.lyrics ? "lyrics" : "partial",
    global, vocal, sections, warnings,
    stats: { global_fields: global.present.length, vocal_fields: vocal.present.length, sections: sections.length, lyrics_sections: lyricSections.length },
  };
}

function patchFields(target, values, present) {
  for (const key of present || []) if (Object.prototype.hasOwnProperty.call(values, key)) target[key] = clone(values[key]);
}

function newSectionFromImport(imported, index) {
  const type = SECTION_TYPES.includes(imported.type) ? imported.type : "Verse";
  const section = makeSection(type, imported.label || type, imported.duration ?? DEFAULT_DURATION[type] ?? 16, Math.round((imported.energy ?? .5) * 100), imported.instruments || [], imported.vocal || "", imported.directives || "");
  section.id = uid(type.toLowerCase().replace(/[^a-z0-9]+/g, "-") || `section-${index + 1}`);
  section.lyrics = imported.lyrics || "";
  return section;
}

function matchSections(existing, imports) {
  const occurrence = new Map(), existingByType = new Map();
  for (const section of existing) { const items = existingByType.get(section.type) || []; items.push(section); existingByType.set(section.type, items); }
  return imports.map((imported) => {
    const index = occurrence.get(imported.type) || 0; occurrence.set(imported.type, index + 1);
    return (existingByType.get(imported.type) || [])[index] || null;
  });
}

export function applyPromptImport(project, analysis, mode = "merge") {
  const current = normalizeProject(project), next = clone(current);
  patchFields(next.global, analysis.global.values, analysis.global.present);
  patchFields(next.global.vocal, analysis.vocal.values, analysis.vocal.present);
  if (analysis.sections.length) {
    if (mode === "replace") {
      next.timeline.sections = analysis.sections.slice(0, 32).map(newSectionFromImport);
    } else {
      const matches = matchSections(next.timeline.sections, analysis.sections);
      for (let index = 0; index < analysis.sections.length; index++) {
        const imported = analysis.sections[index], target = matches[index];
        if (!target) { if (next.timeline.sections.length < 32) next.timeline.sections.push(newSectionFromImport(imported, index)); continue; }
        for (const key of imported.present || []) {
          if (["type", "label", "duration", "energy", "lyrics", "instruments", "vocal", "directives"].includes(key) && Object.prototype.hasOwnProperty.call(imported, key)) target[key] = clone(imported[key]);
        }
      }
    }
  }
  next.project_id = current.project_id;
  next.audio_edits = current.audio_edits;
  next.takes = current.takes;
  next.conditioning_tracks = current.conditioning_tracks;
  return normalizeProject(next);
}
