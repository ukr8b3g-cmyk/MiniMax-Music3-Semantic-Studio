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
  key = key.replace(/\s+sections?$/i, "").replace(/s$/i, (suffix) => suffix);
  if (key === "verses") key = "verse";
  if (key === "choruses") key = "chorus";
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
  const source = clean(caption), blocks = { global: "", vocal: "", arrangement: "" };
  if (!source) return blocks;
  const marker = /(?:^|\n)\s*(?:#{1,6}\s*)?(Global Metadata|Vocal Details|Arrangement)\s*(?::\s*|\n)/gi;
  const matches = [...source.matchAll(marker)];
  for (let index = 0; index < matches.length; index++) {
    const heading = matches[index][1].toLowerCase();
    const key = heading.startsWith("global") ? "global" : heading.startsWith("vocal") ? "vocal" : "arrangement";
    const start = (matches[index].index || 0) + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    blocks[key] = clean(source.slice(start, end));
  }
  return blocks;
}

function parseGlobal(text) {
  const source = clean(text), values = {}, present = [];
  let genre = fieldMatch(source, /\bGenre\s*:\s*([^\n.]+)/i);
  if (!genre && source) {
    const firstSentence = clean((source.match(/^([^.!?]+)[.!?]/) || [])[1]);
    if (firstSentence && !/^\d+(?:\.\d+)?\s*BPM/i.test(firstSentence)) genre = firstSentence;
  }
  if (genre) {
    const parts = genre.match(/^(.*?)\s+with\s+(.+?)\s+influences?$/i);
    values.genre = clean(parts ? parts[1] : genre); present.push("genre");
    if (parts) { values.subgenres = parseList(parts[2]); present.push("subgenres"); }
  }

  let tempo = source.match(/(?:Tempo(?:\s+target)?|BPM)\s*:\s*(?:approximately\s*)?(\d+(?:\.\d+)?)\s*BPM?(?:\s+in\s+([0-9]+\/[0-9]+)\s*(?:meter)?)?/i);
  if (!tempo) tempo = source.match(/\b(\d+(?:\.\d+)?)\s*BPM\b(?:\s*,?\s*([0-9]+\/[0-9]+)\b)?/i);
  if (tempo) {
    values.bpm = Math.round(Number(tempo[1])); present.push("bpm");
    if (tempo[2]) { values.meter = tempo[2]; present.push("meter"); }
  }
  if (!values.meter) {
    const meter = fieldMatch(source, /(?:Meter|Time signature)\s*:\s*([^\n.]+)/i) || clean((source.match(/\b([0-9]+\/[0-9]+)\b/) || [])[1]);
    if (meter) { values.meter = meter; present.push("meter"); }
  }

  let keyScale = fieldMatch(source, /(?:Key\/scale target|Key\/Scale|Key)\s*:\s*([^\n.]+)/i);
  if (!keyScale) keyScale = clean((source.match(/\b([A-G](?:\s+(?:flat|sharp)|[#b])?\s+(?:major|minor))\b/i) || [])[1]);
  if (keyScale) { values.key = keyScale; present.push("key"); }

  const mood = fieldMatch(source, /(?:Mood and emotional direction|Mood)\s*:\s*([^\n]+)/i);
  if (mood) { values.mood = mood.replace(/\.$/, ""); present.push("mood"); }
  else {
    const productionIndex = source.search(/\b(?:Bedroom\s+)?Production\s*:/i);
    if (productionIndex > 0) {
      const prefix = source.slice(0, productionIndex);
      const sentences = prefix.split(/(?<=[.!?])\s+/).map(clean).filter(Boolean);
      if (sentences.length > 1) {
        values.mood = sentences.slice(1).join(" ").replace(/\.$/, ""); present.push("mood");
      }
    }
  }

  let production = fieldMatch(source, /(?:Production profile|Production)\s*:\s*([^\n]+)/i);
  if (!production) production = fieldMatch(source, /Bedroom production\s*:\s*([^\n]+)/i);
  if (production) { values.production = production.replace(/\.$/, ""); present.push("production"); }
  return { values, present: [...new Set(present)] };
}

function parseVocal(text) {
  const source = clean(text), values = {}, present = [];
  if (!source) return { values, present };
  const explicitInstrumental = /instrumental piece\s+with\s+no\s+lead\s+or\s+backing\s+vocals|no\s+lead\s+or\s+backing\s+vocals/i.test(source);
  if (explicitInstrumental) { values.mode = "instrumental"; present.push("mode"); }

  const lead = fieldMatch(source, /Lead vocal\s*:\s*([^\n.]+)/i);
  if (lead) {
    values.mode = "vocal"; if (!present.includes("mode")) present.push("mode");
    for (const [index, rawPart] of lead.split(";").entries()) {
      const part = clean(rawPart); if (!part) continue;
      if (/^timbre\s+/i.test(part)) { values.timbre = part.replace(/^timbre\s+/i, ""); present.push("timbre"); }
      else if (/^delivery\s+/i.test(part)) { values.delivery = part.replace(/^delivery\s+/i, ""); present.push("delivery"); }
      else if (index === 0) { values.gender = part; present.push("gender"); }
    }
  } else if (!explicitInstrumental && /\bvocal\b/i.test(source)) {
    values.mode = "vocal"; present.push("mode");
    const firstClause = clean(source.split(/[,.]/)[0]);
    if (firstClause) { values.gender = firstClause; present.push("gender"); }
    const timbre = clean((source.match(/(?:gentle\s+)?([^,.]+?)\s+timbre\b/i) || [])[1]);
    if (timbre) { values.timbre = timbre; present.push("timbre"); }
    const delivery = clean((source.match(/([^,.]+?delivery[^,.]*)/i) || [])[1]);
    if (delivery) { values.delivery = delivery; present.push("delivery"); }
  }

  const harmony = fieldMatch(source, /Harmony\/backing vocals\s*:\s*([^\n.]+)/i);
  if (harmony) { values.harmony = harmony; present.push("harmony"); }
  const effects = fieldMatch(source, /Vocal effects\s*:\s*([^\n.]+)/i);
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

function parseLooseArrangementHints(text) {
  const source = clean(text), hints = new Map();
  if (!source) return hints;
  const marker = /\b(Intro|Verses?|Pre[- ]?Chorus(?:es)?|Choruses?|Bridge|Instrumental(?:\s+sections?)?|Solo|Outro)\s*:\s*/gi;
  const matches = [...source.matchAll(marker)];
  for (let index = 0; index < matches.length; index++) {
    const type = normalizeTag(matches[index][1]);
    if (!type) continue;
    const start = (matches[index].index || 0) + matches[index][0].length;
    const end = index + 1 < matches.length ? matches[index + 1].index : source.length;
    const body = clean(source.slice(start, end)).replace(/^[.\s]+|[.\s]+$/g, "");
    if (body && !hints.has(type)) hints.set(type, body);
  }
  return hints;
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

function combineSections(arrangement, lyrics, warnings, looseHints = new Map()) {
  const sections = arrangement.map((section) => clone(section)), byType = new Map();
  for (const section of sections) { const items = byType.get(section.type) || []; items.push(section); existingPush(byType, section.type, section); }
  const seen = new Map();
  for (const block of lyrics) {
    const occurrence = seen.get(block.type) || 0; seen.set(block.type, occurrence + 1);
    const target = (byType.get(block.type) || [])[occurrence];
    if (target) {
      target.lyrics = block.lyrics; if (!target.present.includes("lyrics")) target.present.push("lyrics");
      continue;
    }
    const hint = looseHints.get(block.type) || "";
    const created = {
      ...block,
      duration: DEFAULT_DURATION[block.type] || 16,
      energy: .5,
      instruments: [],
      vocal: "",
      directives: hint,
      present: [...block.present, "duration", "energy", "instruments", "vocal", "directives"],
      duration_defaulted: true,
    };
    sections.push(created);
    existingPush(byType, block.type, created);
    warnings.push(`${created.label}: timing/energy use defaults because the Caption does not provide exact values.`);
  }
  return sections;
}

function existingPush(map, key, value) {
  const items = map.get(key) || [];
  if (!items.includes(value)) items.push(value);
  map.set(key, items);
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
  const looseHints = arrangement.length ? new Map() : parseLooseArrangementHints(blocks.arrangement || "");
  const sections = combineSections(arrangement, lyricSections, warnings, looseHints);
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