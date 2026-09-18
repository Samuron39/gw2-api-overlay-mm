'use strict';
// ArcDPS-håndtering: finn spillmappa, sjekk installert versjon mot utgiverens sjekksum, last ned og installer.
// ArcDPS kan ikke pakkes med appen (utgiveren tillater ikke videredistribusjon), så vi henter fra offisiell adresse.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { t } = require('../i18n');
const { request, delay, failure, LIMITS } = require('../network');

const ARC_URL = 'https://www.deltaconnected.com/arcdps/x64/d3d11.dll';
const ARC_MD5_URL = 'https://www.deltaconnected.com/arcdps/x64/d3d11.dll.md5sum';
const EXE = 'Gw2-64.exe';
// Så lenge ser vi etter at d3d11.dll blir liggende etter installasjon. 18. sept 2026 fjernet Windows Defender en nylagt
// kopi etter 7 s (Trojan:Win32/Posilod.CA!cl, feilflagging fra sky-maskinlæring), og appen sa bare «ikke installert».
const VERIFY_MS = 10000;

const CANDIDATES = [
  'C:\\Guild Wars 2', 'C:\\Program Files\\Guild Wars 2', 'C:\\Program Files (x86)\\Guild Wars 2',
  'C:\\Games\\Guild Wars 2', 'C:\\Spill\\Guild Wars 2', 'D:\\Guild Wars 2', 'D:\\Games\\Guild Wars 2',
  'D:\\Program Files\\Guild Wars 2', 'E:\\Guild Wars 2', 'E:\\Games\\Guild Wars 2',
];

function isGameDir(dir) { return !!dir && fs.existsSync(path.join(dir, EXE)); }

function gameRunning() {
  return new Promise((resolve) => {
    if (process.platform !== 'win32') return resolve(false);
    execFile('tasklist', ['/FI', `IMAGENAME eq ${EXE}`, '/NH', '/FO', 'CSV'], { windowsHide: true, timeout: 5000 }, (err, out) => {
      resolve(!err && String(out || '').toLowerCase().includes(EXE.toLowerCase()));
    });
  });
}

// Finn mappa: kjørende prosess, registeret, så vanlige plasseringer
async function detectDir() {
  if (process.platform === 'win32') {
    const fromProc = await new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-Command', `(Get-Process Gw2-64 -ErrorAction SilentlyContinue | Select-Object -First 1).Path`], { windowsHide: true, timeout: 8000 }, (err, out) => resolve(err ? '' : String(out || '').trim()));
    });
    if (fromProc && isGameDir(path.dirname(fromProc))) return path.dirname(fromProc);
    const fromReg = await new Promise((resolve) => {
      execFile('powershell', ['-NoProfile', '-Command', `(Get-ItemProperty 'HKCU:\\Software\\ArenaNet\\Guild Wars 2' -ErrorAction SilentlyContinue).Path`], { windowsHide: true, timeout: 8000 }, (err, out) => resolve(err ? '' : String(out || '').trim()));
    });
    if (fromReg) { const d = fromReg.toLowerCase().endsWith('.exe') ? path.dirname(fromReg) : fromReg; if (isGameDir(d)) return d; }
  }
  for (const d of CANDIDATES) if (isGameDir(d)) return d;
  return '';
}

function md5File(file) { return crypto.createHash('md5').update(fs.readFileSync(file)).digest('hex'); }

let md5Cache = null, md5Pending = null;
function remoteMd5({ force = false, signal } = {}) {
  if (signal?.aborted) return Promise.reject(failure('ABORT_ERR'));
  if (!force && md5Cache && Date.now() - md5Cache.at < 5 * 60000) return Promise.resolve(md5Cache.value);
  if (!force && !signal && md5Pending) return md5Pending;
  const pending = request(ARC_MD5_URL, { headers: { 'User-Agent': 'gw2-overlay' } }, { signal }, async (res, task) => {
    if (!res.ok) throw new Error(t('arcdps.md5Failed', { status: res.status }));
    const m = (await res.text()).trim().match(/^[0-9a-f]{32}/i);
    if (!m) throw new Error(t('arcdps.md5Format'));
    task.signal.throwIfAborted();
    const value = m[0].toLowerCase(); md5Cache = { at: Date.now(), value }; return value;
  });
  if (force || signal) return pending;
  md5Pending = pending.finally(() => { md5Pending = null; });
  return md5Pending;
}

async function status(gw2Dir, { signal } = {}) {
  if (signal?.aborted) throw failure('ABORT_ERR');
  const dir = isGameDir(gw2Dir) ? gw2Dir : await detectDir();
  const out = { gw2Dir: dir, validDir: isGameDir(dir), installed: false, localMd5: '', remoteMd5: '', updateAvailable: false, running: await gameRunning(), error: '' };
  if (signal?.aborted) throw failure('ABORT_ERR');
  if (!out.validDir) return out;
  const dll = path.join(dir, 'd3d11.dll');
  if (fs.existsSync(dll)) { out.installed = true; try { out.localMd5 = md5File(dll); } catch { /* låst */ } }
  // d3d11.dll mangler, men sporene etter ArcDPS ligger der (broen vår eller ArcDPS sin egen logg): den VAR installert og er
  // fjernet utenfra, nesten alltid av antivirus. Appen sier fra, men rører aldri antivirus-innstillinger selv.
  out.removedExternally = !out.installed && (fs.existsSync(bridgeTarget(dir)) || fs.existsSync(path.join(dir, 'addons', 'arcdps', 'arcdps.log')));
  try { out.remoteMd5 = await remoteMd5({ signal }); out.updateAvailable = out.installed && !!out.localMd5 && out.localMd5 !== out.remoteMd5; }
  catch (e) { if (signal?.aborted) throw failure('ABORT_ERR'); out.error = e.message; }
  out.bridge = bridgeStatus(dir);
  return out;
}

// onProgress får { phase: 'download', received, total } (total 0 = ukjent), så { phase: 'verify', ms, left } hvert halve
// sekund mens vi ser etter at fila blir liggende. isRunning og verifyMs kan byttes i tester.
async function install(gw2Dir, { onProgress = () => {}, verifyMs = VERIFY_MS, isRunning = gameRunning } = {}) {
  if (!isGameDir(gw2Dir)) throw new Error(t('arcdps.notGameDir'));
  if (await isRunning()) throw new Error(t('arcdps.gameRunning'));
  const expected = await remoteMd5({ force: true }); // fersk sum til selve installasjonen
  const buf = await request(ARC_URL, { headers: { 'User-Agent': 'gw2-overlay' } }, { timeoutMs: LIMITS.transferMs }, async (res, task) => {
    if (!res.ok) throw new Error(t('arcdps.downloadFailed', { status: res.status }));
    const total = Number(res.headers?.get?.('content-length')) || 0;
    const parts = []; let received = 0;
    onProgress({ phase: 'download', received, total });
    for await (const chunk of task.chunks(res.body)) { const b = Buffer.from(chunk); parts.push(b); received += b.length; onProgress({ phase: 'download', received, total }); }
    return Buffer.concat(parts);
  });
  const got = crypto.createHash('md5').update(buf).digest('hex');
  if (got !== expected) throw new Error(t('arcdps.md5Mismatch', { got, expected }));
  if (buf.length < 2 || buf.readUInt16LE(0) !== 0x5a4d) throw new Error(t('arcdps.notDll'));
  const target = path.join(gw2Dir, 'd3d11.dll');
  if (fs.existsSync(target)) {
    const backup = path.join(gw2Dir, 'd3d11.dll.bak');
    try { fs.copyFileSync(target, backup); } catch { /* ikke kritisk */ }
  }
  fs.writeFileSync(target + '.tmp', buf);
  fs.renameSync(target + '.tmp', target);
  await verifyKept(target, got, verifyMs, onProgress);
  return { installed: true, md5: got, size: buf.length, target };
}

// Blir fila liggende? Antivirus fjerner den typisk noen sekunder etter at den er skrevet, eller nekter lesing av den.
// Kaster en egen feil (code AV_REMOVED) som forklarer hva som skjedde, i stedet for at appen melder «installert» og
// ArcDPS likevel er borte ved neste spillstart.
async function verifyKept(target, md5, ms, onProgress = () => {}) {
  const gone = () => { const e = new Error(t('arcdps.removedByAntivirus', { file: target })); e.code = 'AV_REMOVED'; return e; };
  const until = Date.now() + ms;
  for (;;) {
    if (!fs.existsSync(target)) throw gone();
    const left = until - Date.now();
    if (left <= 0) break;
    onProgress({ phase: 'verify', ms, left });
    await delay(Math.min(500, left));
  }
  let now = '';
  try { now = md5File(target); } catch { throw gone(); } // Defender nekter lesing: «file contains a virus»
  if (now !== md5) throw gone();
}

// Vår egen ArcDPS-utvidelse (broen). Ligger i appen (bridge/target/release i utvikling, resources/bridge pakket).
function bridgeSource() {
  const { app } = require('electron');
  const packed = app?.isPackaged ? path.join(process.resourcesPath, 'bridge', 'gw2overlay_bridge.dll') : null;
  const dev = path.join(__dirname, '..', '..', 'bridge', 'target', 'release', 'gw2overlay_bridge.dll');
  if (packed && fs.existsSync(packed)) return packed;
  if (fs.existsSync(dev)) return dev;
  return '';
}
// ArcDPS laster utvidelser fra spillmappa (der d3d11.dll ligger), og filnavnet må inneholde "arcdps".
// addons\arcdps er bare for ini og logger; broen lå der før 0.2.3 og ble aldri lastet.
const BRIDGE_FILE = 'arcdps_gw2overlay_bridge.dll';
function bridgeTarget(gw2Dir) { return path.join(gw2Dir, BRIDGE_FILE); }
function legacyBridge(gw2Dir) { return path.join(gw2Dir, 'addons', 'arcdps', 'gw2overlay_bridge.dll'); }
function bridgeStatus(gw2Dir) {
  const src = bridgeSource();
  const target = isGameDir(gw2Dir) ? bridgeTarget(gw2Dir) : '';
  const installed = !!target && fs.existsSync(target);
  let upToDate = false;
  if (installed && src) { try { upToDate = md5File(src) === md5File(target); } catch { /* låst */ } }
  const legacy = isGameDir(gw2Dir) && fs.existsSync(legacyBridge(gw2Dir));
  return { available: !!src, installed, upToDate, target, legacy };
}
// changed = false når fila i spillmappa alt var identisk: da kopieres ingenting, og UI-et sier «allerede oppdatert».
async function installBridge(gw2Dir, { source = bridgeSource(), isRunning = gameRunning } = {}) {
  if (!isGameDir(gw2Dir)) throw new Error(t('arcdps.notGameDir'));
  const src = source;
  if (!src) throw new Error(t('arcdps.bridgeMissing'));
  if (await isRunning()) throw new Error(t('arcdps.gameRunningShort'));
  const target = bridgeTarget(gw2Dir);
  let same = false;
  try { same = fs.existsSync(target) && md5File(src) === md5File(target); } catch { /* låst: kopier på nytt */ }
  if (!same) {
    fs.copyFileSync(src, target + '.tmp');
    fs.renameSync(target + '.tmp', target);
  }
  try { fs.unlinkSync(legacyBridge(gw2Dir)); } catch { /* fantes ikke */ }
  return { installed: true, target, changed: !same };
}

function uninstall(gw2Dir) {
  const target = path.join(gw2Dir, 'd3d11.dll');
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return true;
}

module.exports = { detectDir, isGameDir, gameRunning, status, install, uninstall, bridgeStatus, installBridge, remoteMd5, verifyKept, ARC_URL };
