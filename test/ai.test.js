'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const ai = require('../src/ai');
const cfg = { lmUrl: 'http://localhost:1234/v1', lmModel: 'test-model' };
const turn = () => new Promise(setImmediate);
const event = (obj) => 'data: ' + JSON.stringify(obj) + '\n\n';
const delta = (text, extra = {}) => ({ choices: [{ delta: { content: text }, ...extra }] });
function reply(t, text, type = 'text/event-stream') { t.mock.method(globalThis, 'fetch', async () => new Response(text, { headers: { 'content-type': type } })); }

test('AI: delte UTF-8/SSE-pakker, reasoning, CRLF og avsluttende buffer', async (t) => {
  const bytes = new TextEncoder().encode(event({ choices: [{ delta: { reasoning_content: 'tenking' } }] }).replace(/\n/g, '\r\n') + event(delta('<think>skjult</think>Blåbær')) + 'data: [DONE]');
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(Uint8Array.of(byte)); c.close(); } }), { headers: { 'content-type': 'text/event-stream' } }));
  const progress = [];
  assert.equal(await ai.completeText(cfg, [], { onProgress: p => progress.push(p) }), 'Blåbær');
  assert.equal(progress[0].reasoning, 7); assert.ok(progress.at(-1).content > 0);
});

test('AI: normalt JSON-svar og stoppmarkør uten DONE godtas', async (t) => {
  reply(t, JSON.stringify({ choices: [{ message: { content: 'Hei' }, finish_reason: 'stop' }] }), 'application/json; charset=utf-8');
  assert.equal(await ai.completeText(cfg, []), 'Hei');
  globalThis.fetch = async () => new Response(event(delta('Svar', { finish_reason: 'stop' })));
  assert.equal(await ai.completeText(cfg, []), 'Svar');
});

test('AI: SSE-feil og HTTP-feil gjengir aldri rå feilkropp eller URL', async (t) => {
  const secret = 'FAKE_SENSITIVE_TEXT_FOR_TEST';
  reply(t, event({ error: { message: secret } }));
  const failsSafe = async () => assert.rejects(ai.completeText({ ...cfg, lmUrl: cfg.lmUrl + '?token=' + secret }, []), e => { assert.ok(!e.message.includes(secret)); return true; });
  await failsSafe();
  globalThis.fetch = async () => new Response(secret, { status: 401 }); await failsSafe();
  globalThis.fetch = async () => { throw new Error(secret); }; await failsSafe();
  globalThis.fetch = async () => new Response('event: error\ndata: ' + JSON.stringify({ message: secret }) + '\n\n'); await failsSafe();
});

test('AI: tomme, feilformede, trunkerte og lengdebegrensede svar avvises', async (t) => {
  reply(t, '');
  for (const text of [event(delta('halvt svar')), event({}) + 'data: [DONE]\n\n', event(delta('avkuttet', { finish_reason: 'length' })), 'data: {ugyldig}\n\n', event(delta('<think>uferdig')) + 'data: [DONE]\n\n']) {
    globalThis.fetch = async () => new Response(text);
    await assert.rejects(ai.completeText(cfg, []));
  }
});

test('AI: first-byte, inaktivitet og totalgrense er uavhengige og rydder strømmen', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  for (const mode of ['first', 'idle', 'total']) {
    let stream, cancelled = false, signal;
    t.mock.method(globalThis, 'fetch', async (_url, opts) => { signal = opts.signal; return new Response(new ReadableStream({ start(c) { stream = c; }, cancel() { cancelled = true; } })); });
    const pending = ai.completeText(cfg, [], { firstByteMs: 120, idleMs: 60, timeoutMs: 200 });
    const rejected = assert.rejects(pending, { code: 'TIMEOUT' });
    await turn();
    if (mode === 'first') t.mock.timers.tick(120);
    if (mode === 'idle') { stream.enqueue(new TextEncoder().encode(': heartbeat\n\n')); await turn(); t.mock.timers.tick(60); }
    if (mode === 'total') {
      for (let i = 0; i < 4; i++) { stream.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { reasoning_content: 'tenker' } }] }))); await turn(); t.mock.timers.tick(50); }
    }
    await rejected; await turn(); assert.equal(signal.aborted, true); assert.equal(cancelled, true);
  }
});

test('AI: lang reasoning holder strømmen aktiv; DONE avslutter også åpen forbindelse', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  let stream, cancelled = false;
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(c) { stream = c; }, cancel() { cancelled = true; } })));
  const pending = ai.completeText(cfg, [], { firstByteMs: 120, idleMs: 60, timeoutMs: 1000 });
  await turn();
  for (let i = 0; i < 5; i++) { stream.enqueue(new TextEncoder().encode(event({ choices: [{ delta: { reasoning_content: 'tenker' } }] }))); await turn(); t.mock.timers.tick(50); }
  stream.enqueue(new TextEncoder().encode(event(delta('Ferdig')) + 'data: [DONE]\n\n'));
  assert.equal(await pending, 'Ferdig'); assert.equal(cancelled, true);
});

test('AI: avbrutt prioritering og chat videresender signal og returnerer aldri delsvaret', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response(new ReadableStream({ start(c) { c.enqueue(new TextEncoder().encode(event(delta('halvt')))); } })));
  for (const invoke of [signal => ai.chat(cfg, { rows: [] }, [], { signal }), signal => ai.prioritize(cfg, { rows: [] }, { signal })]) {
    const controller = new AbortController(); const pending = invoke(controller.signal);
    const rejected = assert.rejects(pending, { code: 'ABORT_ERR' });
    await turn(); controller.abort(); await rejected;
  }
});

test('AI: manglende kontodata følger med som begrensning i konteksten', () => {
  assert.match(ai.buildContext({ rows: [], errors: ['dyes unavailable'] }), /dyes unavailable/);
});
