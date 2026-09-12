'use strict';
// Tester for src/modules/skills.js: modulen må kunne lastes uten Electron, og normalizeRotation() må tåle gamle lagringer.
const test = require('node:test');
const assert = require('node:assert/strict');

test('modulen lastes uten electron (cacheFile fanger feilen selv)', () => {
  // I ren Node gir npm-pakken electron bare stien til programfila, ikke app-objektet; uten pakken kaster require.
  let el = null;
  try { el = require('electron'); } catch { /* ikke installert */ }
  assert.ok(!el || !el.app, 'utenfor Electron finnes ikke app-objektet');
  const skills = require('../src/modules/skills');
  for (const fn of ['getSkillbar', 'suggestRotation', 'fetchIndex', 'normalizeRotation']) assert.equal(typeof skills[fn], 'function', fn);
});

const { normalizeRotation } = require('../src/modules/skills');

test('normalizeRotation: tomt gir tomme lister', () => {
  assert.deepEqual(normalizeRotation(null), { steps: [], upkeep: [] });
  assert.deepEqual(normalizeRotation(undefined), { steps: [], upkeep: [] });
  assert.deepEqual(normalizeRotation(''), { steps: [], upkeep: [] });
  assert.deepEqual(normalizeRotation({}), { steps: [], upkeep: [] });
});

test('normalizeRotation: gammel lagring som ren liste blir steps uten upkeep', () => {
  const gammel = [{ skill: 1, note: 'åpning' }, { skill: 2, note: '' }];
  const r = normalizeRotation(gammel);
  assert.deepEqual(r, { steps: gammel, upkeep: [] });
  assert.equal(r.steps, gammel, 'lista beholdes som den er');
  assert.deepEqual(normalizeRotation([]), { steps: [], upkeep: [] });
});

test('normalizeRotation: ny form beholder steps og upkeep, og fyller inn det som mangler', () => {
  const steps = [{ skill: 10, note: 'a' }];
  const upkeep = [{ skill: 11, boon: 'Might' }];
  assert.deepEqual(normalizeRotation({ steps, upkeep }), { steps, upkeep });
  assert.deepEqual(normalizeRotation({ steps }), { steps, upkeep: [] });
  assert.deepEqual(normalizeRotation({ upkeep }), { steps: [], upkeep });
  // ukjente felt tas ikke med
  const r = normalizeRotation({ steps, upkeep, annet: 1 });
  assert.deepEqual(Object.keys(r).sort(), ['steps', 'upkeep']);
});
