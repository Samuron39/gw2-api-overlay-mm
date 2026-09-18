'use strict';
// Overlay-vinduet «Neste bosser»: utvalget og chat-teksten (src/renderer/timer-logic.js, delt med «I dag»), selve vinduet
// (src/renderer/overlay.js mot en minimal DOM), innstillingene og valideringen. Bruker den ekte tidsplanen i data/.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const timers = require('../src/modules/timers');
const { windowPatch } = require('../src/config-validation');
const { Element, renderer, flush } = require('./helpers/renderer');

const DATA = timers.getData();
const at = (h, m, s = 0) => Date.UTC(2026, 8, 18, h, m, s);
const names = (list) => list.map((b) => [b.name, b.active ? 'nå' : Math.round(b.inMin)]);

test('verdensbossene: core, harde og Drakkar, ikke de andre Bjora-hendelsene; sortert på tid med pågående først', () => {
  const all = timers.bossOccurrences(DATA.events, at(18, 27));
  const ids = new Set(all.map((b) => b.id));
  assert.equal(ids.size, 14);
  for (const id of ['megadestroyer', 'tequatl_the_sunless', 'triple_trouble_wurm', 'karka_queen', 'drakkar', 'inquest_golem_mark_ii']) assert.ok(ids.has(id), id);
  assert.ok(!all.some((b) => /Jora|Shards|Icebrood Champions/.test(b.name)), 'bare Drakkar fra Bjora Marches');
  assert.ok(all.every((b) => b.chatlink && b.chatlink.startsWith('[&')), 'alle har waypoint');
  for (let i = 1; i < all.length; i++) assert.ok(all[i - 1].active || all[i - 1].inMin <= all[i].inMin, 'stigende tid');
});

test('antall: de N neste; «snart» under fem minutter', () => {
  assert.deepEqual(names(timers.nextBosses(DATA.events, at(18, 27), { pick: 'count', count: 2 })), [['Megadestroyer', 3], ['Fire Elemental', 18]]);
  const four = timers.nextBosses(DATA.events, at(18, 27), { pick: 'count', count: 4 });
  assert.equal(four.length, 4); assert.deepEqual(four.map((b) => b.soon), [true, false, false, false]);
  assert.equal(timers.nextBosses(DATA.events, at(18, 27), { count: 99 }).length, 8, 'maks åtte rader');
  assert.equal(timers.nextBosses(DATA.events, at(18, 27), {}).length, 2, 'standard er to');
});

test('alle innen N minutter: 10, 20 og 30 gir stadig flere; ingen innenfor gir den neste alene, nedtonet', () => {
  const within = (n, o = {}) => names(timers.nextBosses(DATA.events, at(18, 27), { pick: 'within', within: n, ...o }));
  assert.deepEqual(within(10), [['Megadestroyer', 3]]);
  assert.deepEqual(within(20), [['Megadestroyer', 3], ['Fire Elemental', 18]]);
  assert.deepEqual(within(40).map((r) => r[1]), [3, 18, 33, 33, 38], 'to bosser starter samtidig om 33 minutter, Drakkar om 38');
  assert.equal(within(35).length, 4);
  const alone = timers.nextBosses(DATA.events, at(18, 36), { pick: 'within', within: 5, activeMin: 0 });
  assert.deepEqual(names(alone), [['Fire Elemental', 9]]); assert.equal(alone[0].beyond, true);
  assert.equal(timers.nextBosses(DATA.events, at(18, 27), { pick: 'within', within: 10 })[0].beyond, false);
});

test('pågående boss står øverst de første minuttene og viker så for de neste; drept i dag skjules', () => {
  const early = timers.nextBosses(DATA.events, at(18, 31), { count: 2, activeMin: 5 });
  assert.deepEqual(names(early), [['Megadestroyer', 'nå'], ['Fire Elemental', 14]]); assert.equal(early[0].sinceMin, 1);
  assert.deepEqual(names(timers.nextBosses(DATA.events, at(18, 36), { count: 2, activeMin: 5 })).map((r) => r[0]), ['Fire Elemental', 'Tequatl the Sunless'], 'etter fem minutter');
  assert.ok(!timers.nextBosses(DATA.events, at(18, 31), { count: 2, activeMin: 0 })[0].active, 'activeMin 0: aldri pågående');
  assert.deepEqual(names(timers.nextBosses(DATA.events, at(18, 27), { count: 2, done: ['megadestroyer'] })).map((r) => r[0]), ['Fire Elemental', 'Tequatl the Sunless']);
  assert.equal(timers.nextBosses(DATA.events, at(18, 27), { count: 2, done: ['megadestroyer'], hideDone: false })[0].name, 'Megadestroyer');
});

test('chat-teksten: navn, minutter, klokkeslett, kart og waypoint; «nå» for pågående; aldri over 190 tegn', () => {
  const t = (k, v) => (k === 'daily.pasteNow' ? `${v.name} pågår nå (${v.time})` : `${v.name} om ${v.m} min (${v.time})`);
  const opts = { t, locale: 'nb-NO', waypoints: DATA.waypoints };
  const [mega] = timers.nextBosses(DATA.events, at(18, 27), { count: 1 });
  const line = timers.pasteText(mega, at(18, 27), opts);
  assert.match(line, /^Megadestroyer om 3 min \(\d\d:30\) · Mount Maelstrom · \[&BM0CAAA=\]$/);
  const [active] = timers.nextBosses(DATA.events, at(18, 31), { count: 1 });
  assert.match(timers.pasteText(active, at(18, 31), opts), /^Megadestroyer pågår nå \(/);
  const long = timers.pasteText({ name: 'X'.repeat(300), chatlink: '[&BM0CAAA=]', inMin: 3 }, at(18, 27), opts);
  assert.ok(long.length <= 190 && long.endsWith('[&BM0CAAA=]'), 'waypointen beholdes når navnet kuttes');
  assert.equal(timers.wpInfo('[&tull]', DATA.waypoints), null);
});

test('innstillingene valideres: pick, count, within, activeMin og hideDone', () => {
  assert.deepEqual(windowPatch({ pick: 'within', within: 30, count: 3, activeMin: 0, hideDone: false }), { pick: 'within', within: 30, count: 3, activeMin: 0, hideDone: false });
  for (const bad of [{ pick: 'alle' }, { count: 0 }, { count: 9 }, { within: '20' }, { within: 1 }, { activeMin: -1 }, { hideDone: 'ja' }]) assert.throws(() => windowPatch(bad), JSON.stringify(bad));
  assert.ok(fs.readFileSync(path.join(__dirname, '../src/overlays.js'), 'utf8').includes("bosses: { enabled: false"), 'vindustypen finnes i DEFAULTS');
});

// ---------- Selve vinduet ----------
function bossWindow(config, { now = at(18, 27), done = [], paste = () => ({ ok: true }) } = {}) {
  const calls = [], listeners = new Map(), byId = new Map();
  const document = new Element('document');
  document.body = document.appendChild(new Element('body'));
  document.documentElement = new Element('html'); document.documentElement.style.setProperty = () => {};
  document.getElementById = (id) => { if (!byId.has(id)) { const el = new Element('div'); el.id = id; document.body.appendChild(el); byId.set(id, el); } return byId.get(id); };
  const clock = { now };
  class FakeDate extends Date { constructor(...a) { if (a.length) super(...a); else super(clock.now); } static now() { return clock.now; } }
  const api = {
    invoke: (channel, ...args) => {
      calls.push({ channel, args: JSON.parse(JSON.stringify(args)) });
      if (channel === 'overlays:get') return Promise.resolve({ bosses: config });
      if (channel === 'timers:data') return Promise.resolve(DATA);
      if (channel === 'daily:worldbosses') return done === null ? Promise.reject(new Error('ingen nøkkel')) : Promise.resolve({ done });
      if (channel === 'game:paste') return Promise.resolve(paste(args[0]));
      return Promise.resolve(channel === 'live:get' ? {} : true);
    },
    on: (channel, fn) => { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(fn); return () => {}; },
  };
  const ticks = [];
  const ctx = vm.createContext({ document, console, URLSearchParams, Date: FakeDate, atob, location: { search: '?type=bosses' }, setInterval: (fn, ms) => { ticks.push({ fn, ms }); return ticks.length; }, setTimeout: () => 0, clearTimeout() {},
    window: { api, SkillbarLogic: {} }, T: { locale: 'nb-NO', load: async () => {}, sync: async () => false, t: (k, v) => k + (v ? ' ' + Object.values(v).join(' ') : '') } });
  for (const f of ['timer-logic.js', 'overlay.js']) vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer', f), 'utf8'), ctx);
  const nb = () => document.getElementById('nb');
  return { calls, nb, document, clock, rows: () => nb().querySelectorAll('.nbr'),
    tick: () => { for (const t of ticks.filter((x) => x.ms === 1000)) t.fn(); },
    down: async (el) => { await el.dispatch('pointerdown', { button: 0, target: el }); await flush(); },
    emit: (channel, payload) => { for (const fn of listeners.get(channel) || []) fn(payload); } };
}

test('vinduet: to klikkbare rader med navn og nedtelling; nedtellingen går uten nye kall; andre vindusdeler er skjult', async () => {
  const h = bossWindow({ enabled: true, locked: true, pick: 'count', count: 2, within: 20, activeMin: 5, hideDone: true }); await flush(); await flush();
  assert.deepEqual(h.rows().map((r) => [r.querySelector('.n').textContent, r.querySelector('.v').textContent]), [['Megadestroyer', 'daily.inMin 3'], ['Fire Elemental', 'daily.inMin 18']]);
  assert.ok(h.rows()[0].classList.contains('soon') && !h.rows()[1].classList.contains('soon'));
  assert.ok(h.rows().every((r) => r.classList.contains('click')));
  assert.equal(h.nb().hidden, false); assert.equal(h.document.getElementById('grid').hidden, true); assert.equal(h.document.getElementById('dps').hidden, true);
  const before = h.calls.length;
  h.clock.now = at(18, 29); h.tick(); await flush();
  assert.equal(h.rows()[0].querySelector('.v').textContent, 'daily.inMin 1');
  h.clock.now = at(18, 31); h.tick(); await flush();
  assert.equal(h.rows()[0].querySelector('.v').textContent, 'daily.now'); assert.ok(h.rows()[0].classList.contains('active'));
  assert.equal(h.calls.length, before, 'ingen kall for å telle ned');
});

test('klikk limer bossnavn, tid og waypoint i chatten og kvitterer i raden; uten spill kopieres teksten', async () => {
  const h = bossWindow({ enabled: true, locked: true, pick: 'count', count: 2 }); await flush(); await flush();
  await h.down(h.rows()[0]);
  const paste = h.calls.find((c) => c.channel === 'game:paste');
  assert.match(paste.args[0], /^daily\.pasteNext Megadestroyer 3 \d\d:30 · Mount Maelstrom · \[&BM0CAAA=\]$/);
  assert.ok(h.rows()[0].classList.contains('ok')); assert.equal(h.rows()[0].querySelector('.v').textContent, 'overlay.bosses.pasted');
  assert.ok(!h.calls.some((c) => c.channel === 'clipboard:write'));
  h.clock.now += 3000; h.tick();
  assert.ok(!h.rows()[0].classList.contains('ok'), 'kvitteringen forsvinner etter et par sekunder');
  const off = bossWindow({ enabled: true, locked: true, count: 2 }, { paste: () => ({ ok: false, reason: 'NOGAME' }) }); await flush(); await flush();
  await off.down(off.rows()[1]);
  assert.match(off.calls.find((c) => c.channel === 'clipboard:write').args[0], /Fire Elemental/);
  assert.ok(off.rows()[1].classList.contains('fail')); assert.equal(off.rows()[1].querySelector('.v').textContent, 'overlay.bosses.copied');
});

test('innstillinger følges: alle innen N minutter, drept i dag skjules, uten API-nøkkel vises alle; låst vindu tar klikk over rader', async () => {
  const cfg = { enabled: true, locked: true, pick: 'within', within: 40, activeMin: 5, hideDone: true };
  const h = bossWindow(cfg, { done: ['megadestroyer'] }); await flush(); await flush();
  assert.deepEqual(h.rows().map((r) => r.querySelector('.n').textContent), ['Fire Elemental', 'Tequatl the Sunless', 'The Shatterer', 'Drakkar and Spirits of the Wild']);
  h.emit('overlays:changed', { type: 'bosses', config: { ...cfg, within: 10 } }); await flush();
  assert.equal(h.rows().length, 1); assert.ok(h.rows()[0].classList.contains('beyond'), 'ingen innen ti minutter: den neste alene');
  h.emit('overlays:changed', { type: 'bosses', config: { ...cfg, hideDone: false, within: 10 } }); await flush();
  assert.deepEqual(h.rows().map((r) => r.querySelector('.n').textContent), ['Megadestroyer']);
  const noKey = bossWindow({ enabled: true, locked: true, count: 1, hideDone: true }, { done: null }); await flush(); await flush();
  assert.equal(noKey.rows()[0].querySelector('.n').textContent, 'Megadestroyer');
  const ignore = () => h.calls.filter((c) => c.channel === 'overlays:ignoreMouse').map((c) => c.args[1]);
  await h.document.dispatch('mousemove', { target: h.rows()[0] }); assert.deepEqual(ignore(), [false]);
  await h.document.dispatch('mousemove', { target: h.nb() }); assert.deepEqual(ignore(), [false, true]);
});

test('Live-fanen: vinduet «Neste verdensbosser» har valg for visning, antall, innen, pågående og drept i dag', async () => {
  const overlays = Object.fromEntries(['buffs', 'debuffs', 'target', 'skillbar', 'dps', 'dps2', 'dps3'].map((k) => [k, { enabled: false, iconSize: 40, opacity: 1 }]));
  overlays.bosses = { enabled: true, locked: false, pick: 'count', count: 2, within: 20, activeMin: 5, hideDone: true, fontSize: 14, opacity: 1 };
  const h = renderer(['live'], (ch, ...a) => ch === 'live:get' ? {} : ch === 'overlays:get' ? overlays : ch === 'arc:status' ? {} : ch === 'skills:get' ? { ok: false } : ch === 'overlays:set' ? { ...overlays[a[0]], ...a[1] } : true);
  const root = h.root(); await h.modules.live.mount(root); await flush();
  const box = root.querySelectorAll('.lv-win').find((b) => b.dataset.id === 'bosses');
  assert.ok(box, 'kortet finnes');
  assert.deepEqual(box.querySelectorAll('[data-k]').map((i) => i.dataset.k).filter((k) => !['enabled', 'locked'].includes(k)).sort(), ['activeMin', 'count', 'fontSize', 'hideDone', 'opacity', 'pick', 'within']);
  const within = box.querySelectorAll('[data-k]').find((i) => i.dataset.k === 'within');
  within.value = '30'; await within.dispatch('change'); await flush();
  const set = h.calls.filter((c) => c.channel === 'overlays:set').at(-1);
  assert.deepEqual(JSON.parse(JSON.stringify(set.args)), ['bosses', { within: 30 }], 'tall lagres som tall');
});
