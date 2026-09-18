'use strict';
// ArcDPS-installasjon mot en midlertidig «spillmappe»: fremdrift, sjekken av at antivirus ikke fjerner fila etterpå,
// status når d3d11.dll er fjernet utenfra, og broen som alt er oppdatert. Ingen nett (fetch er mocket), ingen ekte spillmappe.
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const arcdps = require('../src/modules/arcdps');

const md5 = (buf) => crypto.createHash('md5').update(buf).digest('hex');
const notRunning = async () => false;

function gameDir(t) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'gw2-overlay-arc-'));
  fs.writeFileSync(path.join(dir, 'Gw2-64.exe'), '');
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  return dir;
}
// En «DLL»: MZ-hode og litt innhold
const DLL = Buffer.concat([Buffer.from('MZ'), crypto.randomBytes(200000)]);
function mockDownload(t) {
  t.mock.method(globalThis, 'fetch', async (url) => String(url).endsWith('.md5sum')
    ? new Response(md5(DLL) + '  d3d11.dll')
    : new Response(DLL, { headers: { 'content-length': String(DLL.length) } }));
}

test('install: melder nedlasting med mottatt/total, så verifisering, og fila blir liggende', async (t) => {
  const dir = gameDir(t); mockDownload(t);
  const seen = [];
  const r = await arcdps.install(dir, { onProgress: (p) => seen.push(p), verifyMs: 60, isRunning: notRunning });
  assert.equal(r.md5, md5(DLL)); assert.equal(r.size, DLL.length);
  assert.ok(fs.existsSync(path.join(dir, 'd3d11.dll')));
  const dl = seen.filter((p) => p.phase === 'download');
  assert.ok(dl.length >= 2, 'minst start og slutt');
  assert.deepEqual(dl[0], { phase: 'download', received: 0, total: DLL.length });
  assert.deepEqual(dl.at(-1), { phase: 'download', received: DLL.length, total: DLL.length });
  const verify = seen.filter((p) => p.phase === 'verify');
  assert.ok(verify.length >= 1 && verify[0].ms === 60 && verify[0].left > 0);
  assert.ok(seen.findIndex((p) => p.phase === 'verify') > seen.findIndex((p) => p.phase === 'download'), 'verifisering etter nedlasting');
});

test('install: fila fjernes rett etter installasjon (antivirus) gir egen feil med kode AV_REMOVED', async (t) => {
  const dir = gameDir(t); mockDownload(t);
  const target = path.join(dir, 'd3d11.dll');
  // «Defender»: sletter fila mens vi venter på at den skal bli liggende
  const onProgress = (p) => { if (p.phase === 'verify' && fs.existsSync(target)) fs.unlinkSync(target); };
  await assert.rejects(arcdps.install(dir, { onProgress, verifyMs: 1200, isRunning: notRunning }), (e) => {
    assert.equal(e.code, 'AV_REMOVED');
    assert.match(e.message, /antivirus/i);
    assert.ok(e.message.includes(target), 'sier hvilken fil');
    return true;
  });
});

test('verifyKept: byttet innhold regnes som fjernet, uendret fil godtas', async (t) => {
  const dir = gameDir(t); const f = path.join(dir, 'd3d11.dll');
  fs.writeFileSync(f, DLL);
  await arcdps.verifyKept(f, md5(DLL), 20);
  fs.writeFileSync(f, 'noe annet');
  await assert.rejects(arcdps.verifyKept(f, md5(DLL), 20), { code: 'AV_REMOVED' });
  await assert.rejects(arcdps.verifyKept(path.join(dir, 'finnes-ikke.dll'), md5(DLL), 20), { code: 'AV_REMOVED' });
});

test('install: spillet kjører gir vanlig feil uten nedlasting', async (t) => {
  const dir = gameDir(t); let calls = 0;
  t.mock.method(globalThis, 'fetch', async () => { calls++; return new Response(''); });
  await assert.rejects(arcdps.install(dir, { isRunning: async () => true }));
  assert.equal(calls, 0);
});

test('status: removedExternally når d3d11.dll mangler men broen eller arcdps.log finnes', async (t) => {
  t.mock.method(globalThis, 'fetch', async () => new Response('c'.repeat(32)));
  const fresh = gameDir(t);
  assert.equal((await arcdps.status(fresh)).removedExternally, false, 'aldri installert');
  const withBridge = gameDir(t);
  fs.writeFileSync(path.join(withBridge, 'arcdps_gw2overlay_bridge.dll'), 'bro');
  let s = await arcdps.status(withBridge);
  assert.equal(s.installed, false); assert.equal(s.removedExternally, true);
  const withLog = gameDir(t);
  fs.mkdirSync(path.join(withLog, 'addons', 'arcdps'), { recursive: true });
  fs.writeFileSync(path.join(withLog, 'addons', 'arcdps', 'arcdps.log'), 'info: build');
  assert.equal((await arcdps.status(withLog)).removedExternally, true);
  fs.writeFileSync(path.join(withLog, 'd3d11.dll'), DLL);
  s = await arcdps.status(withLog);
  assert.equal(s.installed, true); assert.equal(s.removedExternally, false, 'installert: ingen advarsel');
});

test('installBridge: changed er true første gang og false når fila alt er identisk (ingen kopiering)', async (t) => {
  const dir = gameDir(t);
  const source = path.join(dir, 'kilde.dll'); fs.writeFileSync(source, 'bro v1');
  const target = path.join(dir, 'arcdps_gw2overlay_bridge.dll');
  let r = await arcdps.installBridge(dir, { source, isRunning: notRunning });
  assert.deepEqual(r, { installed: true, target, changed: true });
  const mtime = fs.statSync(target).mtimeMs;
  r = await arcdps.installBridge(dir, { source, isRunning: notRunning });
  assert.equal(r.changed, false);
  assert.equal(fs.statSync(target).mtimeMs, mtime, 'fila ble ikke skrevet på nytt');
  fs.writeFileSync(source, 'bro v2');
  r = await arcdps.installBridge(dir, { source, isRunning: notRunning });
  assert.equal(r.changed, true); assert.equal(fs.readFileSync(target, 'utf8'), 'bro v2');
  await assert.rejects(arcdps.installBridge(dir, { source, isRunning: async () => true }));
});
