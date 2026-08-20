import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzePromptImport } from '../../web/prompt_import_core.js';

const caption = `Global Metadata: Lo-fi hip-hop, chillhop. 78 BPM, D flat major, major scale with jazzy extensions.

Vocal Details: Soft androgynous vocal, hushed half-sung half-spoken delivery.

Arrangement: Dusty boom-bap drums with a soft thumping kick, cracked snare with lazy swing, brushed hi-hats, low round sub bass. Warm Rhodes piano chords with slow chorus wobble as the harmonic bed, mellow jazzy guitar licks answering the vocal lines, constant vinyl crackle as texture. Intro: rain and vinyl noise, solo Rhodes chords fading in, drums slipping in halfway. Verses: minimal — drums, bass, Rhodes, soft guitar fills between lines. Instrumental sections: guitar and Rhodes trade relaxed jazzy phrases over the beat, occasional muted trumpet ghost notes far in the background. Bridge: drums drop away to rain, crackle, and floating detuned Rhodes, then the beat eases back in. Outro: elements fade one by one until only vinyl crackle and a last unresolved Rhodes chord remain.`;

const lyrics = `[Intro]\nMmm...\n[Verse]\nA\n[Chorus]\nB\n[Instrumental]\n\n[Bridge]\nC\n[Outro]\nD`;

test('official loose Arrangement prose imports section instruments', () => {
  const analysis = analyzePromptImport({ caption, lyrics });
  const byType = Object.fromEntries(analysis.sections.map((section) => [section.type, section]));

  assert.ok(byType.Intro.instruments.some((item) => /Rhodes/i.test(item)));
  assert.ok(byType.Intro.instruments.some((item) => /drums/i.test(item)));
  assert.ok(byType.Verse.instruments.some((item) => /bass/i.test(item)));
  assert.ok(byType.Verse.instruments.some((item) => /guitar/i.test(item)));
  assert.ok(byType.Instrumental.instruments.some((item) => /trumpet/i.test(item)));
  assert.ok(byType.Bridge.instruments.some((item) => /Rhodes/i.test(item)));
  assert.ok(byType.Outro.instruments.some((item) => /vinyl/i.test(item)));
});

test('sections without a loose per-section hint inherit instruments from Arrangement preamble', () => {
  const analysis = analyzePromptImport({ caption, lyrics });
  const chorus = analysis.sections.find((section) => section.type === 'Chorus');
  assert.ok(chorus);
  assert.ok(chorus.instruments.some((item) => /drums/i.test(item)));
  assert.ok(chorus.instruments.some((item) => /bass/i.test(item)));
  assert.ok(chorus.instruments.some((item) => /Rhodes/i.test(item)));
  assert.ok(chorus.instruments.some((item) => /guitar/i.test(item)));
});

test('strict Use syntax remains authoritative and unchanged', () => {
  const strictCaption = `### Arrangement\nVerse 1 (0:00–0:10 target, 40%): Use piano, strings. Keep it restrained.`;
  const analysis = analyzePromptImport({ caption: strictCaption, lyrics: '[Verse]\nhello' });
  assert.deepEqual(analysis.sections[0].instruments, ['piano', 'strings']);
});
