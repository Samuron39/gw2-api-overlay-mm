'use strict';
// Spillerlista i DPS-meteret: kjører selve src/renderer/overlay.js mot en minimal DOM (ingen Electron).
// Dekker det eieren ba om 18. sept 2026: navn med DPS og HPS, klikk for detaljer inne i meteret, rask vei tilbake,
// valg av mål, og at radene er klikkbare også når vinduet er låst (klikk-gjennom slås av mens pekeren er over en rad).
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Element, flush } = require('./helpers/renderer');

const PLAYERS = [
  { id: 101, rank: 1, name: 'Beta', self: false, dmg: 4200, dps: 420, pct: 63, heal: 1200, hps: 120 },
  { id: 'self', rank: 2, name: 'Alfa', self: true, dmg: 1650, dps: 165, pct: 25, heal: 300, hps: 30 },
  { id: 102, rank: 3, name: 'Gamma', self: false, dmg: 800, dps: 80, pct: 12, heal: 0, hps: 0 },
];
const TARGETS = [{ id: 200, name: 'Golem', dmg: 5450, pct: 82, current: true, rank: 5, rankKey: 'boss' }, { id: 201, name: 'Trash', dmg: 1200, pct: 18, current: false, rank: 0, rankKey: 'normal' }];
function detailFor(o) {
  const row = PLAYERS.find((p) => p.id === o.player) || null;
  return { period: o.period, empty: false, active: true, durationMs: 10000, total: 6650, dps: 665, currentTargetId: 200, targets: TARGETS, players: PLAYERS,
    target: o.target == null ? null : { id: o.target === 'current' ? 200 : o.target, name: o.target === 201 ? 'Trash' : 'Golem' },
    player: row && { ...row, skills: [{ skill: 20, name: 'Pil', dmg: 3000, hits: 1, pct: 71 }, { skill: 30, name: 'Juvenile Jaguar: Bitt', dmg: 700, hits: 1, pct: 17 }], targets: TARGETS.slice(0, 1),
      ...(row.self ? { taken: 600, takenBySource: [{ name: 'Golem', dmg: 600, pct: 100 }], healBySkill: [{ name: 'Signet', heal: 300, pct: 100 }] } : {}) } };
}

function overlay(config) {
  const calls = [], listeners = new Map(), byId = new Map();
  const document = new Element('document');
  document.body = document.appendChild(new Element('body'));
  document.documentElement = new Element('html'); document.documentElement.style.setProperty = () => {};
  document.getElementById = (id) => { if (!byId.has(id)) { const el = new Element('div'); el.id = id; document.body.appendChild(el); byId.set(id, el); } return byId.get(id); };
  document.body.setPointerCapture = () => {}; document.body.releasePointerCapture = () => {};
  const api = {
    invoke: (channel, ...args) => {
      calls.push({ channel, args });
      if (channel === 'overlays:get') return Promise.resolve({ dps: config });
      if (channel === 'overlays:set') { Object.assign(config, args[1]); for (const fn of listeners.get('overlays:changed') || []) fn({ type: 'dps', config }); return Promise.resolve(true); }
      if (channel === 'live:detail') return Promise.resolve(detailFor(args[0]));
      return Promise.resolve(channel === 'live:get' ? { dps: {} } : true);
    },
    on: (channel, fn) => { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(fn); return () => {}; },
  };
  const ctx = vm.createContext({ document, console, URLSearchParams, location: { search: '?type=dps' }, setInterval: () => 0, setTimeout: () => 0, clearTimeout() {},
    window: { api, SkillbarLogic: {} }, T: { load: async () => {}, sync: async () => false, t: (k, v) => k + (v ? ' ' + Object.values(v).join(' ') : '') } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/overlay.js'), 'utf8'), ctx);
  const dp = () => document.getElementById('dps'), bar = () => document.getElementById('dpsbar');
  return { calls, dp, bar, document, details: () => calls.filter((c) => c.channel === 'live:detail').map((c) => JSON.parse(JSON.stringify(c.args[0]))), // objektene kommer fra vm-konteksten (annen prototype)
    down: async (el) => { await el.dispatch('pointerdown', { button: 0, target: el }); await flush(); },
    emit: (channel, payload) => { for (const fn of listeners.get(channel) || []) fn(payload); } };
}

test('spillerlista: én klikkbar linje per spiller med DPS, andel og HPS; mål-knapp i verktøylinja', async () => {
  const h = overlay({ view: 'squad', period: 'fight', locked: true, enabled: true }); await flush(); await flush();
  assert.deepEqual(h.details().at(-1), { period: 'fight', player: null, target: null });
  const rows = h.dp().querySelectorAll('.sq');
  assert.equal(rows.length, 3);
  assert.ok(rows.every((r) => r.classList.contains('click')));
  assert.deepEqual(rows.map((r) => r.dataset.player), ['101', 'self', '102']);
  assert.match(rows[0].textContent, /1\. Beta/); assert.match(rows[0].querySelector('.v').textContent, /420 · 63%/);
  assert.equal(rows[0].querySelector('.h').textContent, '+120', 'HPS ved siden av DPS');
  assert.equal(rows[2].querySelector('.h'), null, 'ingen HPS-tall uten healing');
  assert.ok(rows[1].classList.contains('me'));
  assert.match(h.dp().querySelector('.big').textContent, /665/);
  assert.match(h.bar().querySelector('#dpTarget').textContent, /overlay\.dps\.target\.all/);
  assert.ok(h.bar().classList.contains('four'));
});

test('klikk på en spiller åpner detaljer inne i meteret, «Tilbake» går rett til lista', async () => {
  const h = overlay({ view: 'squad', period: 'last', locked: true }); await flush(); await flush();
  await h.down(h.dp().querySelectorAll('.sq')[0]);
  assert.deepEqual(h.details().at(-1), { period: 'last', player: 101, target: null });
  assert.equal(h.dp().querySelector('.pn').textContent, 'Beta');
  assert.match(h.dp().querySelector('.big').textContent, /420/);
  assert.deepEqual(h.dp().querySelectorAll('.sk').filter((r) => !r.classList.contains('tgr')).map((r) => r.querySelector('.n').textContent), ['Pil', 'Juvenile Jaguar: Bitt']);
  assert.match(h.dp().querySelectorAll('.sk')[0].querySelector('.v').textContent, /3000 · 71% · 1×/);
  assert.equal(h.dp().querySelectorAll('.sq').length, 0, 'lista er byttet ut med detaljene');
  await h.down(h.dp().querySelector('.bk'));
  assert.equal(h.dp().querySelectorAll('.sq').length, 3, 'tilbake til lista med ett klikk');
  assert.equal(h.details().at(-1).player, null);
  // deg selv: også mottatt og healing
  await h.down(h.dp().querySelectorAll('.sq')[1]);
  assert.equal(h.details().at(-1).player, 'self');
  assert.ok(h.dp().querySelector('.tkr'), 'mottatt per kilde'); assert.ok(h.dp().querySelector('.hs'), 'healing per skill');
});

test('mål: knappen blar alle → nåværende → fiendene i perioden; klikk på et mål i detaljene velger det, nytt klikk opphever', async () => {
  const h = overlay({ view: 'squad', period: 'fight', locked: true }); await flush(); await flush();
  const press = async () => { await h.bar().querySelector('#dpTarget').dispatch('click'); await flush(); };
  await press(); assert.equal(h.details().at(-1).target, 'current'); assert.match(h.bar().querySelector('#dpTarget').textContent, /target\.current/);
  await press(); assert.equal(h.details().at(-1).target, 'bosses', 'tilbys fordi perioden har en boss'); assert.match(h.bar().querySelector('#dpTarget').textContent, /target\.bosses/);
  await press(); assert.equal(h.details().at(-1).target, 200); assert.match(h.bar().querySelector('#dpTarget').textContent, /target\.named Golem/);
  await press(); assert.equal(h.details().at(-1).target, 201);
  await press(); assert.equal(h.details().at(-1).target, null); assert.match(h.bar().querySelector('#dpTarget').textContent, /target\.all/);
  await h.down(h.dp().querySelectorAll('.sq')[0]);
  const tg = h.dp().querySelector('.tgr');
  assert.equal(tg.dataset.target, '200'); assert.match(tg.textContent, /◉/, 'nåværende mål er merket'); assert.match(tg.textContent, /Golem/);
  assert.equal(tg.querySelector('.rk-boss').textContent, '★', 'boss er merket');
  await h.down(tg);
  assert.deepEqual(h.details().at(-1), { period: 'fight', player: 101, target: 200 });
  assert.ok(h.dp().querySelector('.tgr').classList.contains('on'));
  await h.down(h.dp().querySelector('.tgr'));
  assert.equal(h.details().at(-1).target, null, 'samme mål en gang til = alle mål');
});

test('låst vindu: klikk-gjennom slås av over klikkbare rader og på igjen utenfor; «Visning» lukker detaljene', async () => {
  const h = overlay({ view: 'all', period: 'fight', locked: true }); await flush(); await flush();
  assert.equal(h.details().length, 0, 'ingen detaljhenting i vanlig visning');
  // squad-radene i den vanlige visningen er også klikkbare
  h.emit('live:state', { dps: { current: { active: true, dps: 165, dps10: 165, total: 1650, durationMs: 10000, skills: [], squad: [{ id: 101, name: 'Beta', self: false, dmg: 4200, dps: 420, pct: 72 }, { id: 100, name: 'Alfa', self: true, dmg: 1650, dps: 165, pct: 28 }] } } });
  const row = h.dp().querySelectorAll('.sq')[0];
  assert.equal(row.dataset.player, '101'); assert.equal(h.dp().querySelectorAll('.sq')[1].dataset.player, 'self');
  const ignore = () => h.calls.filter((c) => c.channel === 'overlays:ignoreMouse').map((c) => c.args[1]);
  await h.document.dispatch('mousemove', { target: row }); assert.deepEqual(ignore(), [false], 'over en rad: ta imot klikk');
  await h.document.dispatch('mousemove', { target: h.dp() }); assert.deepEqual(ignore(), [false, true], 'utenfor: slipp klikk gjennom til spillet');
  await h.down(row); await flush();
  assert.equal(h.details().at(-1).player, 101); assert.equal(h.dp().querySelector('.pn').textContent, 'Beta');
  await h.bar().querySelector('#dpView').dispatch('click'); await flush();
  assert.equal(h.dp().querySelector('.pn'), null, 'visningsknappen lukker detaljene');
});
