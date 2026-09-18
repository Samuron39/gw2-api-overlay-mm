'use strict';
// Tester for Kom i gang-veiviseren: tillatelsessjekk og samlet status med falske avhengigheter.
const test = require('node:test');
const assert = require('node:assert/strict');
const setup = require('../src/modules/setup');

test('missingPermissions skiller påkrevde og anbefalte tillatelser', () => {
  const all = [...setup.REQUIRED_PERMS, ...setup.RECOMMENDED_PERMS];
  assert.deepEqual(setup.missingPermissions(all), { required: [], recommended: [] });
  assert.deepEqual(setup.missingPermissions(['account', 'inventories']), { required: ['characters', 'wallet'], recommended: setup.RECOMMENDED_PERMS });
  assert.deepEqual(setup.missingPermissions(undefined).required, setup.REQUIRED_PERMS);
});

function fakeDeps(over = {}) {
  return {
    gw2: { get: async (ep) => (ep === '/tokeninfo' ? { permissions: ['account', 'inventories', 'characters', 'wallet', 'builds', 'unlocks', 'progression', 'tradingpost', 'guilds'] } : { name: 'Test.1234' }) },
    arcdps: { isGameDir: (d) => d === 'C:\GW2', detectDir: async () => '', gameRunning: async () => false, status: async () => ({ installed: true, updateAvailable: false, bridge: { available: true, installed: true, upToDate: true }, error: '' }) },
    dps: { DEFAULT_DIR: 'C:\finnes-ikke\arcdps.cbtlogs', listLogs: () => [] },
    ai: { describe: () => ({ provider: 'local', name: 'LM Studio', model: 'a', url: 'u', needsKey: false, hasKey: false }), listModels: async () => ['a', 'b'] },
    mumble: { state: { running: false } },
    ...over,
  };
}

test('check gir grønt på alt når alt er på plass', async () => {
  const r = await setup.check({ apiKey: 'x', gw2Dir: 'C:\GW2', lmModel: 'a', lmUrl: 'u', followGame: true, launchAtStartup: true }, fakeDeps());
  assert.equal(r.key.valid, true); assert.equal(r.key.name, 'Test.1234'); assert.deepEqual(r.key.missing, { required: [], recommended: [] });
  assert.equal(r.game.valid, true); assert.equal(r.arc.installed, true); assert.equal(r.arc.bridge.upToDate, true);
  assert.equal(r.logs.exists, false);
  assert.equal(r.ai.ok, true); assert.equal(r.ai.modelLoaded, true);
  assert.equal(r.helper.ok, true); assert.deepEqual(r.startup, { followGame: true, launchAtStartup: true });
});

test('check tåler ugyldig nøkkel, manglende spillmappe og LM Studio som er nede', async () => {
  const deps = fakeDeps({
    gw2: { get: async () => { throw new Error('HTTP 401'); } },
    ai: { describe: () => ({ provider: 'local', name: 'LM Studio', model: '', url: 'u', needsKey: false, hasKey: false }), listModels: async () => { throw new Error('ECONNREFUSED'); } },
    mumble: { state: { running: false, error: 'mangler exe' } },
  });
  const r = await setup.check({ apiKey: 'feil', gw2Dir: '' }, deps);
  assert.equal(r.key.set, true); assert.equal(r.key.valid, false); assert.match(r.key.error, /401/);
  assert.equal(r.game.valid, false); assert.equal(r.arc.installed, false);
  assert.equal(r.ai.ok, false); assert.match(r.ai.error, /ECONNREFUSED/);
  assert.equal(r.helper.ok, false);
});

test('check uten nøkkel rapporterer alle tillatelser som manglende', async () => {
  const r = await setup.check({ apiKey: '', gw2Dir: 'C:\GW2' }, fakeDeps());
  assert.equal(r.key.set, false); assert.deepEqual(r.key.missing.required, setup.REQUIRED_PERMS);
});

test('check avventer async loggindeks og beholder delresultater når spilldeteksjon feiler', async () => {
  const r = await setup.check({ apiKey: 'test-key', dpsLogDir: __dirname }, fakeDeps({
    dps: { listLogs: async () => { await new Promise(resolve => setTimeout(resolve, 10)); return [{ file: 'a.evtc' }]; } },
    arcdps: { isGameDir: () => false, detectDir: async () => { throw new Error('spill utilgjengelig'); } },
  }));
  assert.equal(r.logs.count, 1); assert.equal(r.key.valid, true); assert.equal(r.ai.ok, true);
  assert.match(r.game.error, /spill utilgjengelig/);
});

test('check kjører uavhengige sjekker parallelt med maksimalt tre aktive', async () => {
  let active = 0, peak = 0;
  const run = async value => { active++; peak = Math.max(peak, active); await new Promise(resolve => setTimeout(resolve, 10)); active--; return value; };
  const deps = fakeDeps();
  deps.gw2.get = ep => run(ep === '/tokeninfo' ? { permissions: ['account'] } : { name: 'Test.1234' });
  deps.arcdps.detectDir = () => run('C:\\GW2'); deps.arcdps.gameRunning = () => run(false); deps.arcdps.status = () => run({ installed: true, bridge: {} });
  deps.dps.listLogs = () => run([]); deps.ai.listModels = () => run(['a']);
  await setup.check({ apiKey: 'x', dpsLogDir: __dirname }, deps);
  assert.ok(peak > 1); assert.ok(peak <= 3);
});

test('isComplete: ferdig når ingenting påkrevd mangler; advarsler og valgfrie steg teller ikke', () => {
  const { isComplete } = require('../src/modules/setup');
  const ok = { key: { set: true, valid: true, missing: { required: [], recommended: ['wallet'] } }, game: { valid: true }, arc: { installed: true, updateAvailable: true, bridge: { installed: true, upToDate: false } }, helper: { ok: true }, logs: { exists: false }, ai: { ok: false } };
  assert.equal(isComplete(ok), true, 'gule steg (gammel bro, manglende anbefalt rettighet, ingen AI) hindrer ikke');
  assert.equal(isComplete({ ...ok, key: { ...ok.key, valid: false } }), false);
  assert.equal(isComplete({ ...ok, key: { ...ok.key, missing: { required: ['inventories'], recommended: [] } } }), false);
  assert.equal(isComplete({ ...ok, game: { valid: false } }), false);
  assert.equal(isComplete({ ...ok, arc: { installed: false, bridge: { installed: true } } }), false, 'ArcDPS fjernet (f.eks. av antivirus)');
  assert.equal(isComplete({ ...ok, arc: { installed: true, bridge: { installed: false } } }), false);
  assert.equal(isComplete({ ...ok, helper: { ok: false } }), false);
  assert.equal(isComplete(null), false); assert.equal(isComplete({}), false);
});
