'use strict';
// Tester for src/i18n.js og språkfilene i src/i18n/: alle språk har samme nøkler som nb, ingen tomme tekster,
// og t() faller tilbake til nb og til nøkkelen selv, aldri til tom streng.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const i18n = require('../src/i18n');
test.afterEach(() => i18n.setLanguage('nb'));

const DIR = path.join(__dirname, '..', 'src', 'i18n');
const nb = JSON.parse(fs.readFileSync(path.join(DIR, 'nb.json'), 'utf8'));
const en = JSON.parse(fs.readFileSync(path.join(DIR, 'en.json'), 'utf8'));

test('språklista kommer fra filene i src/i18n/, med nb først', () => {
  const ids = i18n.languages().map((l) => l.id);
  const files = fs.readdirSync(DIR).filter((f) => f.endsWith('.json')).map((f) => f.slice(0, -5));
  assert.equal(ids[0], 'nb');
  assert.deepEqual([...ids].sort(), files.sort());
  assert.equal(i18n.languages().find((l) => l.id === 'en').name, 'English');
});

test('nb.json og en.json har nøyaktig samme nøkler', () => {
  const a = Object.keys(nb), b = Object.keys(en);
  assert.deepEqual(a.filter((k) => !(k in en)), [], 'mangler i en.json');
  assert.deepEqual(b.filter((k) => !(k in nb)), [], 'ekstra i en.json');
});

test('ingen tomme tekster, og alle plassholdere i en finnes i nb', () => {
  const holders = (s) => [...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort();
  for (const [k, v] of Object.entries(nb)) {
    assert.ok(typeof v === 'string' && v.length > 0, `nb: tom tekst for ${k}`);
    assert.ok(typeof en[k] === 'string' && en[k].length > 0, `en: tom tekst for ${k}`);
    for (const h of holders(en[k])) assert.ok(holders(v).includes(h), `en ${k} bruker {${h}} som nb ikke har`);
  }
});

test('flertallsnøkler finnes parvis (.one har alltid .other)', () => {
  const ones = Object.keys(nb).filter((k) => k.endsWith('.one'));
  assert.ok(ones.length > 0, 'minst én flertallsnøkkel');
  for (const k of ones) assert.ok(nb[k.slice(0, -4) + '.other'], k + ' mangler .other');
});

test('t() gir teksten på valgt språk og setter inn plassholdere', () => {
  i18n.setLanguage('nb');
  assert.equal(i18n.language(), 'nb');
  assert.equal(i18n.t('common.refresh'), 'Oppdater');
  assert.equal(i18n.t('common.error', { message: 'x' }), 'Feil: x');
  assert.equal(i18n.locale(), 'nb-NO');
  i18n.setLanguage('en');
  assert.equal(i18n.t('common.refresh'), 'Refresh');
  assert.equal(i18n.t('wheel.map', { id: 50 }), 'Map 50');
  assert.equal(i18n.locale(), 'en-GB');
  i18n.setLanguage('nb');
});

test('tn() velger .one for 1 og .other ellers', () => {
  i18n.setLanguage('en');
  assert.equal(i18n.tn('dps.players', 1), '1 player');
  assert.equal(i18n.tn('dps.players', 5), '5 players');
  assert.equal(i18n.tn('characters.fetched', 0), '0 characters fetched.');
  i18n.setLanguage('nb');
  assert.equal(i18n.tn('characters.fetched', 1), '1 karakter hentet.');
});

test('fallback: manglende nøkkel gir nb-teksten, og mangler den også, nøkkelen selv, aldri tom tekst', () => {
  // lookup() er ren: (nøkkel, språk, fallback-ordbok)
  assert.equal(i18n.lookup('common.refresh', 'en', nb), 'Refresh');
  assert.equal(i18n.lookup('finnes.ikke', 'en', nb), 'finnes.ikke');
  assert.equal(i18n.lookup('finnes.ikke', 'nb', nb), 'finnes.ikke');
  // ukjent språk faller helt tilbake til nb via t()
  i18n.setLanguage('xx');
  assert.equal(i18n.language(), 'nb', 'ukjent språk gir standardspråket');
  assert.equal(i18n.t('common.refresh'), 'Oppdater');
  assert.equal(i18n.t('helt.ukjent.nokkel'), 'helt.ukjent.nokkel');
  assert.notEqual(i18n.t('helt.ukjent.nokkel'), '');
  // tom tekst i ordboka regnes som manglende
  assert.equal(i18n.lookup('tom', 'en', { tom: '' }), 'tom');
  i18n.setLanguage('nb');
});

test('format(): ukjente plassholdere står urørt, null/undefined settes ikke inn', () => {
  assert.equal(i18n.format('Hei {name}, {ukjent}', { name: 'Ola' }), 'Hei Ola, {ukjent}');
  assert.equal(i18n.format('{a}-{b}', { a: 0, b: null }), '0-{b}');
  assert.equal(i18n.format('ingen', undefined), 'ingen');
});

test('bundle() gir ordboka for valgt språk lagt oppå nb, pluss språkliste', () => {
  i18n.setLanguage('en');
  const b = i18n.bundle();
  assert.equal(b.language, 'en');
  assert.equal(b.locale, 'en-GB');
  assert.equal(b.dict['common.refresh'], 'Refresh');
  assert.equal(Object.keys(b.dict).length, Object.keys(nb).length);
  assert.ok(b.languages.some((l) => l.id === 'nb') && b.languages.some((l) => l.id === 'en'));
  i18n.setLanguage('nb');
});

test('regelmotoren følger språket: samme anbefaling, oversatt etikett', () => {
  const { recommend, ACTION_LABEL } = require('../src/rules');
  const row = { item: { id: 1, name: 'Legendary Thing', rarity: 'Legendary', type: 'Weapon', flags: [] }, count: 1, binding: null, sourceType: 'character' };
  const ctx = { prices: new Map(), materialIds: new Set(), materialCounts: new Map(), keepList: [], materialCap: 250, minTp: 100 };
  i18n.setLanguage('nb');
  assert.equal(recommend(row, ctx).label, 'Behold');
  assert.equal(ACTION_LABEL.keep, 'Behold');
  i18n.setLanguage('en');
  const r = recommend(row, ctx);
  assert.equal(r.action, 'keep');
  assert.equal(r.label, 'Keep');
  assert.equal(r.reason, 'Legendary is kept');
  i18n.setLanguage('nb');
});

test('språk for ny installasjon følger systemets locale', () => {
  const avail = ['nb', 'en'];
  assert.equal(i18n.languageForLocale('nb-NO', avail), 'nb');
  assert.equal(i18n.languageForLocale('nn', avail), 'nb');
  assert.equal(i18n.languageForLocale('no', avail), 'nb');
  assert.equal(i18n.languageForLocale('en-US', avail), 'en');
  assert.equal(i18n.languageForLocale('de-DE', avail), 'en');
  assert.equal(i18n.languageForLocale('', avail), 'en');
  assert.equal(i18n.languageForLocale(undefined, avail), 'en');
  assert.equal(i18n.languageForLocale('de', ['nb', 'en', 'de']), 'de');
  assert.equal(i18n.languageForLocale('fr', ['nb']), 'nb');
  assert.equal(i18n.languageForLocale('sv-SE'), 'en'); // ekte filer i src/i18n
});
