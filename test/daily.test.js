'use strict';
// Tester for src/modules/daily.js: navn → API-id for world bosses, og daglig/ukentlig reset.
const test = require('node:test');
const assert = require('node:assert/strict');
const { bossIdFromName, resets } = require('../src/modules/daily');

const DAG = 864e5;

test('bossIdFromName: alias for navn som ikke følger mønsteret', () => {
  assert.equal(bossIdFromName('Golem Mark II'), 'inquest_golem_mark_ii');
  assert.equal(bossIdFromName('Triple Trouble'), 'triple_trouble_wurm');
  assert.equal(bossIdFromName('Evolved Jungle Wurm'), 'triple_trouble_wurm');
});

test('bossIdFromName: vanlige navn blir små bokstaver med understrek', () => {
  assert.equal(bossIdFromName('The Shatterer'), 'the_shatterer');
  assert.equal(bossIdFromName('Claw of Jormag'), 'claw_of_jormag');
  assert.equal(bossIdFromName('Fire Elemental'), 'fire_elemental');
  assert.equal(bossIdFromName('Admiral Taidha Covington'), 'admiral_taidha_covington');
  assert.equal(bossIdFromName('Svanir Shaman Chief'), 'svanir_shaman_chief');
});

test('bossIdFromName: tåler mellomrom, store bokstaver, tegnsetting og tomt', () => {
  assert.equal(bossIdFromName('  golem mark ii '), 'inquest_golem_mark_ii');
  assert.equal(bossIdFromName("Modniir Ulgoth's Camp!"), 'modniir_ulgoth_s_camp');
  assert.equal(bossIdFromName('THE   SHATTERER'), 'the_shatterer');
  assert.equal(bossIdFromName(''), '');
  assert.equal(bossIdFromName(null), '');
});

test('resets: daglig reset er neste midnatt UTC, innen 24 timer', () => {
  const now = Date.now();
  const { daily } = resets();
  assert.ok(daily > now, 'i framtida');
  assert.ok(daily - now <= DAG, 'innen 24 t');
  assert.equal(daily % DAG, 0, 'på hel UTC-dag');
});

test('resets: ukentlig reset er mandag 07:30 UTC, innen 7 dager', () => {
  const now = Date.now();
  const { weekly } = resets();
  assert.ok(weekly > now, 'i framtida');
  assert.ok(weekly - now <= 7 * DAG, 'innen 7 dager');
  const d = new Date(weekly);
  assert.equal(d.getUTCDay(), 1, 'mandag');
  assert.equal(d.getUTCHours(), 7);
  assert.equal(d.getUTCMinutes(), 30);
  assert.equal(d.getUTCSeconds(), 0);
});

test('resets med frosset klokke: mandag 07:29 gir samme dag, 07:30 og senere gir neste mandag', (t) => {
  const mandag = Date.UTC(2026, 8, 14); // 14. september 2026 er en mandag
  t.mock.timers.enable({ apis: ['Date'], now: mandag + 7 * 36e5 + 29 * 6e4 });
  let r = resets();
  assert.equal(r.weekly, mandag + 7 * 36e5 + 30 * 6e4);
  assert.equal(r.daily, mandag + DAG);

  t.mock.timers.setTime(mandag + 7 * 36e5 + 30 * 6e4);
  r = resets();
  assert.equal(r.weekly, mandag + 7 * DAG + 7 * 36e5 + 30 * 6e4, 'nøyaktig 07:30 er allerede reset, neste uke');

  t.mock.timers.setTime(mandag + 3 * DAG + 12 * 36e5); // torsdag 12:00
  r = resets();
  assert.equal(r.weekly, mandag + 7 * DAG + 7 * 36e5 + 30 * 6e4);
  assert.equal(r.daily, mandag + 4 * DAG);

  // søndag 23:59 → daglig om ett minutt, ukentlig mandag 07:30
  t.mock.timers.setTime(mandag + 7 * DAG - 6e4);
  r = resets();
  assert.equal(r.daily, mandag + 7 * DAG);
  assert.equal(r.weekly, mandag + 7 * DAG + 7 * 36e5 + 30 * 6e4);
});
