// Presets are authoring aids only. Every editable control also accepts custom text.
// Genre, vocal-style, instrument and BPM references are derived from MiniMax's
// public music prompt-writing guide; mood/section-vocal suggestions are curated
// conveniences and are not model-side enums.

export const GENRE_GROUPS = {
  "Pop & Dance": ["Pop", "Dance Pop", "Electropop", "Synth-pop", "Dream Pop", "K-pop", "J-pop", "C-pop", "City Pop", "House", "Future Bass", "EDM"],
  "Rock & Alt": ["Rock", "Indie Rock", "Pop Rock", "Post-Rock", "Shoegaze", "Punk", "Metal", "Alternative"],
  "R&B / Soul / Funk": ["R&B", "Neo-Soul", "Contemporary R&B", "Funk", "Gospel", "Soul"],
  "Hip-Hop": ["Hip-Hop", "Trap", "Boom Bap", "Lo-fi Hip-Hop", "Cloud Rap", "Drill", "Afrobeats"],
  "Electronic": ["Ambient", "Techno", "Drum and Bass", "Chillwave", "Vaporwave", "Amapiano"],
  "Folk / Acoustic": ["Folk", "Indie Folk", "Country", "Chinese Traditional", "Celtic Folk"],
  "Jazz / Blues": ["Jazz", "Smooth Jazz", "Jazz Fusion", "Bossa Nova", "Blues", "Avant-Garde Jazz"],
  "Classical / Score": ["Classical", "Orchestral", "Cinematic", "Film Score", "Epic", "Neoclassical", "Piano Solo"],
  "World": ["Reggae", "Latin", "Waltz", "Tango", "Flamenco"],
};

export const GENRE_PRESETS = [...new Set(Object.values(GENRE_GROUPS).flat())];
export const INFLUENCE_PRESETS = GENRE_PRESETS;

export const MOOD_PRESETS = [
  "melancholic", "defiant", "warm", "uplifting", "smoky", "laid-back", "bittersweet", "healing",
  "empowering", "self-loving", "meditative", "energetic", "romantic", "dreamy", "intimate",
  "late-night", "sunny", "contented", "dark", "hopeful", "nostalgic",
];

export const VOCAL_LEAD_PRESETS = [
  "female vocal", "male vocal", "androgynous vocal", "duet with harmonies", "group / choir",
  "warm male baritone", "bright female soprano", "ultra-low gravelly baritone",
];

export const VOCAL_TIMBRE_PRESETS = [
  "smooth and emotional", "raw and unpolished", "breathy and intimate", "powerful and soulful",
  "sultry and sophisticated", "ethereal and crystal-clear", "aggressive and intense",
  "warm baritone", "bright soprano", "gravelly baritone",
];

export const VOCAL_DELIVERY_PRESETS = [
  "intimate phrasing", "breathy delivery", "rhythmic intensity", "smooth jazz inflections",
  "gospel inflections", "ad-libs and melodic scats", "shifting between whispers and screams",
  "half-sung half-spoken", "laid-back behind-the-beat phrasing",
];

export const SECTION_VOCAL_PRESETS = [
  "instrumental", "soft", "intimate", "breathy", "restrained", "power", "full lead",
  "murmured doubles", "backing harmonies", "wordless hums", "fade",
];

export const INSTRUMENT_GROUPS = {
  "Strings & Guitar": ["acoustic guitar fingerpicking", "electric guitar riffs", "fretless bass", "violin", "cello", "erhu", "guzheng", "pipa"],
  "Keys & Synth": ["piano", "Rhodes piano", "synth pad", "synth lead", "arpeggiator", "music box", "organ"],
  "Drums & Percussion": ["brushed jazz drums", "electronic drums", "808 hi-hats", "trap percussion", "cajon", "bongos"],
  "Wind & Brass": ["saxophone", "trumpet", "flute", "harmonica", "bamboo flute", "xiao"],
  "Texture & Effects": ["vinyl crackle", "tape hiss", "ambient pads", "glitch elements", "rain sounds"],
};

export const INSTRUMENT_PRESETS = [...new Set(Object.values(INSTRUMENT_GROUPS).flat())];

export const PRODUCTION_SUGGESTIONS = [
  "mellow beats with lo-fi elements",
  "warm fretless bassline",
  "shimmering Rhodes piano",
  "brushed jazz drums",
  "vinyl crackle",
  "tape hiss",
  "ambient pads",
  "glitch elements",
  "rain sounds",
  "lush reverb",
  "tape delay",
];

export const BPM_PRESETS = [
  { label: "Very slow / meditative · 50 BPM", value: 50 },
  { label: "Slow ballad · 70 BPM", value: 70 },
  { label: "Mid-tempo groove · 95 BPM", value: 95 },
  { label: "Upbeat / energetic · 120 BPM", value: 120 },
  { label: "Fast / driving · 140 BPM", value: 140 },
];

// Keep enharmonic spellings separate so an imported/user-selected tonal center is
// not silently rewritten. These are authoring presets only; custom wording remains valid.
export const KEY_PRESETS = [
  "",
  "C", "C sharp", "D flat",
  "D", "D sharp", "E flat",
  "E", "F", "F sharp", "G flat",
  "G", "G sharp", "A flat",
  "A", "A sharp", "B flat",
  "B",
  "C# / Db", "D# / Eb", "F# / Gb", "G# / Ab", "A# / Bb",
];
export const SCALE_PRESETS = ["", "major", "minor", "harmonic minor", "melodic minor", "dorian", "mixolydian", "pentatonic"];
