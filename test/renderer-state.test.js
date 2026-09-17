'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderer, deferred, flush } = require('./helpers/renderer');

test('Tidsplan: forlate under lasting oppretter ingen senere abonnementer eller intervaller', async () => {
  const slow = deferred(); let first = true;
  const h = renderer(['timers'], (ch) => {
    if (ch === 'timers:data') return { events: {} };
    if (ch === 'mumble:get') { if (first) { first = false; return slow.promise; } return { running: false }; }
    if (ch === 'guides:list') return { groups: {} };
    if (ch === 'daily:get' || ch === 'daily:worldbosses') return { worldbosses: { done: [] }, done: [] };
  }, { apiKey: 'FAKE' });
  const p = h.modules.timers.mount(h.root()); await flush(); h.modules.timers.unmount();
  await h.modules.timers.mount(h.root());
  slow.resolve({ running: false }); await p;
  assert.equal(h.intervals.size, 2);
  h.modules.timers.unmount();
  assert.equal(h.intervals.size, 0);
  assert.equal([...h.listeners.values()].reduce((n, s) => n + s.size, 0), 0);
});

test('Daily: sent svar fra gammel montering skriver ikke til ny fane', async () => {
  const slow = deferred(); let calls = 0;
  const h = renderer(['daily'], (ch) => {
    if (ch === 'timers:data') return { events: {} };
    if (ch === 'daily:get') return ++calls === 1 ? slow.promise : Promise.reject(new Error('NY'));
  }, { apiKey: 'FAKE' });
  const old = h.modules.daily.mount(h.root()); await flush(); h.modules.daily.unmount();
  await h.modules.daily.mount(h.root());
  const before = h.statuses.length;
  slow.reject(new Error('GAMMEL')); await old;
  assert.equal(h.statuses.length, before);
  h.modules.daily.unmount(); assert.equal(h.intervals.size, 0);
});

test('Inventory beholder fullført plan ved fanebytte og rydder konfiglyttere', async () => {
  const response = deferred();
  const h = renderer(['inventory'], (ch) => ch === 'ai:providers' ? { current: { provider: 'local' } } : response.promise);
  const root = h.root(); h.modules.inventory.mount(root);
  const task = root.querySelector('#planBtn').dispatch('click');
  const id = h.calls.find((c) => c.channel === 'ai:prioritize').args[0].requestId;
  assert.ok(id);
  h.modules.inventory.unmount(); assert.equal(h.configListeners.size, 0);
  response.resolve({ steg: [{ prioritet: 1, hva: 'Beholdt plan', handling: '', hvorfor: '' }], oppsummering: 'Ferdig' }); await task;
  const second = h.root(); h.modules.inventory.mount(second);
  assert.match(second.querySelector('#plan').textContent, /Beholdt plan/);
  h.modules.inventory.unmount(); assert.equal(h.configListeners.size, 0);
});

const setupStatus = () => ({ key: { set: false }, game: { valid: false }, arc: { bridge: {} }, logs: { exists: false }, startup: {}, helper: { ok: true }, ai: { provider: 'local', ok: false } });
test('Oppsett bevarer samme nøkkelfelt under sjekk, oppstartsvalg og fanebytte', async () => {
  const response = deferred();
  const h = renderer(['setup'], (ch, arg) => ch === 'setup:check' ? response.promise : arg);
  const root = h.root(); h.modules.setup.mount(root);
  const key = root.querySelector('#suKey'); key.value = 'FAKE-UTKAST'; await key.dispatch('input');
  response.resolve(setupStatus()); await flush();
  assert.equal(root.querySelector('#suKey'), key);
  assert.equal(key.value, 'FAKE-UTKAST');
  await root.querySelector('#suFollow').dispatch('change');
  assert.equal(root.querySelector('#suKey'), key);
  h.modules.setup.unmount();
  const second = h.root(); h.modules.setup.mount(second); await flush();
  assert.equal(second.querySelector('#suKey').value, 'FAKE-UTKAST');
  h.modules.setup.unmount(); assert.equal(h.configListeners.size, 0);
});

test('Oppsett: sent lagringssvar sletter ikke et nyere nøkkelutkast', async () => {
  const saved = deferred();
  const h = renderer(['setup'], (ch) => ch === 'setup:check' ? setupStatus() : saved.promise);
  const root = h.root(); h.modules.setup.mount(root); await flush();
  const key = root.querySelector('#suKey'); key.value = 'FAKE-A'; await key.dispatch('input');
  const task = root.querySelector('#suKeySave').dispatch('click');
  key.value = 'FAKE-B'; await key.dispatch('input');
  saved.resolve({}); await task;
  assert.equal(key.value, 'FAKE-B');
});

test('Oppdatering: hendelse før snapshot vinner, også ved gjenåpning', async () => {
  const snapshot = deferred(); let first = true;
  const h = renderer(['settings'], (ch) => {
    if (ch === 'update:get') { if (first) { first = false; return snapshot.promise; } return { revision: 3, status: 'downloaded' }; }
    if (ch === 'ai:providers') return { providers: [{ id: 'local', name: 'LM Studio' }] };
  }, { keepList: [], materialCap: 250, minTp: 0 });
  const root = h.root(); await h.modules.settings.mount(root);
  h.emit('update:status', { revision: 3, status: 'downloaded' });
  snapshot.resolve({ revision: 2, status: 'downloading' }); await flush();
  assert.equal(root.querySelector('#updInstall').style.display, '');
  h.modules.settings.unmount(); assert.equal(h.listeners.get('update:status').size, 0);
  const second = h.root(); await h.modules.settings.mount(second); await flush();
  assert.equal(second.querySelector('#updInstall').style.display, '');
});

const bar = (key) => ({ ok: true, key, buildName: key, rotation: { steps: [], upkeep: [] }, all: [{ id: 111, name: 'Skill', buffs: [] }], boonNames: [], builds: [{ tab: 1, name: 'A' }, { tab: 2, name: 'B' }], sets: { A: { types: [] } }, weaponSet: 'A', upkeepSuggestions: [] });
function liveHarness() {
  const response = deferred(); let current = 'A';
  const h = renderer(['live'], (ch, arg) => {
    if (ch === 'live:get') return {};
    if (ch === 'overlays:get') return Object.fromEntries(['buffs', 'debuffs', 'target', 'skillbar', 'dps', 'dps2', 'dps3'].map((k) => [k, { enabled: false, iconSize: 40, opacity: 1 }]));
    if (ch === 'arc:status') return {};
    if (ch === 'skills:get') return bar(current);
    if (ch === 'skills:suggest') return response.promise;
    return true;
  });
  return { ...h, response, switchTo: (key) => { current = key; } };
}
test('Live: forslag for A kan ikke lagres i B og bevares når A åpnes igjen', async () => {
  const h = liveHarness(), root = h.root(); await h.modules.live.mount(root); await flush();
  const request = root.querySelector('#lvSuggest').dispatch('click');
  h.switchTo('B'); await root.querySelector('#lvBuild').dispatch('change'); await flush();
  h.response.resolve({ rotasjon: [{ skill: 111, note: 'FOR-A' }], forklaring: 'A' }); await request;
  await root.querySelector('#lvSave').dispatch('click');
  let saved = h.calls.filter((c) => c.channel === 'skills:setRotation').at(-1);
  assert.equal(saved.args[0], 'B'); assert.equal(saved.args[1].steps.length, 0);
  h.switchTo('A'); await root.querySelector('#lvBuild').dispatch('change'); await flush();
  await root.querySelector('#lvSave').dispatch('click');
  saved = h.calls.filter((c) => c.channel === 'skills:setRotation').at(-1);
  assert.equal(saved.args[0], 'A'); assert.equal(saved.args[1].steps[0].note, 'FOR-A');
});

test('Live: manuell redigering under AI bevares til forslaget uttrykkelig brukes', async () => {
  const h = liveHarness(), root = h.root(); await h.modules.live.mount(root); await flush();
  const request = root.querySelector('#lvSuggest').dispatch('click');
  await root.querySelector('#lvAdd').dispatch('click');
  h.response.resolve({ rotasjon: [{ skill: 111, note: 'AI' }], forklaring: 'AI' }); await request;
  await root.querySelector('#lvSave').dispatch('click');
  assert.equal(h.calls.filter((c) => c.channel === 'skills:setRotation').at(-1).args[1].steps[0].note, '');
  await root.querySelector('#lvApplySuggestion').dispatch('click');
  await root.querySelector('#lvSave').dispatch('click');
  assert.equal(h.calls.filter((c) => c.channel === 'skills:setRotation').at(-1).args[1].steps[0].note, 'AI');
});

test('Tidsplan oppdaterer nedtelling uten å erstatte waypoint-knappen eller hente kontodata', async () => {
  const { getData } = require('../src/modules/timers');
  const data = getData(); let now = Date.UTC(2026, 8, 17, 0, 1);
  const h = renderer(['timers'], (ch) => {
    if (ch === 'timers:data') return { events: { 'core-wb': data.events['core-wb'] }, waypoints: data.waypoints };
    if (ch === 'mumble:get') return { running: false };
    if (ch === 'guides:list') return { groups: {} };
    if (ch === 'daily:worldbosses') return { done: [] };
    if (ch === 'game:paste') return { ok: true };
  }, { apiKey: 'FAKE' });
  h.ctx.Date = class extends Date { static now() { return now; } };
  const root = h.root(); await h.modules.timers.mount(root); await flush();
  const list = root.querySelector('#tmList'), button = list.querySelector('button.wp'), count = list.querySelector('.tm-countdown');
  const before = count.textContent, writes = list.writes, apiCalls = h.calls.length;
  now += 60000;
  [...h.intervals.values()].find((i) => i.ms === 1000).fn();
  assert.equal(list.writes, writes); assert.equal(list.querySelector('button.wp'), button);
  assert.notEqual(count.textContent, before); assert.equal(h.calls.length, apiCalls);
  await button.dispatch('click');
  assert.match(h.calls.at(-1).args[0], /pasteNow/);
  assert.equal(h.calls.some((c) => c.channel === 'daily:get'), false);
});

test('I dag skifter aktiv boss og chattekst uten ny API-henting eller nye knapper', async () => {
  const data = require('../src/modules/timers').getData(); let now = Date.UTC(2026, 8, 17, 0, 1);
  const h = renderer(['daily'], (ch) => {
    if (ch === 'timers:data') return data;
    if (ch === 'daily:get') return { fetchedAt: now, resets: { daily: now + 10000, weekly: now + 20000 }, worldbosses: { all: ['admiral_taidha_covington'], done: [] }, wizard: {}, fractals: [], dailycrafting: { all: [], done: [] }, mapchests: { all: [], done: [] } };
    if (ch === 'game:paste') return { ok: true };
  }, { apiKey: 'FAKE' });
  h.ctx.Date = class extends Date { static now() { return now; } };
  const root = h.root(); await h.modules.daily.mount(root);
  const button = root.querySelector('button.wp'), body = root.querySelector('#dyBody'), writes = body.writes;
  assert.equal(root.querySelector('.dy-boss-time').textContent, 'daily.now');
  await button.dispatch('click'); assert.match(h.calls.at(-1).args[0], /pasteNow/);
  now = Date.UTC(2026, 8, 17, 0, 15);
  [...h.intervals.values()].find((i) => i.ms === 1000).fn();
  assert.equal(body.writes, writes); assert.equal(root.querySelector('button.wp'), button);
  assert.match(root.querySelector('.dy-boss-time').textContent, /165/);
  await button.dispatch('click'); assert.match(h.calls.at(-1).args[0], /pasteNext/);
  assert.equal(h.calls.filter((c) => c.channel === 'daily:get').length, 1);
});
