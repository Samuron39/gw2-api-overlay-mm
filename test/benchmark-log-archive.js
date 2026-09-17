'use strict';
// Manuell måling: GW2_DEMO=1 node test/benchmark-log-archive.js. Bruker bare egne temp-filer.
// Sammenligner gammel hovedtrådsimplementasjon fra 0.4.4 med async indeks/worker i samme prosess/maskin.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const vm = require('node:vm');
const zlib = require('node:zlib');
const { execFileSync } = require('node:child_process');
const { createRequire } = require('node:module');
const { Worker } = require('node:worker_threads');
const { LogArchive } = require('../src/log-archive');
const { logBuffer } = require('./helpers/evtc-fixture');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const round = n => Math.round(n * 10) / 10;

async function measure(label, operation) {
  let started = Infinity, ended = Infinity, peakRss = process.memoryUsage().rss, beats = 0, maxGap = 0, last = Date.now();
  const messages = [];
  const pulse = new Worker(`const {parentPort}=require('worker_threads'); parentPort.postMessage('ready'); setInterval(()=>parentPort.postMessage(Date.now()),10);`, { eval: true });
  await new Promise(resolve => pulse.once('message', resolve));
  pulse.on('message', sent => { if (typeof sent === 'number') messages.push({ sent, latency: Date.now() - sent }); });
  const timer = setInterval(() => { const now = Date.now(); maxGap = Math.max(maxGap, now - last); last = now; beats++; peakRss = Math.max(peakRss, process.memoryUsage().rss); }, 5);
  try {
    await wait(20); maxGap = 0; beats = 0; last = Date.now(); started = Date.now();
    const result = await operation(); ended = Date.now(); peakRss = Math.max(peakRss, process.memoryUsage().rss);
    await wait(25);
    const delays = messages.filter(m => m.sent >= started && m.sent <= ended).map(m => m.latency).sort((a, b) => a - b);
    return { label, totalMs: ended - started, heartbeatMaxGapMs: maxGap, heartbeats: beats, ipcP95Ms: delays[Math.min(delays.length - 1, Math.floor(delays.length * .95))] || 0, ipcMaxMs: Math.max(0, ...delays), peakRssMiB: round(peakRss / 1048576), resultCount: Array.isArray(result) ? result.length : result.players?.length };
  } finally { clearInterval(timer); await pulse.terminate(); }
}

async function main() {
  if (process.env.GW2_DEMO !== '1') throw new Error('Kjør med GW2_DEMO=1');
  const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'gw2-log-benchmark-'));
  const archive = new LogArchive();
  try {
    const legacyCode = execFileSync('git', ['show', '4887e3e:src/modules/dps.js'], { encoding: 'utf8' });
    const legacyModule = { exports: {} };
    vm.runInNewContext(legacyCode, { module: legacyModule, exports: legacyModule.exports, require: createRequire(path.resolve('src/modules/dps.js')), setTimeout, clearTimeout, FormData, Blob, fetch });
    const legacy = legacyModule.exports;
    const index = path.join(dir, 'archive'); await fs.promises.mkdir(index);
    for (let batch = 0; batch < 100; batch++) {
      const folder = path.join(index, String(batch)); await fs.promises.mkdir(folder);
      await Promise.all(Array.from({ length: 100 }, (_, i) => fs.promises.writeFile(path.join(folder, `${i}.evtc`), '')));
    }
    const raw = logBuffer(1000000), file = path.join(dir, 'large.evtc'); await fs.promises.writeFile(file, raw);
    const compressed = zlib.deflateRawSync(raw), header = Buffer.alloc(30); header.writeUInt32LE(0x04034b50); header.writeUInt16LE(8, 8); header.writeUInt32LE(compressed.length, 18);
    const zipped = path.join(dir, 'large.zevtc'); await fs.promises.writeFile(zipped, Buffer.concat([header, compressed]));
    const before = [await measure('før: 10000 loggfiler', () => legacy.listLogs(index)), await measure('før: 1000000 hendelser + dekomprimering', () => legacy.parseLog(zipped))];
    const maxGapTargetMs = Math.max(50, Math.min(...before.map(r => r.heartbeatMaxGapMs)) / 2);
    const ipcTargetMs = Math.max(50, Math.min(...before.map(r => r.ipcMaxMs)) / 2);
    const after = [await measure('etter: 10000 loggfiler', () => archive.listLogs(index)), await measure('etter: 1000000 hendelser + dekomprimering', () => archive.parseLog(zipped))];
    console.log(JSON.stringify({ node: process.version, platform: process.platform, entries: 10000, rawMiB: round(raw.length / 1048576), compressedMiB: round(compressed.length / 1048576), targetsFromBaseline: { heartbeatMaxGapMs: round(maxGapTargetMs), ipcMaxMs: round(ipcTargetMs) }, before, after, responsive: after.every(r => r.heartbeatMaxGapMs <= maxGapTargetMs && r.ipcMaxMs <= ipcTargetMs) }, null, 2));
  } finally {
    await archive.dispose();
    if (!path.resolve(dir).startsWith(path.resolve(os.tmpdir()) + path.sep) || !path.basename(dir).startsWith('gw2-log-benchmark-')) throw new Error('Ugyldig oppryddingssti');
    await fs.promises.rm(dir, { recursive: true, force: true });
  }
}
main().catch(error => { console.error(error); process.exitCode = 1; });
