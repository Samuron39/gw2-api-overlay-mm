'use strict';
// Synlig kvittering ved knappen (Panel.busy / Panel.note / Panel.arcProgress) og bruken i Live og Kom i gang.
// Eieren trykket «Installer broen» 18. sept 2026 og så ingen endring: resultatet sto bare i statuslinja øverst.
const test = require('node:test');
const assert = require('node:assert/strict');
const { Element, renderer, deferred, flush } = require('./helpers/renderer');

const cls = (el) => el.className.split(' ').filter(Boolean).sort().join(' ');

test('busy: knappen låses med spinner mens det pågår, så grønn hake og blink; resultatet returneres', async () => {
  const h = renderer([], () => true); const { busy } = h.ctx.UiState;
  const btn = new Element('button'), note = new Element('div'), card = new Element('section');
  card.className = 'dy-card flash-ok';
  const work = deferred();
  const p = busy(btn, () => work.promise, { note, flash: card, working: 'Installerer', done: (v) => 'Ferdig ' + v });
  assert.equal(btn.disabled, true); assert.ok(btn.classList.contains('is-busy'));
  assert.equal(cls(note), 'act-note work'); assert.ok(note.querySelector('.act-spin')); assert.equal(note.textContent, 'Installerer');
  assert.ok(!card.classList.contains('flash-ok'), 'gammelt blink fjernes så det kan spilles på nytt');
  work.resolve(42);
  const r = await p;
  assert.deepEqual({ ok: r.ok, value: r.value }, { ok: true, value: 42 });
  assert.equal(btn.disabled, false); assert.ok(!btn.classList.contains('is-busy'));
  assert.equal(cls(note), 'act-note ok'); assert.equal(note.querySelector('.act-text').textContent, 'Ferdig 42');
  assert.ok(card.classList.contains('flash-ok'));
});

test('busy: feil vises rødt ved knappen og kastes ikke; done kan gi nøytral info uten blink', async () => {
  const h = renderer([], () => true); const { busy } = h.ctx.UiState;
  const btn = new Element('button'), note = new Element('div'), card = new Element('section');
  let r = await busy(btn, async () => { throw new Error('spillet kjører'); }, { note, flash: card, working: 'x', done: 'y' });
  assert.equal(r.ok, false); assert.equal(r.error.message, 'spillet kjører');
  assert.equal(cls(note), 'act-note err'); assert.match(note.textContent, /common\.error spillet kjører/);
  assert.equal(btn.disabled, false); assert.ok(!card.classList.contains('flash-ok'));
  r = await busy(btn, async () => ({ changed: false }), { note, flash: card, done: () => ({ kind: 'info', text: 'Allerede oppdatert' }) });
  assert.equal(cls(note), 'act-note info'); assert.ok(!card.classList.contains('flash-ok'));
});

test('busy: er fanen byttet i mellomtida, røres ikke DOM-en', async () => {
  const h = renderer([], () => true); const { busy } = h.ctx.UiState;
  const btn = new Element('button'), note = new Element('div'); let valid = true;
  const work = deferred();
  const p = busy(btn, () => work.promise, { note, owner: { valid: () => valid }, working: 'Arbeider', done: 'Ferdig' });
  valid = false; work.resolve(1); await p;
  assert.equal(cls(note), 'act-note work', 'urørt'); assert.equal(btn.disabled, true);
});

test('note og arcProgress: tekst escapes, fremdriftslinja følger mottatt/total, verifisering teller ned', () => {
  const h = renderer([], () => true); const { note, arcProgress } = h.ctx.UiState;
  const el = new Element('div');
  note(el, 'ok', '<b>x</b>'); assert.ok(el.innerHTML.includes('&lt;b&gt;x&lt;/b&gt;'));
  note(el, ''); assert.equal(el.innerHTML, ''); assert.equal(el.className, 'act-note');
  arcProgress(el, { phase: 'download', received: 512 * 1024, total: 1024 * 1024 });
  assert.equal(el.querySelector('.act-bar i').style.width, '50%');
  assert.match(el.textContent, /arc\.progress\.download 50 512 1024/);
  arcProgress(el, { phase: 'download', received: 2048, total: 0 });
  assert.equal(el.querySelector('.act-bar'), null, 'ukjent total: ingen linje'); assert.match(el.textContent, /downloadUnknown 2/);
  arcProgress(el, { phase: 'verify', ms: 10000, left: 2500 });
  assert.equal(el.querySelector('.act-bar i').style.width, '75%'); assert.match(el.textContent, /arc\.progress\.verify 3/);
  arcProgress(el, { phase: 'bridge' }); assert.match(el.textContent, /arc\.progress\.bridge/);
});

function liveHarness(state) {
  return renderer(['live'], (ch) => {
    if (ch === 'live:get') return state.snap;
    if (ch === 'overlays:get') return Object.fromEntries(['buffs', 'debuffs', 'target', 'skillbar', 'dps', 'dps2', 'dps3'].map((k) => [k, { enabled: false, iconSize: 40, opacity: 1 }]));
    if (ch === 'arc:status') return state.arc;
    if (ch === 'arc:installBridge') return state.install();
    if (ch === 'skills:get') return { ok: false };
    return true;
  });
}

test('Live: «Installer broen» kvitterer i kortet: allerede oppdatert, ferdig, og feil', async () => {
  const state = { snap: { connected: false }, arc: { installed: true, running: false, bridge: { available: true, installed: true, upToDate: true } }, install: () => ({ target: 'C:\\x\\bro.dll', changed: false }) };
  const h = liveHarness(state), root = h.root(); await h.modules.live.mount(root); await flush();
  const btn = root.querySelector('#lvInstallBridge'), note = root.querySelector('#lvBridgeNote');
  assert.equal(note.className, 'act-note', 'tom før første trykk');
  await btn.dispatch('click'); await flush();
  assert.equal(cls(note), 'act-note info'); assert.match(note.textContent, /live\.bridgeUnchanged/);
  state.install = () => ({ target: 'C:\\x\\bro.dll', changed: true });
  await btn.dispatch('click'); await flush();
  assert.equal(cls(note), 'act-note ok'); assert.match(note.textContent, /live\.bridgeDone/);
  assert.ok(root.querySelector('#lvBridge').classList.contains('flash-ok'));
  state.install = () => { throw new Error('Spillet kjører'); };
  await btn.dispatch('click'); await flush();
  assert.equal(cls(note), 'act-note err'); assert.match(note.textContent, /Spillet kjører/);
  assert.equal(btn.disabled, false);
});

test('Live: spillet kjører ikke gir nøytral «venter på spillet», ikke rød feil; fjernet ArcDPS gir antivirus-advarsel', async () => {
  const state = { snap: { connected: false }, arc: { installed: true, running: false, bridge: { available: true, installed: true, upToDate: true } }, install: () => ({}) };
  const h = liveHarness(state), root = h.root(); await h.modules.live.mount(root); await flush();
  let line = root.querySelector('#lvLive');
  assert.ok(line.querySelector('.wait'), 'nøytral ventetekst'); assert.equal(line.querySelector('.down'), null);
  assert.equal(root.querySelector('.act-warn'), null);
  // spillet kjører, men ingen kontakt: da er det en reell feil, og ArcDPS er fjernet utenfra
  state.arc = { installed: false, removedExternally: true, running: true, bridge: { available: true, installed: true, upToDate: true } };
  await root.querySelector('#lvCheck').dispatch('click'); await flush();
  line = root.querySelector('#lvLive');
  assert.ok(line.querySelector('.down')); assert.equal(line.querySelector('.wait'), null);
  assert.match(root.querySelector('.act-warn').textContent, /arc\.removedExternally/);
  // uten kontakt sjekkes statusen på nytt med jevne mellomrom
  assert.ok([...h.intervals.values()].some((i) => i.ms === 15000));
});

const setupStatus = (arc) => ({
  key: { set: true, valid: true, name: 'n', missing: { required: [], recommended: [] } },
  game: { dir: 'C:\\Guild Wars 2', valid: true, saved: true, running: false },
  arc, logs: { dir: 'x', exists: true, count: 1 }, startup: { followGame: true, launchAtStartup: true },
  helper: { ok: true, gameSeen: false }, ai: { provider: 'local', ok: true, modelLoaded: true, model: 'm', models: 1, url: '', name: '' },
});

test('Kom i gang: installasjon viser fremdrift i steget, kvitteringen overlever ny tegning, antivirus-feil vises rødt', async () => {
  const work = deferred();
  let arc = { installed: false, removedExternally: true, updateAvailable: false, bridge: { available: true, installed: true, upToDate: true }, error: '' };
  const h = renderer(['setup'], (ch) => ch === 'setup:check' ? setupStatus(arc) : ch === 'setup:installArc' ? work.promise : true);
  const root = h.root(); h.modules.setup.mount(root); await flush();
  assert.match(root.querySelector('#su-arc .setup-status').textContent, /arc\.removedExternally/, 'sier at ArcDPS er fjernet utenfra');
  const click = root.querySelector('#suArcInstall').dispatch('click'); await flush();
  let note = root.querySelector('#su-note-arc');
  assert.equal(cls(note), 'act-note work');
  h.emit('arc:progress', { phase: 'download', received: 300 * 1024, total: 1200 * 1024 });
  assert.equal(root.querySelector('#su-note-arc .act-bar i').style.width, '25%');
  arc = { ...arc, installed: true, removedExternally: false };
  work.resolve({}); await click; await flush();
  note = root.querySelector('#su-note-arc');
  assert.equal(cls(note), 'act-note ok', 'står igjen etter at steget er tegnet på nytt'); assert.match(note.textContent, /setup\.arc\.doneNote/);

  // antivirus fjernet fila rett etter installasjon
  const h2 = renderer(['setup'], (ch) => { if (ch === 'setup:check') return setupStatus(arc); if (ch === 'setup:installArc') throw new Error('fjernet av antivirus'); return true; });
  const root2 = h2.root(); h2.modules.setup.mount(root2); await flush();
  await root2.querySelector('#suArcInstall').dispatch('click'); await flush();
  const n2 = root2.querySelector('#su-note-arc');
  assert.equal(cls(n2), 'act-note err'); assert.match(n2.textContent, /fjernet av antivirus/);
});
