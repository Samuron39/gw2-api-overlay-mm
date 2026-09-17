'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { EventEmitter } = require('node:events');
const { LogArchive } = require('../src/log-archive');
const { logBuffer } = require('./helpers/evtc-fixture');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function until(pred) { for (let i = 0; i < 100; i++) { if (pred()) return; await wait(10); } assert.fail('Operasjonen fullførte ikke'); }

async function fixture(t, options = {}) {
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gw2-log-test-'));
  const archive = new LogArchive(options);
  t.after(async () => {
    await archive.dispose();
    assert.ok(path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) && path.basename(dir).startsWith('gw2-log-test-'));
    await fs.promises.rm(dir, { recursive: true, force: true });
  });
  const file = path.join(dir, 'fight.evtc'); await fs.promises.writeFile(file, logBuffer());
  return { archive, dir, file };
}

test('asynkron indeks finner nyeste filer i vilkårlige dyp og begrenser IO', async t => {
  let concurrent = 0, peak = 0, reads = 0;
  const io = { ...fs.promises, stat: async (...args) => { concurrent++; peak = Math.max(peak, concurrent); try { await wait(1); return await fs.promises.stat(...args); } finally { concurrent--; } }, readdir: async (...args) => { reads++; return fs.promises.readdir(...args); } };
  const { archive, dir } = await fixture(t, { io, ioConcurrency: 3 });
  const deep = path.join(dir, 'one', 'two', 'three', 'four', 'five', 'six'); await fs.promises.mkdir(deep, { recursive: true });
  await Promise.all(Array.from({ length: 20 }, async (_, i) => { const file = path.join(deep, `${i}.evtc`); await fs.promises.writeFile(file, ''); await fs.promises.utimes(file, 10000 + i, 10000 + i); }));
  const newest = path.join(deep, 'newest.ZEVTC'); await fs.promises.writeFile(newest, ''); await fs.promises.utimes(newest, 2000000000, 2000000000);
  const [a, b] = await Promise.all([archive.listLogs(dir, 3), archive.listLogs(dir, 5)]);
  assert.equal(a[0].file, newest); assert.equal(a.length, 3); assert.equal(b.length, 5); assert.ok(peak <= 3);
  const firstReads = reads; await archive.listLogs(dir); assert.equal(reads, firstReads, 'gyldig cache unngår ny traversering');
  archive.invalidate(dir); await archive.listLogs(dir); assert.ok(reads > firstReads);
});

test('ekte worker parser logg mens hovedtråden svarer og invaliderer endret fil', async t => {
  const { archive, file } = await fixture(t);
  let beats = 0; const interval = setInterval(() => beats++, 1); t.after(() => clearInterval(interval));
  await fs.promises.writeFile(file, logBuffer(50000));
  const a = await archive.parseLog(file);
  assert.equal(a.players[0].dmgTarget, 5000000); assert.ok(beats > 0, 'heartbeat svarer under worker-arbeid');
  const b = await archive.parseLog(file); assert.equal(a, b, 'uendret fil deler cache');
  await fs.promises.writeFile(file, logBuffer(2));
  assert.equal((await archive.parseLog(file)).players[0].dmgTarget, 200);
  await fs.promises.writeFile(file, logBuffer().subarray(0, -1));
  await assert.rejects(archive.parseLog(file), /ufullstendig/);
});

function controlledWorkers() {
  const workers = [];
  return { workers, createWorker: () => {
    const w = new EventEmitter(); w.postMessage = message => { w.input = message; }; w.terminate = async () => { w.terminated = true; };
    workers.push(w); return w;
  } };
}

test('samtidige kall deler worker; én avbrytelse rammer ikke den andre', async t => {
  const control = controlledWorkers(); const { archive, file } = await fixture(t, control);
  const abort = new AbortController();
  const a = archive.parseLog(file, { signal: abort.signal }); const b = archive.parseLog(file);
  await until(() => archive.jobs.values().next().value?.clients === 2);
  assert.equal(control.workers.length, 1);
  abort.abort(); await assert.rejects(a, { name: 'AbortError' });
  assert.notEqual(control.workers[0].terminated, true);
  control.workers[0].emit('message', { result: { file, players: [] } });
  assert.equal((await b).file, file); assert.equal(control.workers[0].terminated, true);
});

test('worker-kø er begrenset, avbrutt køjobb slettes og feil frigjør neste jobb', async t => {
  const control = controlledWorkers(); const { archive, dir, file } = await fixture(t, { ...control, workerConcurrency: 1, queueLimit: 2 });
  const second = path.join(dir, 'second.evtc'), third = path.join(dir, 'third.evtc');
  await fs.promises.writeFile(second, logBuffer()); await fs.promises.writeFile(third, logBuffer());
  const abort = new AbortController();
  const a = archive.parseLog(file); const aRejected = assert.rejects(a, /worker feilet/);
  const b = archive.parseLog(second, { signal: abort.signal }); const bRejected = assert.rejects(b, { name: 'AbortError' });
  await until(() => archive.jobs.size === 2);
  await assert.rejects(archive.parseLog(third), /For mange logger/);
  abort.abort(); await bRejected;
  const c = archive.parseLog(third); await until(() => archive.jobs.size === 2);
  control.workers[0].emit('error', new Error('worker feilet')); await aRejected;
  assert.equal(control.workers.length, 2); assert.equal(control.workers[1].input.file, third);
  control.workers[1].emit('message', { result: { file: third, players: [] } }); await c;
  assert.equal(archive.jobs.size, 0);
});

test('worker uten svar stoppes ved tidsgrensen og neste forsøk kan kjøre', async t => {
  const control = controlledWorkers(); const { archive, file } = await fixture(t, { ...control, workerTimeoutMs: 20 });
  await assert.rejects(archive.parseLog(file), /for lang tid/);
  assert.equal(control.workers[0].terminated, true); assert.equal(archive.active, 0);
});

function controlledWatchers() {
  const watchers = [];
  return { watchers, createWatcher: (dir, _options, callback) => {
    const watcher = new EventEmitter(); watcher.dir = dir; watcher.callback = callback; watcher.close = () => { watcher.closed = true; watcher.emit('close'); };
    watchers.push(watcher); return watcher;
  } };
}

test('watcher gjenopprettes når mappa kommer tilbake, error håndteres, gammelt svar forkastes', async t => {
  const watchers = controlledWatchers(), workers = controlledWorkers();
  const { archive, dir, file } = await fixture(t, { ...watchers, ...workers, retryMs: 10, stableMs: 5 });
  const missing = path.join(dir, 'missing'), output = [];
  archive.watch(missing, r => output.push(r));
  await wait(20); assert.equal(watchers.watchers.length, 0);
  await fs.promises.mkdir(missing); await until(() => watchers.watchers.length === 1);
  watchers.watchers[0].emit('error', new Error('disk borte'));
  await until(() => watchers.watchers.length === 2); assert.equal(watchers.watchers[0].closed, true);
  archive.watch(dir, r => output.push(r)); await until(() => watchers.watchers.length === 3);
  watchers.watchers[2].callback('change', path.basename(file));
  await until(() => workers.workers.length === 1);
  archive.watch(missing, r => output.push(r));
  workers.workers[0].emit('message', { result: { file, players: [] } });
  await wait(20); assert.equal(output.length, 0); assert.equal(workers.workers[0].terminated, true);
  archive.stopWatching(); assert.equal(archive.currentDir, null);
});

test('watcher prøver igjen etter ufullstendig fil og leverer kun stabilt resultat', async t => {
  const control = controlledWatchers(); const { archive, dir, file } = await fixture(t, { ...control, retryMs: 5, stableMs: 10 });
  const output = []; archive.watch(dir, r => output.push(r)); await until(() => control.watchers.length === 1);
  await fs.promises.writeFile(file, logBuffer().subarray(0, -1)); control.watchers[0].callback('change', path.basename(file));
  await wait(50); await fs.promises.writeFile(file, logBuffer(3)); control.watchers[0].callback('change', path.basename(file));
  await until(() => output.length === 1); assert.equal(output[0].players[0].dmgTarget, 300);
});

test('ekte filwatcher leverer ny logg og stopp rydder native watcher', async t => {
  const { archive, dir } = await fixture(t, { stableMs: 5 });
  const output = []; archive.watch(dir, r => output.push(r));
  await until(() => !!archive.watching?.watcher);
  await fs.promises.writeFile(path.join(dir, 'new.evtc'), logBuffer(4));
  await until(() => output.some(r => r.players[0]?.dmgTarget === 400));
  archive.stopWatching(); assert.equal(archive.currentDir, null);
});

test('dispose mens stat venter oppretter ingen worker eller hengende køjobb', async t => {
  const control = controlledWorkers(); const { archive, file } = await fixture(t, control);
  let release;
  archive.io = { ...fs.promises, stat: file => new Promise(resolve => { release = async () => resolve(await fs.promises.stat(file)); }) };
  const result = archive.parseLog(file); await archive.dispose(); await release();
  await assert.rejects(result, { name: 'AbortError' });
  assert.equal(control.workers.length, 0); assert.equal(archive.jobs.size, 0);
});
