'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const arcdps = require('../src/modules/arcdps');

test('ArcDPS: fjernsjekksum deler pågående kall, caches og fornyes før installasjon', async (t) => {
  let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response('a'.repeat(32) + '  d3d11.dll'); });
  assert.deepEqual(await Promise.all([arcdps.remoteMd5(), arcdps.remoteMd5()]), ['a'.repeat(32), 'a'.repeat(32)]);
  assert.equal(calls, 1);
  await arcdps.remoteMd5(); assert.equal(calls, 1);
  await arcdps.remoteMd5({ force: true }); assert.equal(calls, 2);
});

test('ArcDPS: ugyldig sjekksum avvises', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('<html>error</html>'));
  await assert.rejects(arcdps.remoteMd5({ force: true }));
});

test('ArcDPS: avbrutt sjekksum påvirker ikke en annen forespørsel', async (t) => {
  const controller = new AbortController(); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return calls === 1 ? new Promise(() => {}) : new Response('b'.repeat(32)); });
  const a = arcdps.remoteMd5({ force: true, signal: controller.signal });
  const rejected = assert.rejects(a, { code: 'ABORT_ERR' });
  await new Promise(setImmediate);
  const b = arcdps.remoteMd5({ force: true }); controller.abort();
  await rejected; assert.equal(await b, 'b'.repeat(32));
  await assert.rejects(arcdps.remoteMd5({ signal: controller.signal }), { code: 'ABORT_ERR' });
});
