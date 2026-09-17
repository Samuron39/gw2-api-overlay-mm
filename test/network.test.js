'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { request, delay } = require('../src/network');
const turn = () => new Promise(setImmediate);

test('request: tidsgrense gjelder både fetch og en hengende svarkropp', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const body of [false, true]) {
    let fetchSignal;
    const fetchImpl = (_url, opts) => { fetchSignal = opts.signal; return body ? { json: () => new Promise(() => {}) } : new Promise(() => {}); };
    const pending = request('https://test.invalid', {}, { timeoutMs: 20, fetchImpl });
    const rejected = assert.rejects(pending, { code: 'TIMEOUT' });
    await turn(); t.mock.timers.tick(20); await rejected;
    assert.equal(fetchSignal.aborted, true);
  }
});

test('request: avbrytelse gjelder bare den aktuelle forespørselen', async (t) => {
  const controller = new AbortController();
  let signalA, signalB;
  const a = request('https://test.invalid', {}, { signal: controller.signal, fetchImpl: (_u, o) => { signalA = o.signal; return new Promise(() => {}); } });
  const rejected = assert.rejects(a, { code: 'ABORT_ERR' });
  const b = request('https://test.invalid', {}, { fetchImpl: (_u, o) => { signalB = o.signal; return Response.json({ ok: true }); } });
  await turn(); controller.abort(); await rejected;
  assert.deepEqual(await b, { ok: true }); assert.equal(signalA.aborted, true); assert.equal(signalB.aborted, false);
});

test('request: vellykket svar fjerner tidsgrensen og ekstern avbruddslytter', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController(); let internal;
  assert.equal(await request('https://test.invalid', {}, { signal: controller.signal, timeoutMs: 10, fetchImpl: (_u, o) => { internal = o.signal; return Response.json(42); } }), 42);
  controller.abort(); t.mock.timers.tick(100);
  assert.equal(internal.aborted, false);
});

test('request: allerede avbrutt starter ikke fetch', async () => {
  const controller = new AbortController(); controller.abort();
  await assert.rejects(request('https://test.invalid', {}, { signal: controller.signal, fetchImpl: () => { assert.fail('fetch skal ikke starte'); } }), { code: 'ABORT_ERR' });
});

test('delay: venting kan avbrytes uten å vente på neste retry', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const controller = new AbortController();
  const pending = delay(60000, controller.signal);
  const rejected = assert.rejects(pending, { code: 'ABORT_ERR' });
  controller.abort(); await rejected;
});
