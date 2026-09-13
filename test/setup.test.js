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
    ai: { listModels: async () => ['a', 'b'] },
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
    ai: { listModels: async () => { throw new Error('ECONNREFUSED'); } },
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
