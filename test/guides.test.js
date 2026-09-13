'use strict';
// Tester for Guider: data/guides.json (unike id-er, wiki-sider, map-id-er), chat-linjer (klipping til 190 tegn, ingen
// linjeskift) og cache-logikken i src/modules/guides.js med falsk AI og falsk fetch (ingen nettkall).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const guides = require('../src/modules/guides');

const GROUPS = ['worldbosses', 'fractals', 'raids', 'strikes', 'dungeons'];
const WP_CODE = /^\[&[A-Za-z0-9+/=]+\]$/;

test('data/guides.json: fem grupper, unike id-er, wiki-side og navn på alle, map-id er tall eller null', () => {
  const d = guides.list();
  assert.equal(d.license, 'CC BY-SA 3.0');
  assert.deepEqual(Object.keys(d.groups).sort(), [...GROUPS].sort());
  const ids = new Set();
  for (const g of GROUPS) {
    assert.ok(d.groups[g].length >= 8, `${g} har for få oppføringer (${d.groups[g].length})`);
    for (const e of d.groups[g]) {
      assert.match(e.id, /^[a-z0-9-]+$/, `${g}: id ${e.id}`);
      assert.ok(!ids.has(e.id), `duplikat id ${e.id}`); ids.add(e.id);
      assert.ok(e.name && typeof e.name === 'string', `${e.id} mangler navn`);
      assert.ok(e.page && typeof e.page === 'string' && !e.page.includes('#'), `${e.id} mangler wiki-side`);
      assert.ok(e.map === null || (Number.isInteger(e.map) && e.map > 0), `${e.id}: map ${e.map}`);
      if (e.maps) { assert.ok(Array.isArray(e.maps) && e.maps.every((m) => Number.isInteger(m))); assert.equal(e.maps[0], e.map); }
      if (g === 'dungeons') assert.ok(Array.isArray(e.paths) && e.paths.length >= 4 && e.paths[0] === 'Story', `${e.id} mangler stier`);
      else if (g !== 'worldbosses') assert.ok(Array.isArray(e.bosses) && e.bosses.length >= 1, `${e.id} mangler bosser`);
    }
  }
  assert.ok(ids.size >= 100);
  assert.equal(d.groups.dungeons.length, 8);
  assert.equal(d.groups.dungeons.find((e) => e.id === 'dungeon-the-ruined-city-of-arah').paths.length, 5);
  // kjente oppføringer
  const wb = d.groups.worldbosses;
  assert.equal(wb.find((e) => e.id === 'wb-tequatl-the-sunless').page, 'Tequatl the Sunless');
  assert.equal(wb.find((e) => e.id === 'wb-tequatl-the-sunless').map, 53);
  assert.equal(wb.find((e) => e.id === 'wb-golem-mark-ii').page, 'Inquest Golem Mark II');
  assert.equal(d.groups.fractals.find((e) => e.id === 'fractal-nightmare').map, 1177);
  assert.equal(d.groups.raids.find((e) => e.id === 'raid-spirit-vale').bosses[0], 'Vale Guardian');
  assert.equal(d.groups.strikes.find((e) => e.id === 'strike-shiverpeaks-pass').maps.length, 2);
});

test('verdensbossene peker på tidsplanen: event-nøkkel finnes i event-timer-wiki.json og navnet er segment eller meta', () => {
  const wiki = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'event-timer-wiki.json'), 'utf8'));
  for (const e of guides.list().groups.worldbosses) {
    const ev = wiki.events[e.event];
    assert.ok(ev, `${e.id}: ukjent event ${e.event}`);
    const names = new Set([ev.name, ...Object.values(ev.segments || {}).map((s) => s.name)]);
    assert.ok(names.has(e.name), `${e.id}: ${e.name} finnes ikke i ${e.event}`);
    for (const a of e.aliases || []) assert.ok(names.has(a), `${e.id}: alias ${a}`);
  }
});

// Metaer i tidsplanen uten waypoint-chatlink og uten verifiserbart waypoint på wikiens områdeside; alle andre skal ha waypoint
const NO_WAYPOINT = ['wb-buried-treasure', 'wb-pof-er', 'wb-serpents-ire', 'wb-forged-with-fire', 'wb-escorts', 'wb-death-branded-shatterer'];

test('alle oppføringer har location; waypoint { name, code } med chat-kode på alle unntatt de kjente metaene', () => {
  const d = guides.list();
  const missing = [];
  for (const g of GROUPS) {
    for (const e of d.groups[g]) {
      assert.ok(typeof e.location === 'string' && e.location.length > 0, `${e.id} mangler location`);
      if (!e.waypoint) { missing.push(e.id); continue; }
      assert.match(e.waypoint.name, /Waypoint$/, `${e.id}: waypoint-navn ${e.waypoint.name}`);
      assert.match(e.waypoint.code, WP_CODE, `${e.id}: waypoint-kode ${e.waypoint.code}`);
      // koden er et waypoint (type 4) på 5 byte
      const b = Buffer.from(e.waypoint.code.slice(2, -1), 'base64');
      assert.equal(b.length, 5, `${e.id}: kodelengde`); assert.equal(b[0], 4, `${e.id}: ikke waypoint-type`);
    }
  }
  assert.deepEqual(missing.sort(), [...NO_WAYPOINT].sort(), 'oppføringer uten waypoint');
  assert.deepEqual(d.groups.fractals.find((e) => e.id === 'fractal-nightmare').waypoint, { name: 'Fort Marriner Waypoint', code: '[&BDAEAAA=]' });
  assert.deepEqual(d.groups.raids.find((e) => e.id === 'raid-spirit-vale').waypoint, { name: 'Aerodrome Waypoint', code: '[&BCAJAAA=]' });
  assert.deepEqual(d.groups.dungeons.find((e) => e.id === 'dungeon-ascalonian-catacombs').waypoint, { name: 'Ascalonian Catacombs Waypoint', code: '[&BIYBAAA=]' });
  assert.equal(d.groups.strikes.find((e) => e.id === 'strike-boneskinner').waypoint.name, 'Eye of the North Waypoint');
  assert.equal(d.groups.worldbosses.find((e) => e.id === 'wb-tequatl-the-sunless').waypoint.code, '[&BNABAAA=]');
});

test('pasteLine: «Navn · [&B...=]» på én linje under 190 tegn for alle oppføringer, klipper lange navn', () => {
  const d = guides.list();
  for (const g of GROUPS) {
    for (const e of d.groups[g]) {
      const line = guides.pasteLine(e);
      assert.ok(line.length > 0 && line.length <= 190 && !/[\r\n]/.test(line), `${e.id}: ${line}`);
      if (e.waypoint) assert.ok(line.endsWith(' · ' + e.waypoint.code), `${e.id}: ${line}`);
      else assert.equal(line, e.name);
    }
  }
  assert.equal(guides.pasteLine(d.groups.dungeons[0]), 'Ascalonian Catacombs · [&BIYBAAA=]');
  const lang = guides.pasteLine({ name: 'x'.repeat(300), waypoint: { name: 'W', code: '[&BIYBAAA=]' } });
  assert.equal(lang.length, 190); assert.ok(lang.endsWith('… · [&BIYBAAA=]'));
  assert.equal(guides.pasteLine(null), '');
});

test('wikiUrl: mellomrom blir understrek, apostrof og kolon beholdes lesbare', () => {
  assert.equal(guides.wikiUrl('Tequatl the Sunless'), 'https://wiki.guildwars2.com/wiki/Tequatl_the_Sunless');
  assert.equal(guides.wikiUrl("Old Lion's Court"), "https://wiki.guildwars2.com/wiki/Old_Lion's_Court");
  assert.equal(guides.wikiUrl('White Mantle Control: Saidra\'s Haven'), "https://wiki.guildwars2.com/wiki/White_Mantle_Control:_Saidra's_Haven");
});

test('chatLines: fjerner linjeskift og dobbelmellomrom, klipper til 190 tegn på ordgrense, maks 4 linjer, tomme bort', () => {
  const lang = 'a'.repeat(120) + ' ' + 'b'.repeat(120);
  const out = guides.chatLines(['  Fase 1:\n  gå til\tgrønn  ', '', null, lang, 'x', 'y', 'z']);
  assert.equal(out.length, guides.CHAT_LINES_MAX);
  assert.equal(out[0], 'Fase 1: gå til grønn');
  assert.ok(out[1].length <= guides.CHAT_MAX, `for lang: ${out[1].length}`);
  assert.ok(out[1].startsWith('a'.repeat(120)) && out[1].endsWith('…'), 'klippet på ordgrense med ellipse');
  for (const l of out) { assert.ok(!/[\r\n\t]/.test(l)); assert.ok(l.length <= 190); }
  assert.deepEqual(guides.chatLines('en\nto\n\ntre'), ['en', 'to', 'tre'], 'streng deles på linjeskift');
  assert.deepEqual(guides.chatLines(null), []);
  assert.deepEqual(guides.chatLines({}), []);
  // ett ord uten mellomrom klippes hardt
  assert.equal(guides.chatLines(['c'.repeat(300)])[0].length, guides.CHAT_MAX);
});

test('normalizeGuide: tåler manglende og feil typer, begrenser antall linjer', () => {
  assert.deepEqual(guides.normalizeGuide(null), { summary: [], chat: [], tips: [] });
  const g = guides.normalizeGuide({ summary: Array.from({ length: 12 }, (_, i) => ' linje ' + i), chat: 'a\nb', tips: 7 });
  assert.equal(g.summary.length, 8);
  assert.equal(g.summary[0], 'linje 0');
  assert.deepEqual(g.chat, ['a', 'b']);
  assert.deepEqual(g.tips, []);
});

test('stripWikitext: maler, lenker, filer og HTML fjernes, lenketekst beholdes', () => {
  const s = guides.stripWikitext("{{Boss infobox|name=X}}\n'''Tequatl''' is a [[World boss|world boss]] in [[Sparkfly Fen]].<ref>x</ref> [[File:A.jpg|thumb]]\n* Use [[Hylek Turret|turrets]].");
  assert.ok(!s.includes('{{') && !s.includes('[[') && !s.includes('<ref'));
  assert.match(s, /Tequatl is a world boss in Sparkfly Fen/);
  assert.match(s, /- Use turrets/);
});

// ---------- get(): cache og feilhåndtering med falsk AI og falsk fetch ----------
function fakeEnv({ extract = 'Tequatl the Sunless is a world boss. == Walkthrough == Phase 1: kill the fingers. Phase 2: defend the turrets. '.repeat(6), aiText, aiError, fetchError, describe } = {}) {
  const calls = { fetch: 0, ai: 0, urls: [], messages: null, opts: null };
  guides._deps.fetch = async (url) => {
    calls.fetch++; calls.urls.push(String(url));
    if (fetchError) throw new Error(fetchError);
    const u = new URL(url);
    if (u.searchParams.get('prop') === 'extracts') return { ok: true, json: async () => ({ query: { pages: { 1: { pageid: 1, title: u.searchParams.get('titles'), extract } } } }) };
    return { ok: true, json: async () => ({ parse: { wikitext: { '*': "'''Fallback''' text " + 'x '.repeat(200) } } }) };
  };
  guides._deps.ai = {
    answerLanguage: () => 'norsk',
    describe: () => describe || { provider: 'local', name: 'LM Studio', model: 'qwen', needsKey: false, hasKey: false },
    completeText: async (_cfg, messages, opts) => {
      calls.ai++; calls.messages = messages; calls.opts = opts;
      if (aiError) throw new Error(aiError);
      return aiText ?? JSON.stringify({ summary: ['Fase 1: fingre', 'Fase 2: kanoner'], chat: ['Fase 1: drep fingrene', 'Fase 2: forsvar kanonene\nikke la dem dø'], tips: ['CC på defiance bar'] });
    },
  };
  return calls;
}

test('get: første kall henter wiki + AI og skriver cache; andre kall leser cache uten nye kall', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-guides-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  guides.init(dir);
  const calls = fakeEnv();
  const r = await guides.get({}, 'wb-tequatl-the-sunless');
  assert.equal(r.title, 'Tequatl the Sunless');
  assert.equal(r.url, 'https://wiki.guildwars2.com/wiki/Tequatl_the_Sunless');
  assert.equal(r.cached, false);
  assert.equal(r.language, 'norsk');
  assert.equal(r.model, 'qwen');
  assert.equal(r.map, 53);
  assert.equal(r.location, 'Sparkfly Fen');
  assert.equal(r.pasteLine, 'Tequatl the Sunless · [&BNABAAA=]');
  assert.deepEqual(r.summary, ['Fase 1: fingre', 'Fase 2: kanoner']);
  assert.deepEqual(r.chat, ['Fase 1: drep fingrene', 'Fase 2: forsvar kanonene ikke la dem dø'], 'linjeskift i chat fjernes');
  assert.equal(calls.fetch, 1, 'extracts var nok, ingen wikitext-reserve');
  assert.match(calls.urls[0], /^https:\/\/wiki\.guildwars2\.com\/api\.php\?/);
  assert.equal(calls.ai, 1);
  assert.equal(calls.opts.jsonSchema.name, 'bossguide');
  assert.match(calls.messages[1].content, /Tequatl the Sunless/);
  assert.match(calls.messages[1].content, /Phase 1: kill the fingers/, 'wikiteksten er med i prompten');
  assert.match(calls.messages[0].content, /norsk/);
  const file = path.join(dir, 'guides', 'wb-tequatl-the-sunless.json');
  assert.ok(fs.existsSync(file), 'cache-fil skrevet');
  const saved = JSON.parse(fs.readFileSync(file, 'utf8'));
  assert.deepEqual(Object.keys(saved).sort(), ['chat', 'fetchedAt', 'language', 'model', 'page', 'summary', 'tips', 'title']);

  const r2 = await guides.get({}, 'wb-tequatl-the-sunless');
  assert.equal(r2.cached, true);
  assert.equal(calls.fetch, 1); assert.equal(calls.ai, 1);

  // annet språk: nytt kall
  guides._deps.ai.answerLanguage = () => 'English';
  const r3 = await guides.get({}, 'wb-tequatl-the-sunless');
  assert.equal(r3.cached, false); assert.equal(r3.language, 'English'); assert.equal(calls.ai, 2);

  // refresh: nytt kall selv om språket stemmer
  const r4 = await guides.get({}, 'wb-tequatl-the-sunless', { refresh: true });
  assert.equal(r4.cached, false); assert.equal(calls.ai, 3);
});

test('get: uten nøkkel hos skyleverandør gis NOAI med lenke og uten nettkall; gammelt utdrag returneres som stale', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-guides-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  guides.init(dir);
  const calls = fakeEnv({ describe: { provider: 'gemini', name: 'Gemini', model: 'g', needsKey: true, hasKey: false } });
  const r = await guides.get({}, 'raid-spirit-vale');
  assert.equal(r.error.code, 'NOAI');
  assert.equal(r.stale, false);
  assert.equal(r.url, 'https://wiki.guildwars2.com/wiki/Spirit_Vale');
  assert.deepEqual(r.bosses.slice(0, 1), ['Vale Guardian']);
  assert.equal(calls.fetch, 0); assert.equal(calls.ai, 0);
  // legg et gammelt utdrag i cache på annet språk: returneres som stale sammen med feilen
  fs.writeFileSync(path.join(dir, 'guides', 'raid-spirit-vale.json'), JSON.stringify({ title: 'Spirit Vale', page: 'Spirit Vale', language: 'English', fetchedAt: 1, summary: ['old'], chat: ['old chat'], tips: [], model: 'm' }));
  const r2 = await guides.get({}, 'raid-spirit-vale');
  assert.equal(r2.error.code, 'NOAI'); assert.equal(r2.stale, true); assert.deepEqual(r2.summary, ['old']);
});

test('get: uten nett gis NET-feil, men cachet utdrag på samme språk brukes uten nettkall', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-guides-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  guides.init(dir);
  const calls = fakeEnv({ fetchError: 'ENOTFOUND' });
  const r = await guides.get({}, 'fractal-nightmare');
  assert.equal(r.error.code, 'NET');
  assert.match(r.error.message, /ENOTFOUND/);
  assert.equal(calls.ai, 0);
  fs.writeFileSync(path.join(dir, 'guides', 'fractal-nightmare.json'), JSON.stringify({ title: 'Nightmare Fractal', page: 'Nightmare Fractal', language: 'norsk', fetchedAt: 1, summary: ['MAMA'], chat: [], tips: [], model: 'm' }));
  const before = calls.fetch;
  const r2 = await guides.get({}, 'fractal-nightmare');
  assert.equal(r2.cached, true); assert.equal(r2.error, undefined); assert.equal(calls.fetch, before);
});

test('get: AI-feil og ugyldig JSON gir AI-feil uten cache; kort extract faller tilbake til wikitext', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-guides-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  guides.init(dir);
  let calls = fakeEnv({ aiError: 'ECONNREFUSED' });
  const r = await guides.get({}, 'strike-boneskinner');
  assert.equal(r.error.code, 'AI'); assert.match(r.error.message, /ECONNREFUSED/);
  assert.ok(!fs.existsSync(path.join(dir, 'guides', 'strike-boneskinner.json')));
  calls = fakeEnv({ aiText: 'dette er ikke json' });
  assert.equal((await guides.get({}, 'strike-boneskinner')).error.code, 'AI');
  // JSON pakket i tekst godtas
  calls = fakeEnv({ aiText: 'Her er svaret:\n```json\n{"summary":["a"],"chat":["b"],"tips":[]}\n```', extract: 'kort' });
  const r3 = await guides.get({}, 'strike-boneskinner');
  assert.equal(r3.error, undefined); assert.deepEqual(r3.summary, ['a']);
  assert.equal(calls.fetch, 2, 'extracts + wikitext-reserve');
  assert.match(calls.messages[1].content, /Fallback text/);
});

test('get: ukjent id kaster', async () => {
  fakeEnv();
  await assert.rejects(() => guides.get({}, 'finnes-ikke'), /finnes-ikke/);
});
