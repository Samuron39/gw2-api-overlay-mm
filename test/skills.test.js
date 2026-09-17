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

test('ukjent profesjon returnerer feil før nettverk og velger aldri Guardian', async (t) => {
  t.mock.method(globalThis, 'fetch', () => { assert.fail('ukjent profesjon skal ikke hente skills'); });
  const result = await require('../src/modules/skills').getSkillbar({ apiKey: 'FAKE_TEST_KEY' }, {}, { identity: { name: 'Test', profession: 999 } });
  assert.equal(result.ok, false); assert.ok(result.error); assert.equal(result.professionName, undefined);
});

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

test('slim: skill uten navn får tom streng, og hjelperne som ser på navnet tåler det', () => {
  const skills = require('../src/modules/skills');
  const mech = skills.slim({ id: 1, slot: 'Profession_1', type: 'Profession', professions: ['Necromancer'] });
  assert.equal(mech.name, '');
  assert.equal(mech.icon, '');
  assert.equal(skills.slim({ id: 9, name: 'Navn', professions: [] }).name, 'Navn');
  const kit = skills.slim({ id: 2, slot: 'Utility', type: 'Utility', professions: ['Engineer'], bundle_skills: [3] });
  const idx = { byId: { 1: mech, 2: kit, 3: skills.slim({ id: 3, slot: 'Weapon_1', type: 'Bundle', professions: ['Engineer'] }) } };
  // attunementIdsFor kjører regex på navnet
  assert.deepEqual(skills.attunementIdsFor(idx, 'Necromancer'), {});
  // kitsFor slår opp alias på navn: tomt navn gir ingen alias, men kitet finnes
  const kits = skills.kitsFor([2], idx);
  assert.deepEqual(Object.keys(kits), ['2']);
  assert.deepEqual(kits[2].ids, [2]);
  assert.equal(kits[2].skills[0].id, 3);
  // mechanicsFor sammenligner navn mot elite-spec-navn (toLowerCase) og leter etter "Shroud"
  const prof = { skills: [{ id: 1, slot: 'Profession_1' }], training: [{ category: 'EliteSpecializations', name: 'Reaper' }] };
  const { profession, forms } = skills.mechanicsFor({ prof, profName: 'Necromancer', specId: 0, specName: '', idx, mainType: '', offType: '', elite: null, toolbelt: null });
  assert.deepEqual(profession.map((p) => p.id), [1]);
  assert.deepEqual(forms, {});
});
