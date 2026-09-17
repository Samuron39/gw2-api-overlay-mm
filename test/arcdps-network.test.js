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
