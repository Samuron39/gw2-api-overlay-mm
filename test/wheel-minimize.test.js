'use strict';
// Minimert hjul: kjører selve src/renderer/wheel.js mot en minimal DOM. Ønsket av eieren 19. sept 2026: hjulet skal kunne
// minimeres til bare ikonet og åpnes igjen når man vil. Et klikk på ikonet (uten å dra) bytter, ▁ i linja under minimerer,
// valget lagres i config.wheel.minimized, og å dra ikonet flytter fortsatt hjulet uten å bytte tilstand.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { Element, flush } = require('./helpers/renderer');
const { windowPatch } = require('../src/config-validation');

function wheel(config = { wheel: { locked: false, minimized: false }, wheelModules: null }, { saveFails = false } = {}) {
  const calls = [], listeners = new Map(), byId = new Map();
  const document = new Element('document');
  document.body = document.appendChild(new Element('body'));
  document.documentElement = new Element('html');
  document.getElementById = (id) => { if (!byId.has(id)) { const el = new Element('div'); el.id = id; el.setPointerCapture = () => {}; el.releasePointerCapture = () => {}; document.body.appendChild(el); byId.set(id, el); } return byId.get(id); };
  document.createElementNS = (_ns, tag) => new Element(tag);
  document.elementFromPoint = () => null;
  const api = {
    invoke: (channel, ...args) => {
      calls.push({ channel, args: JSON.parse(JSON.stringify(args)) });
      if (channel === 'config:get') return Promise.resolve(config);
      if (channel === 'config:set') return saveFails ? Promise.reject(new Error('disk full')) : Promise.resolve(config);
      if (channel === 'panel:state') return Promise.resolve({ visible: false, module: null });
      return Promise.resolve(channel === 'mumble:get' ? { running: false } : true);
    },
    on: (channel, fn) => { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(fn); return () => {}; },
  };
  const ctx = vm.createContext({ document, console, setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
    window: { api, innerWidth: 200, innerHeight: 234, addEventListener() {} }, T: { load: async () => {}, sync: async () => false, t: (k) => k } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../src/renderer/wheel.js'), 'utf8'), ctx);
  const el = (id) => document.getElementById(id);
  const press = async (dx = 0, dy = 0) => {
    await el('center').dispatch('pointerdown', { button: 0, pointerId: 1, screenX: 500, screenY: 500 });
    if (dx || dy) await el('center').dispatch('pointermove', { pointerId: 1, screenX: 500 + dx, screenY: 500 + dy });
    await el('center').dispatch('pointerup', { pointerId: 1, screenX: 500 + dx, screenY: 500 + dy });
    await flush();
  };
  return { calls, el, body: document.body, press, mini: () => document.body.classList.contains('mini'),
    sets: () => calls.filter((c) => c.channel === 'config:set').map((c) => c.args[0]),
    drags: () => calls.filter((c) => c.channel === 'win:drag').map((c) => c.args[0].phase),
    emit: (channel, payload) => { for (const fn of listeners.get(channel) || []) fn(payload); } };
}

test('klikk på ikonet minimerer hjulet og et nytt klikk åpner det; valget lagres hver gang', async () => {
  const h = wheel(); await flush(); await flush();
  assert.equal(h.mini(), false); assert.equal(h.el('centerBadge').textContent, '✥'); assert.equal(h.el('center').title, 'wheel.minimizeOrDrag');
  await h.press();
  assert.equal(h.mini(), true); assert.deepEqual(h.sets(), [{ wheel: { minimized: true } }]);
  assert.equal(h.el('centerBadge').textContent, '＋'); assert.equal(h.el('center').title, 'wheel.restore');
  await h.press();
  assert.equal(h.mini(), false); assert.deepEqual(h.sets().at(-1), { wheel: { minimized: false } });
});

test('å dra ikonet flytter hjulet uten å minimere; en bitteliten bevegelse (under 5 px) er fortsatt et klikk', async () => {
  const h = wheel(); await flush(); await flush();
  await h.press(40, 10);
  assert.equal(h.mini(), false); assert.deepEqual(h.sets(), []); assert.deepEqual(h.drags(), ['start', 'move', 'end']);
  await h.press(2, 2);
  assert.equal(h.mini(), true, 'skjelving på hånda teller som klikk');
  // minimert hjul kan også dras
  await h.press(60, 0);
  assert.equal(h.mini(), true); assert.equal(h.drags().filter((p) => p === 'move').length, 3);
});

test('knappen ▁ minimerer, låst plassering kan fortsatt minimeres og åpnes (men dras ikke), og lagringsfeil stopper ikke hjulet', async () => {
  const h = wheel(); await flush(); await flush();
  await h.el('miniBtn').dispatch('click'); await flush();
  assert.equal(h.mini(), true); assert.equal(h.el('miniBtn').title, 'wheel.minimize');
  const locked = wheel({ wheel: { locked: true, minimized: false }, wheelModules: null }); await flush(); await flush();
  assert.equal(locked.el('center').title, 'wheel.minimizeLocked');
  await locked.press(30, 30);
  assert.deepEqual(locked.drags(), [], 'låst: ingen draing'); assert.equal(locked.mini(), false, 'og en dra-bevegelse er ikke et klikk');
  await locked.press();
  assert.equal(locked.mini(), true);
  const broken = wheel(undefined, { saveFails: true }); await flush(); await flush();
  await broken.press();
  assert.equal(broken.mini(), true, 'hjulet minimeres selv om lagringen feiler');
});

test('hjulet starter slik du forlot det, og følger config:changed fra andre vinduer', async () => {
  const h = wheel({ wheel: { locked: false, minimized: true }, wheelModules: null }); await flush(); await flush();
  assert.equal(h.mini(), true); assert.equal(h.el('centerBadge').textContent, '＋');
  h.emit('config:changed', { wheel: { locked: false, minimized: false }, wheelModules: null }); await flush();
  assert.equal(h.mini(), false);
  // valideringen slipper feltet gjennom, og bare som boolsk verdi
  assert.deepEqual(windowPatch({ minimized: true }, ['x', 'y', 'locked', 'size', 'minimized']), { minimized: true });
  assert.throws(() => windowPatch({ minimized: 'ja' }, ['minimized']));
  assert.equal(require('../src/config').DEFAULT_CONFIG.wheel.minimized, false, 'standard er åpent hjul');
});

test('stilarket skjuler segmentene og linja under når hjulet er minimert', () => {
  const css = fs.readFileSync(path.join(__dirname, '../src/renderer/wheel.html'), 'utf8');
  assert.match(css, /body\.mini #svg, body\.mini #bar \{ display: none; \}/);
  assert.match(css, /id="miniBtn"/);
});
