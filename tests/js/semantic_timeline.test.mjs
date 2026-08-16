import test from 'node:test';
import assert from 'node:assert/strict';
import {
  collectInstrumentRows,
  fitTimelineScale,
  resizeSectionDurations,
  sectionHasInstrument,
  sectionPalette,
  sectionTimelineGeometry,
  timelineScaleFactor,
  toggleSectionInstrument,
} from '../../web/semantic_timeline.js';
import { normalizeProject, factoryProject } from '../../web/semantic_studio_core.js';

test('timeline geometry accumulates section durations with 0.1 second semantic snap', () => {
  const sections = [{ duration: 8.04 }, { duration: 24.06 }, { duration: 16 }];
  const geometry = sectionTimelineGeometry(sections);
  assert.deepEqual(geometry.map((item) => [item.start, item.end]), [[0, 8], [8, 32.1], [32.1, 48.1]]);
  assert.equal(geometry[1].duration, 24.1);
});

test('shift-style resize preserves adjacent total duration', () => {
  const sections = [{ duration: 20 }, { duration: 10 }, { duration: 8 }];
  const result = resizeSectionDurations(sections, 0, 24, true);
  assert.equal(result.current, 24);
  assert.equal(result.next, 6);
  assert.equal(sections[0].duration + sections[1].duration, 30);
});

test('preserve-total resize respects minimum next duration', () => {
  const sections = [{ duration: 20 }, { duration: 1 }];
  const result = resizeSectionDurations(sections, 0, 30, true);
  assert.equal(result.next, 0.5);
  assert.equal(result.current, 20.5);
});

test('fit scale maps to the minimum relative zoom', () => {
  assert.equal(fitTimelineScale(2000, 100), 3);
  assert.equal(fitTimelineScale(300, 200), 3);
});

test('timeline scale changes continuously from fit to 4x zoom', () => {
  assert.equal(timelineScaleFactor(3), 1);
  assert.equal(timelineScaleFactor(20), 4);
  assert.ok(timelineScaleFactor(7) > 1);
  assert.ok(timelineScaleFactor(12) > timelineScaleFactor(7));
});

test('instrument rows preserve first appearance and toggle section membership', () => {
  const sections = [
    { instruments: ['Piano', 'Rhodes piano'] },
    { instruments: ['piano', 'Bass'] },
    { instruments: [] },
  ];
  assert.deepEqual(collectInstrumentRows(sections), ['Piano', 'Rhodes piano', 'Bass']);
  assert.equal(sectionHasInstrument(sections[2], 'Piano'), false);
  assert.equal(toggleSectionInstrument(sections[2], 'Piano'), true);
  assert.equal(sectionHasInstrument(sections[2], 'piano'), true);
  assert.equal(toggleSectionInstrument(sections[2], 'PIANO'), false);
  assert.equal(sectionHasInstrument(sections[2], 'Piano'), false);
});

test('section palettes are deterministic by section type', () => {
  assert.equal(sectionPalette('Verse').accent, sectionPalette('Verse').accent);
  assert.notEqual(sectionPalette('Verse').accent, sectionPalette('Chorus').accent);
  assert.ok(sectionPalette('Instrumental').fill.startsWith('#'));
});

test('project normalization removes long semantic duration decimals', () => {
  const project = factoryProject();
  project.timeline.sections[0].duration = 5.269262351114554;
  const normalized = normalizeProject(project);
  assert.equal(normalized.timeline.sections[0].duration, 5.3);
});
