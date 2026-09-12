'use strict';
// Automatisk oppdatering via GitHub Releases (electron-updater).
// Sjekker 10 s etter oppstart og deretter hver 6. time, men bare når appen er pakket
// (installert) og ikke kjører i testmodus. I utvikling gjør check() ingen nettverkskall.
// Statusendringer går til onStatus-callbacken, som main.js kobler til broadcast('update:status').

const STARTUP_DELAY = 10 * 1000;
const INTERVAL = 6 * 60 * 60 * 1000;

let opts = null;
let autoUpdater = null;
let checking = null; // pågående checkForUpdates()
let state = { status: 'idle', version: null, percent: 0, error: '', appVersion: '' };

function set(patch) {
  state = { ...state, ...patch };
  try { opts?.onStatus?.(state); } catch (e) { opts?.log?.error?.('update: onStatus feilet: ' + e.message); }
  return state;
}

// Pakket app utenfor testmodus: da finnes app-update.yml og oppdatering gir mening
function enabled() { return !!opts?.app?.isPackaged && !opts.testMode; }

function autoAllowed() { return opts?.config?.autoUpdate !== false; }

function init(o) {
  opts = o;
  state.appVersion = o.app.getVersion();
  if (!enabled()) { state.status = 'dev'; return; }

  ({ autoUpdater } = require('electron-updater'));
  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;
  if (o.log) autoUpdater.logger = o.log;

  autoUpdater.on('checking-for-update', () => set({ status: 'checking', error: '' }));
  autoUpdater.on('update-available', (info) => set({ status: 'available', version: info?.version || null, percent: 0 }));
  autoUpdater.on('update-not-available', (info) => set({ status: 'not-available', version: info?.version || null }));
  autoUpdater.on('download-progress', (p) => set({ status: 'downloading', percent: Math.round(p?.percent || 0) }));
  autoUpdater.on('update-downloaded', (info) => set({ status: 'downloaded', version: info?.version || null, percent: 100 }));
  autoUpdater.on('error', (e) => set({ status: 'error', error: e?.message || String(e) }));

  // Sjekk ved oppstart og med faste mellomrom, så lenge brukeren ikke har slått det av
  const auto = () => { if (autoAllowed()) check().catch(() => {}); };
  setTimeout(auto, STARTUP_DELAY).unref?.();
  setInterval(auto, INTERVAL).unref?.();
}

// Manuell sjekk. Returnerer tilstanden etter sjekken; nedlastingen fortsetter i bakgrunnen.
async function check() {
  if (!enabled()) return { ...state, status: 'dev' };
  if (state.status === 'downloading' || state.status === 'downloaded') return state;
  if (checking) return checking;
  checking = (async () => {
    try {
      await autoUpdater.checkForUpdates();
    } catch (e) {
      set({ status: 'error', error: e?.message || String(e) });
    } finally {
      checking = null;
    }
    return state;
  })();
  return checking;
}

// Avslutt og installer den nedlastede oppdateringen. Appen startes på nytt etterpå.
function install() {
  if (!enabled() || state.status !== 'downloaded') return false;
  setImmediate(() => autoUpdater.quitAndInstall(false, true));
  return true;
}

function getState() { return state; }

module.exports = { init, check, install, getState };
