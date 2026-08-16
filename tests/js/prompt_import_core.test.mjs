import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePromptImport, applyPromptImport } from '../../web/prompt_import_core.js';
import { compilePreview, factoryProject, normalizeProject, splitKeyScale } from '../../web/semantic_studio_core.js';

const caption = `### Global Metadata
Genre: Lo-fi hip-hop with chillhop influences.
Tempo target: approximately 78 BPM in 4/4 meter.
Mood and emotional direction: dreamy late-night.
Production profile: warm tape and vinyl.

### Vocal Details
Lead vocal: androgynous; timbre soft and breathy; delivery half-spoken.
Harmony/backing vocals: sparse murmured doubles.
Vocal effects: tape delay.

### Arrangement
Intro (0:00–0:03 target, low-density and restrained): Use rain texture, vinyl crackle, Rhodes piano. Vocal treatment: hushed hums. Fade the Rhodes in gently.
Verse 1 (0:03–0:16 target, 38%): Use dusty drums, bass, Rhodes piano. Vocal treatment: soft. Keep space for the lead vocal.
Chorus 1 (0:16–0:23 target, full and energetic): Use full drums, bass, guitar. Vocal treatment: power. Open the stereo image.`;

const lyrics = `[Intro]
Mmm...
[Verse]
Midnight and the canvas glows
[Chorus]
Let it render on`;

test('analyzes structured caption and tagged lyrics', () => {
  const analysis = analyzePromptImport({ caption, lyrics });
  assert.equal(analysis.format, 'structured');
  assert.equal(analysis.global.values.genre, 'Lo-fi hip-hop');
  assert.equal(analysis.global.values.bpm, 78);
  assert.equal(analysis.vocal.values.timbre, 'soft and breathy');
  assert.equal(analysis.sections.length, 3);
  assert.equal(analysis.sections[1].duration, 13);
  assert.equal(analysis.sections[1].energy, 0.38);
  assert.equal(analysis.sections[2].lyrics, 'Let it render on');
});

test('merge updates matching type occurrences and preserves reserved data', () => {
  const project = factoryProject();
  project.project_id = 'keep-me';
  project.audio_edits = [{ future: true }];
  const out = applyPromptImport(project, analyzePromptImport({ caption, lyrics }), 'merge');
  assert.equal(out.project_id, 'keep-me');
  assert.deepEqual(out.audio_edits, [{ future: true }]);
  assert.equal(out.timeline.sections[0].duration, 3);
  assert.equal(out.timeline.sections[1].lyrics, 'Midnight and the canvas glows');
  assert.equal(out.global.bpm, 78);
});

test('replace uses imported section order', () => {
  const out = applyPromptImport(factoryProject(), analyzePromptImport({ caption, lyrics }), 'replace');
  assert.deepEqual(out.timeline.sections.map((item) => item.type), ['Intro', 'Verse', 'Chorus']);
  assert.equal(out.timeline.sections[2].duration, 7);
});

test('lyrics only creates repeated numbered sections', () => {
  const analysis = analyzePromptImport({ lyrics: '[Verse]\nA\n[Chorus]\nB\n[Verse]\nC' });
  assert.deepEqual(analysis.sections.map((item) => item.label), ['Verse 1', 'Chorus 1', 'Verse 2']);
  const out = applyPromptImport(factoryProject(), analysis, 'replace');
  assert.equal(out.timeline.sections[2].lyrics, 'C');
});

test('compound imported key scale is normalized into editable fields', () => {
  const keyCaption = `### Global Metadata\nKey/scale target: D flat major.`;
  const out = applyPromptImport(factoryProject(), analyzePromptImport({ caption: keyCaption }), 'merge');
  assert.equal(out.global.key, 'D flat');
  assert.equal(out.global.scale, 'major');

  assert.deepEqual(splitKeyScale('F# harmonic minor'), { key: 'F#', scale: 'harmonic minor' });
  assert.deepEqual(splitKeyScale('C# / Db major'), { key: 'C# / Db', scale: 'major' });
  assert.deepEqual(splitKeyScale('atonal / no fixed key'), { key: 'atonal / no fixed key', scale: '' });
});

test('prompt-imported values remain ordinary project state and can be overridden manually', () => {
  const imported = applyPromptImport(factoryProject(), analyzePromptImport({ caption, lyrics }), 'merge');
  imported.global.genre = 'Jazz Fusion';
  imported.global.key = 'B flat';
  imported.global.scale = 'minor';
  imported.global.vocal.gender = 'bright female soprano';
  const project = normalizeProject(imported);
  const preview = compilePreview(project).caption;

  assert.match(preview, /Genre: Jazz Fusion/);
  assert.match(preview, /Key\/scale target: B flat minor/);
  assert.match(preview, /Lead vocal: bright female soprano/);
  assert.doesNotMatch(preview, /Genre: Lo-fi hip-hop/);
});
