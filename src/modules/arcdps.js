'use strict';
// ArcDPS-håndtering: finn spillmappa, sjekk installert versjon mot utgiverens sjekksum, last ned og installer.
// ArcDPS kan ikke pakkes med appen (utgiveren tillater ikke videredistribusjon), så vi henter fra offisiell adresse.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { execFile } = require('child_process');
const { t } = require('../i18n');

const ARC_URL = 'https://www.deltaconnected.com/arcdps/x64/d3d11.dll';
const ARC_MD5_URL = 'https://www.deltaconnected.com/arcdps/x64/d3d11.dll.md5sum';
const EXE = 'Gw2-64.exe';

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

async function remoteMd5() {
  const res = await fetch(ARC_MD5_URL, { headers: { 'User-Agent': 'gw2-overlay' } });
  if (!res.ok) throw new Error(t('arcdps.md5Failed', { status: res.status }));
  const m = (await res.text()).trim().match(/^[0-9a-f]{32}/i);
  if (!m) throw new Error(t('arcdps.md5Format'));
  return m[0].toLowerCase();
}

async function status(gw2Dir) {
  const dir = isGameDir(gw2Dir) ? gw2Dir : await detectDir();
  const out = { gw2Dir: dir, validDir: isGameDir(dir), installed: false, localMd5: '', remoteMd5: '', updateAvailable: false, running: await gameRunning(), error: '' };
  if (!out.validDir) return out;
  const dll = path.join(dir, 'd3d11.dll');
  if (fs.existsSync(dll)) { out.installed = true; try { out.localMd5 = md5File(dll); } catch { /* låst */ } }
  try { out.remoteMd5 = await remoteMd5(); out.updateAvailable = out.installed && !!out.localMd5 && out.localMd5 !== out.remoteMd5; }
  catch (e) { out.error = e.message; }
  out.bridge = bridgeStatus(dir);
  return out;
}

async function install(gw2Dir) {
  if (!isGameDir(gw2Dir)) throw new Error(t('arcdps.notGameDir'));
  if (await gameRunning()) throw new Error(t('arcdps.gameRunning'));
  const expected = await remoteMd5();
  const res = await fetch(ARC_URL, { headers: { 'User-Agent': 'gw2-overlay' } });
  if (!res.ok) throw new Error(t('arcdps.downloadFailed', { status: res.status }));
  const buf = Buffer.from(await res.arrayBuffer());
  const got = crypto.createHash('md5').update(buf).digest('hex');
  if (got !== expected) throw new Error(t('arcdps.md5Mismatch', { got, expected }));
  if (buf.readUInt16LE(0) !== 0x5a4d) throw new Error(t('arcdps.notDll'));
  const target = path.join(gw2Dir, 'd3d11.dll');
  if (fs.existsSync(target)) {
    const backup = path.join(gw2Dir, 'd3d11.dll.bak');
    try { fs.copyFileSync(target, backup); } catch { /* ikke kritisk */ }
  }
  fs.writeFileSync(target + '.tmp', buf);
  fs.renameSync(target + '.tmp', target);
  return { installed: true, md5: got, size: buf.length, target };
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
function bridgeTarget(gw2Dir) { return path.join(gw2Dir, 'addons', 'arcdps', 'gw2overlay_bridge.dll'); }
function bridgeStatus(gw2Dir) {
  const src = bridgeSource();
  const target = isGameDir(gw2Dir) ? bridgeTarget(gw2Dir) : '';
  const installed = !!target && fs.existsSync(target);
  let upToDate = false;
  if (installed && src) { try { upToDate = md5File(src) === md5File(target); } catch { /* låst */ } }
  return { available: !!src, installed, upToDate, target };
}
async function installBridge(gw2Dir) {
  if (!isGameDir(gw2Dir)) throw new Error(t('arcdps.notGameDir'));
  const src = bridgeSource();
  if (!src) throw new Error(t('arcdps.bridgeMissing'));
  if (await gameRunning()) throw new Error(t('arcdps.gameRunningShort'));
  const target = bridgeTarget(gw2Dir);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(src, target + '.tmp');
  fs.renameSync(target + '.tmp', target);
  return { installed: true, target };
}

function uninstall(gw2Dir) {
  const target = path.join(gw2Dir, 'd3d11.dll');
  if (fs.existsSync(target)) fs.unlinkSync(target);
  return true;
}

module.exports = { detectDir, isGameDir, gameRunning, status, install, uninstall, bridgeStatus, installBridge, ARC_URL };
