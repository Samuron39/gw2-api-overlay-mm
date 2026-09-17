'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const path = require('path');
const os = require('os');
const { CacheWriter } = require('../src/cache-writer');
const turn = () => new Promise(setImmediate);

test('item-cache: mange endringer samles i én asynkron skriving', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const writes = []; let value = 0;
  const writer = new CacheWriter('test.json', () => String(value), { debounceMs: 40, io: { async writeFile(_p, data) { writes.push(data); }, async rename() {} } });
  for (value = 1; value <= 20; value++) writer.schedule();
  assert.deepEqual(writes, []);
  t.mock.timers.tick(40); await writer.flush();
  assert.deepEqual(writes, ['21']);
});

test('item-cache: ny snapshot venter på eldre skriving og blir siste gyldige fil', async () => {
  const events = []; let release, value = 1, active = 0, maximum = 0;
  const writer = new CacheWriter('test.json', () => String(value), { io: {
    async writeFile(_p, data) { active++; maximum = Math.max(maximum, active); events.push('write ' + data); if (data === '1') await new Promise(resolve => { release = resolve; }); active--; },
    async rename() { events.push('rename'); },
  } });
  writer.schedule(); const pending = writer.flush(); await turn();
  value = 2; writer.schedule(); const concurrent = writer.flush(); release();
  await Promise.all([pending, concurrent]);
  assert.deepEqual(events, ['write 1', 'rename', 'write 2', 'rename']); assert.equal(maximum, 1);
});

test('item-cache: mislykket rename bevarer originalen; flush kan prøve igjen før avslutning', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-cache-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const file = path.join(dir, 'items-cache.json'); fs.writeFileSync(file, '[1]');
  let fail = true;
  const writer = new CacheWriter(file, () => '[1,2]', { io: { writeFile: fs.promises.writeFile, rename: (...args) => { if (fail) throw new Error('EACCES'); return fs.promises.rename(...args); } } });
  writer.schedule(); await assert.rejects(writer.flush(), /EACCES/);
  assert.equal(fs.readFileSync(file, 'utf8'), '[1]');
  fail = false; await writer.flush(); assert.equal(fs.readFileSync(file, 'utf8'), '[1,2]');
});

test('GW2: flushCache lagrer siste hentede item uten å vente på debounce', async (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-items-test-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const gw2 = require('../src/gw2'); gw2.init(dir);
  t.mock.method(globalThis, 'fetch', async () => Response.json([{ id: 876543, name: 'Test-item' }]));
  const items = await gw2.fetchItems([876543]); assert.equal(items.get(876543).name, 'Test-item');
  await gw2.flushCache();
  assert.ok(JSON.parse(fs.readFileSync(path.join(dir, 'items-cache.json'), 'utf8')).some(item => item.id === 876543));
});
