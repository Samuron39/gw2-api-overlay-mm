'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { deferred } = require('./helpers/renderer');

test('Worldboss-oppslaget deler pågående forespørsler, cacher og fornyer over midnatt', async () => {
  let now = Date.UTC(2026, 8, 17, 23, 59, 55), requests = 0;
  const pending = deferred();
  const ctx = { module: { exports: {} }, Date: class extends Date { static now() { return now; } }, require: (id) => {
    if (id === '../gw2') return { get: (endpoint) => { assert.equal(endpoint, '/account/worldbosses'); requests++; return requests === 1 ? pending.promise : Promise.resolve([]); } };
    if (id === '../i18n') return { t: String };
    if (id === '../renderer/timer-logic') return require('../src/renderer/timer-logic');
    throw Error(id);
  } };
  vm.runInNewContext(fs.readFileSync(require.resolve('../src/modules/daily'), 'utf8'), ctx);
  const { fetchWorldbosses } = ctx.module.exports;
  const a = fetchWorldbosses('FAKE'), b = fetchWorldbosses('FAKE');
  assert.equal(requests, 1);
  pending.resolve(['drakkar']);
  const [ra, rb] = await Promise.all([a, b]); assert.equal(ra, rb);
  assert.equal(await fetchWorldbosses('FAKE'), ra); assert.equal(requests, 1);
  now += 10000; await fetchWorldbosses('FAKE'); assert.equal(requests, 2);
  await fetchWorldbosses('FAKE', { force: true }); assert.equal(requests, 3);
});
