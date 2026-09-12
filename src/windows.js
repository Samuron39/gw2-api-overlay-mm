'use strict';
// Vinduene i hovedprosessen: hjulet, panelet, systemstatusfeltet, auto-skjul og «følg spillet».
// Holder vindus-tilstanden (wheelWin, panelWin, currentModule, quitting) og gir broadcast() til begge vinduene.
const { app, BrowserWindow, screen, Tray, Menu, nativeImage } = require('electron');
const path = require('path');
const cfg = require('./config');
const dps = require('./modules/dps');
const mumble = require('./mumble');
const arcdps = require('./modules/arcdps');
const overlays = require('./overlays');
const i18n = require('./i18n');

const { TEST_MODE } = cfg;
const { t } = i18n;
const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.png');

let wheelWin = null;
let panelWin = null;
let panelReady = null;
let currentModule = null;
let quitting = false;

function broadcast(channel, payload) {
  for (const w of [wheelWin, panelWin]) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

function clampToScreen(x, y, w, h) {
  const disp = screen.getDisplayNearestPoint({ x: x ?? 0, y: y ?? 0 }).workArea;
  return {
    x: Math.min(Math.max(x, disp.x), disp.x + disp.width - w),
    y: Math.min(Math.max(y, disp.y), disp.y + disp.height - h),
  };
}

function createWheel() {
  const config = cfg.config;
  const size = Math.max(140, Math.min(320, config.wheel.size || 200));
  const opts = {
    width: size, height: size + 34,
    transparent: true, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true, hasShadow: false,
    title: 'GW2 Overlay', icon: APP_ICON, webPreferences,
  };
  if (config.wheel.x != null && config.wheel.y != null) Object.assign(opts, clampToScreen(config.wheel.x, config.wheel.y, opts.width, opts.height));
  wheelWin = new BrowserWindow(opts);
  wheelWin.setMinimumSize(opts.width, opts.height); wheelWin.setMaximumSize(opts.width, opts.height); // fast størrelse uansett DPI-avrunding
  wheelWin.setAlwaysOnTop(true, 'screen-saver');
  wheelWin.setMenuBarVisibility(false);
  wheelWin.loadFile(path.join(__dirname, 'renderer', 'wheel.html'));
  wheelWin.on('moved', () => { const [x, y] = wheelWin.getPosition(); cfg.config.wheel.x = x; cfg.config.wheel.y = y; cfg.saveSoon(); });
  wheelWin.on('closed', () => { wheelWin = null; if (!quitting) { quitting = true; app.quit(); } });
}

function createPanel() {
  const p = cfg.config.panel;
  const opts = {
    width: p.width, height: p.height, minWidth: 480, minHeight: 320,
    frame: false, show: false, alwaysOnTop: !!p.pinned, skipTaskbar: true,
    backgroundColor: '#121417', opacity: p.opacity ?? 0.95, title: 'GW2 Overlay-panel', icon: APP_ICON, webPreferences,
  };
  if (p.x != null && p.y != null) Object.assign(opts, clampToScreen(p.x, p.y, p.width, p.height));
  panelWin = new BrowserWindow(opts);
  panelWin.setAlwaysOnTop(!!p.pinned, 'screen-saver');
  panelWin.setMenuBarVisibility(false);
  panelReady = new Promise((resolve) => panelWin.webContents.once('did-finish-load', resolve));
  panelWin.loadFile(path.join(__dirname, 'renderer', 'panel.html'));
  const saveBounds = () => { const b = panelWin.getBounds(); Object.assign(cfg.config.panel, { x: b.x, y: b.y, width: b.width, height: b.height }); cfg.saveSoon(); };
  panelWin.on('moved', saveBounds);
  panelWin.on('resized', saveBounds);
  panelWin.on('close', (e) => { if (!quitting) { e.preventDefault(); panelWin.hide(); broadcast('panel:visible', { visible: false, module: currentModule }); } });
}

async function openModule(id, { toggle = true } = {}) {
  if (!panelWin) return;
  if (toggle && panelWin.isVisible() && currentModule === id) {
    panelWin.hide();
    broadcast('panel:visible', { visible: false, module: currentModule });
    return;
  }
  currentModule = id;
  const config = cfg.config;
  if (config.panel.x == null && wheelWin) {
    const wb = wheelWin.getBounds();
    const pos = clampToScreen(wb.x + wb.width + 8, wb.y, config.panel.width, config.panel.height);
    panelWin.setPosition(pos.x, pos.y);
  }
  await panelReady;
  panelWin.webContents.send('panel:module', { id });
  if (!panelWin.isVisible()) panelWin.show();
  broadcast('panel:visible', { visible: true, module: id });
}

function closePanel() {
  if (panelWin) { panelWin.hide(); broadcast('panel:visible', { visible: false, module: currentModule }); }
}

function panelState() { return { visible: !!panelWin?.isVisible(), module: currentModule }; }

// Etter at konfigen er endret (config:set, wheel:setLocked): oppdater vinduene der noe relevant er endret
function applyConfig(prev) {
  const config = cfg.config;
  if (panelWin) {
    if (prev.panel.pinned !== config.panel.pinned) panelWin.setAlwaysOnTop(!!config.panel.pinned, 'screen-saver');
    if (prev.panel.opacity !== config.panel.opacity) panelWin.setOpacity(Number(config.panel.opacity) || 1);
  }
  if (prev.wheel.locked !== config.wheel.locked) broadcast('wheel:locked', { locked: !!config.wheel.locked });
  if (prev.dpsLogDir !== config.dpsLogDir) startDpsWatch();
  if (prev.launchAtStartup !== config.launchAtStartup && !TEST_MODE) {
    app.setLoginItemSettings({ openAtLogin: !!config.launchAtStartup, path: process.execPath, args: [path.resolve(__dirname, '..')] });
  }
  const languageChanged = prev.language !== config.language;
  if (languageChanged) { i18n.setLanguage(config.language); setTrayMenu(); }
  broadcast('config:changed', cfg.publicConfig());
  if (languageChanged) overlays.broadcast('config:changed', cfg.publicConfig()); // overlay-vinduene henter ny ordbok
}

function startDpsWatch() {
  const dir = cfg.config.dpsLogDir || dps.DEFAULT_DIR;
  dps.watch(dir, (r) => broadcast('dps:new', r));
}

// Auto-skjul: når verken spillet eller overlayen har fokus i 2 s, skjul; vis igjen når spillet får fokus
function setupAutoHide() {
  let hiddenByAuto = false, panelWasVisible = false, hideTimer = null;
  const overlayFocused = () => [wheelWin, panelWin].some((w) => w && !w.isDestroyed() && w.isFocused());
  mumble.on('state', (s) => {
    broadcast('mumble:state', s);
    if (!cfg.config.autoHide || TEST_MODE) return;
    const gameFocus = !!(s.running && s.ui?.gameFocus);
    if (!gameFocus && !overlayFocused()) {
      if (!hideTimer && !hiddenByAuto) hideTimer = setTimeout(() => {
        hideTimer = null;
        if (overlayFocused() || (mumble.state.running && mumble.state.ui?.gameFocus)) return;
        panelWasVisible = !!panelWin?.isVisible();
        wheelWin?.hide(); panelWin?.hide(); hiddenByAuto = true;
      }, 2000);
    } else {
      if (hideTimer) { clearTimeout(hideTimer); hideTimer = null; }
      if (hiddenByAuto && gameFocus) { hiddenByAuto = false; wheelWin?.showInactive(); if (panelWasVisible) panelWin?.showInactive(); }
    }
  });
}

// Systemstatusfelt: appen kan ligge skjult og vente på spillet
let tray = null;
function setTrayMenu() {
  if (!tray) return;
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: t('tray.showWheel'), click: () => { wheelWin?.show(); } },
    { label: t('tray.openPanel'), click: () => openModule(currentModule || 'inventory', { toggle: false }) },
    { label: t('tray.settings'), click: () => openModule('settings', { toggle: false }) },
    { type: 'separator' },
    { label: t('tray.quit'), click: () => { quitting = true; app.quit(); } },
  ]));
}
function createTray() {
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip('GW2 Overlay');
    setTrayMenu();
    tray.on('click', () => { if (wheelWin?.isVisible()) wheelWin.hide(); else wheelWin?.show(); });
  } catch (e) { console.error('Tray:', e.message); }
}

// Følg spillet: vis hjulet når Gw2-64.exe kjører, skjul når det avsluttes
async function startFollowGame() {
  let gameWasRunning = null;
  const pollGame = async () => {
    if (!cfg.config.followGame || TEST_MODE) return;
    const running = await arcdps.gameRunning();
    if (running === gameWasRunning) return;
    gameWasRunning = running;
    if (running) { wheelWin?.showInactive(); }
    else { wheelWin?.hide(); panelWin?.hide(); }
  };
  if (cfg.config.followGame && !TEST_MODE) { if (!(await arcdps.gameRunning())) { wheelWin?.hide(); gameWasRunning = false; } else gameWasRunning = true; }
  setInterval(pollGame, 5000);
}

function setQuitting() { quitting = true; }

module.exports = {
  webPreferences, APP_ICON,
  createWheel, createPanel, openModule, closePanel, panelState, broadcast, clampToScreen, applyConfig, startDpsWatch,
  setupAutoHide, createTray, startFollowGame, setQuitting,
  get wheelWin() { return wheelWin; },
  get panelWin() { return panelWin; },
  get currentModule() { return currentModule; },
  get quitting() { return quitting; },
};
