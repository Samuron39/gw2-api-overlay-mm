'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const gw2 = require('../src/gw2');
const rules = require('../src/rules');
const ai = require('../src/ai');
const turn = () => new Promise(setImmediate);

test('GW2: ukjente opplåsninger skilles fra kjent tom/eid liste og følger med til AI', async (t) => {
  let dyes;
  t.mock.method(globalThis, 'fetch', async (url) => {
    const endpoint = new URL(url).pathname;
    if (endpoint.endsWith('/tokeninfo')) return Response.json({ permissions: ['account', 'characters', 'inventories', 'wallet', 'unlocks', 'progression'] });
    if (endpoint === '/v2/account') return Response.json({ name: 'Demo' });
    if (endpoint.endsWith('/dyes')) { if (dyes instanceof Error) throw dyes; return Response.json(dyes); }
    return Response.json([]);
  });
  const item = { id: 1, name: 'Testfarge', type: 'Consumable', details: { type: 'Unlock', unlock_type: 'Dye', color_id: 42 } };
  const ctx = { prices: new Map([[1, { sells: { unit_price: 1000 }, buys: { unit_price: 900 } }]]), materialIds: new Set(), materialCounts: new Map(), keepList: [], materialCap: 250, minTp: 100 };
  for (const [value, state, action] of [[new Error('Nettfeil'), 'unknown', 'keep'], [{ unexpected: true }, 'unknown', 'keep'], [[], 'known', 'use'], [[42], 'known', 'tp']]) {
    dyes = value;
    const data = await gw2.fetchAccountData('FAKE_TEST_KEY');
    assert.equal(data.unlocks.status.dyes, state);
    assert.equal(data.errors.length, state === 'unknown' ? 1 : 0);
    assert.equal(data.unlocks.status.skins, 'known', 'andre vellykkede delkall beholdes');
    const rec = rules.recommend({ item, count: 1, sourceType: 'bank' }, { ...ctx, unlocks: data.unlocks });
    assert.equal(rec.action, action);
    assert.equal(rec.flags.includes('unlockUnknown'), state === 'unknown');
    if (state === 'unknown') {
      assert.equal(data.unlocks.dyes, null);
      assert.equal(rec.flags.includes('unlockNew'), false);
      assert.ok(ai.buildContext({ rows: [], errors: data.errors }).includes(data.errors[0]));
    }
  }
});

test('GW2: 429/5xx gjentas med Retry-After og beholder autorisasjon i header', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.equal(new URL(url).searchParams.get('ids'), '1,2');
    assert.equal(new URL(url).searchParams.has('access_token'), false);
    assert.equal(init.headers.Authorization, 'Bearer FAKE_TEST_KEY');
    calls++;
    if (calls === 1) return new Response('', { status: 429, headers: { 'retry-after': '2' } });
    if (calls === 2) return new Response('', { status: 503 });
    return Response.json([1, 2]);
  });
  const pending = gw2.get('/items', { key: 'FAKE_TEST_KEY', params: { ids: '1,2' } });
  await turn(); assert.equal(calls, 1);
  t.mock.timers.tick(1999); await turn(); assert.equal(calls, 1);
  t.mock.timers.tick(1); await turn(); assert.equal(calls, 2);
  t.mock.timers.tick(2000); assert.deepEqual(await pending, [1, 2]);
});

test('GW2: Retry-After kan ikke overskride totalbudsjettet', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 429, headers: { 'retry-after': '3600' } }); });
  const pending = gw2.get('/items', { budgetMs: 25 });
  const rejected = assert.rejects(pending, { code: 'TIMEOUT' });
  await turn(); t.mock.timers.tick(25); await rejected; assert.equal(calls, 1);
});

test('GW2: maksimalt tre ekstra forsøk og avbrytelse under retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('', { status: 503 }); });
  const pending = gw2.get('/items', { retries: 99 });
  const rejected = assert.rejects(pending);
  for (const ms of [1000, 2000, 3000]) { await turn(); t.mock.timers.tick(ms); }
  await rejected; assert.equal(calls, 4);
  const controller = new AbortController();
  const cancelled = gw2.get('/items', { signal: controller.signal });
  const interrupted = assert.rejects(cancelled, { code: 'ABORT_ERR' });
  await turn(); controller.abort(); await interrupted; assert.equal(calls, 5);
});

test('GW2: bulk-404 er tom liste; andre 404 avvises og tomt svar leses ikke', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => ({ status: 404, ok: false, json() { assert.fail('404 skal ikke leses'); } }));
  assert.deepEqual(await gw2.get('/items', { bulk: true }), []);
  await assert.rejects(gw2.get('/account'));
});

test('GW2: mapLimit begrenser samtidighet og beholder rekkefølge', async () => {
  let active = 0, max = 0;
  const result = await gw2.mapLimit([1, 2, 3, 4, 5], 2, async value => { active++; max = Math.max(max, active); await turn(); active--; return value * 2; });
  assert.deepEqual(result, [2, 4, 6, 8, 10]); assert.equal(max, 2);
});
