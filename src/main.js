'use strict';
const { app, BrowserWindow, ipcMain, shell, clipboard, screen, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const gw2 = require('./gw2');
const inventory = require('./modules/inventory');
const timers = require('./modules/timers');
const dps = require('./modules/dps');
const daily = require('./modules/daily');
const tp = require('./modules/tp');
const characters = require('./modules/characters');
const guild = require('./modules/guild');
const arcdps = require('./modules/arcdps');
const live = require('./live');
const overlays = require('./overlays');
const skills = require('./modules/skills');
const { dialog, Tray, Menu, nativeImage } = require('electron');
const mumble = require('./mumble');
const ai = require('./ai');
const log = require('./log');

// Feil i hovedprosessen logges i stedet for å ta ned appen
process.on('uncaughtException', (e) => log.error('main', 'uncaughtException', e));
process.on('unhandledRejection', (e) => log.error('main', 'unhandledRejection', e));

// IPC-handler med logging: feil logges med kanalnavn og kastes videre til renderer
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try { return await fn(e, ...args); }
    catch (err) { log.error('ipc', channel + ': ' + (err?.message || err)); throw err; }
  });
}

const DEFAULT_CONFIG = {
  apiKey: '',
  lmUrl: 'http://localhost:1234/v1',
  lmModel: 'google/gemma-4-12b-qat', // liten nok til å ligge ved siden av spillet
  materialCap: 250,
  minTp: 100,
  keepList: [
    'Mystic Coin', 'Mystic Clover', 'Glob of Ectoplasm', 'Obsidian Shard', 'Pile of Bloodstone Dust',
    'Dragonite Ore', 'Empyreal Fragment', 'Amalgamated Gemstone', 'Charged Quartz', 'Mystic Forge Stone',
    'Black Lion', 'Tome of Knowledge', 'Writ of', 'Spirit Shard', 'Laurel', 'Provisioner Token',
    'Salvage Kit', 'Salvage-o-Matic', 'Gathering Sickle', 'Logging Axe', 'Mining Pick',
  ],
  wheel: { x: null, y: null, locked: false, size: 200 },
  panel: { x: null, y: null, width: 1000, height: 680, pinned: true, opacity: 0.95 },
  dpsLogDir: '',
  timersHidden: ['core-dn', 'eod-dn', 'voe-dn'], // dag/natt-syklusene er støy for de fleste
  autoHide: false, // skjul overlay når verken spillet eller overlayen har fokus
  launchAtStartup: false,
  wheelModules: null, // null = alle moduler på hjulet; ellers liste med id-er
  gw2Dir: '', // mappa med Gw2-64.exe, brukes til ArcDPS-installasjon
  followGame: false, // vis overlayen bare når Gw2-64.exe kjører (start med Windows + dette = starter med spillet)
  overlays: {}, // per overlay-vindu (buffs, debuffs, target, skillbar): posisjon, størrelse, utseende
  rotations: {}, // anbefalt rotasjon per karakter/spec: { "<nøkkel>": [{ skill, note }] }
};

const APP_VERSION = require('../package.json').version;
const DEMO = !!process.env.GW2_DEMO;
const TEST_MODE = !!process.env.GW2_SHOT;
app.setName('gw2-inventory-overlay'); // fast navn så konfig-mappa er den samme i utvikling og pakket versjon

if (TEST_MODE) {
  // Testkjøringer får egen userData så de aldri rører brukerens konfig
  app.setPath('userData', path.join(app.getPath('temp'), 'gw2-overlay-test'));
} else if (!app.requestSingleInstanceLock()) {
  // Én instans om gangen, ellers skriver de over hverandres konfig
  app.quit();
}

let configPath;
let config = { ...DEFAULT_CONFIG };
let wheelWin = null;
let panelWin = null;
let panelReady = null;
let currentModule = null;
let quitting = false;
let saveTimer = null;

function loadConfig() {
  try {
    const saved = JSON.parse(fs.readFileSync(configPath, 'utf8'));
    config = { ...DEFAULT_CONFIG, ...saved, wheel: { ...DEFAULT_CONFIG.wheel, ...(saved.wheel || {}) }, panel: { ...DEFAULT_CONFIG.panel, ...(saved.panel || {}) } };
  } catch { config = { ...DEFAULT_CONFIG }; }
  if (!config.lmModel) config.lmModel = DEFAULT_CONFIG.lmModel;
}
let lastSaveError = '';
function saveConfig() {
  try {
    const tmp = configPath + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(config, null, 2));
    fs.renameSync(tmp, configPath);
    lastSaveError = '';
  } catch (e) {
    lastSaveError = e.message;
    log.error('config', 'Kunne ikke lagre konfig: ' + configPath, e.message);
  }
}
function saveSoon() { clearTimeout(saveTimer); saveTimer = setTimeout(saveConfig, 400); }

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

const webPreferences = { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false };
const APP_ICON = path.join(__dirname, '..', 'assets', 'icon.png');

function createWheel() {
  const size = Math.max(140, Math.min(320, config.wheel.size || 200));
  const opts = {
    width: size, height: size + 34,
    transparent: true, frame: false, alwaysOnTop: true, resizable: false, skipTaskbar: true, hasShadow: false,
    title: 'GW2 Overlay', icon: APP_ICON, webPreferences,
  };
  if (config.wheel.x != null && config.wheel.y != null) Object.assign(opts, clampToScreen(config.wheel.x, config.wheel.y, opts.width, opts.height));
  wheelWin = new BrowserWindow(opts);
  wheelWin.setAlwaysOnTop(true, 'screen-saver');
  wheelWin.setMenuBarVisibility(false);
  wheelWin.loadFile(path.join(__dirname, 'renderer', 'wheel.html'));
  wheelWin.on('moved', () => { const [x, y] = wheelWin.getPosition(); config.wheel.x = x; config.wheel.y = y; saveSoon(); });
  wheelWin.on('closed', () => { wheelWin = null; if (!quitting) { quitting = true; app.quit(); } });
}

function createPanel() {
  const p = config.panel;
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
  const saveBounds = () => { const b = panelWin.getBounds(); Object.assign(config.panel, { x: b.x, y: b.y, width: b.width, height: b.height }); saveSoon(); };
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

function applyConfig(prev) {
  if (panelWin) {
    if (prev.panel.pinned !== config.panel.pinned) panelWin.setAlwaysOnTop(!!config.panel.pinned, 'screen-saver');
    if (prev.panel.opacity !== config.panel.opacity) panelWin.setOpacity(Number(config.panel.opacity) || 1);
  }
  if (prev.wheel.locked !== config.wheel.locked) broadcast('wheel:locked', { locked: !!config.wheel.locked });
  if (prev.dpsLogDir !== config.dpsLogDir) startDpsWatch();
  if (prev.launchAtStartup !== config.launchAtStartup && !TEST_MODE) {
    app.setLoginItemSettings({ openAtLogin: !!config.launchAtStartup, path: process.execPath, args: [path.resolve(__dirname, '..')] });
  }
  broadcast('config:changed', publicConfig());
}

function publicConfig() { return { ...config, demo: DEMO, dpsDefaultDir: dps.DEFAULT_DIR, configPath, lastSaveError }; }

function startDpsWatch() {
  const dir = config.dpsLogDir || dps.DEFAULT_DIR;
  dps.watch(dir, (r) => broadcast('dps:new', r));
}

// ---------- IPC ----------
handle('config:get', () => publicConfig());
handle('config:set', (_e, patch) => {
  const prev = JSON.parse(JSON.stringify(config));
  const { wheel, panel, ...rest } = patch || {};
  Object.assign(config, rest);
  if (wheel) Object.assign(config.wheel, wheel);
  if (panel) Object.assign(config.panel, panel);
  saveConfig();
  applyConfig(prev);
  return publicConfig();
});

handle('inv:refresh', () => inventory.refresh(config, DEMO));
const progress = (p) => broadcast('ai:progress', p);
handle('ai:models', () => ai.listModels(config));
handle('ai:prioritize', () => inventory.prioritize(config, { onProgress: progress }));
handle('ai:chat', (_e, history) => inventory.chat(config, history, { onProgress: progress }));

handle('timers:data', () => timers.getData());
handle('daily:get', (_e, force) => { if (force) daily.invalidate(); return daily.fetchDaily(config.apiKey); });
handle('gw2:maps', (_e, ids) => gw2.fetchMaps(ids));
handle('mumble:get', () => mumble.state);

handle('dps:list', () => ({ dir: config.dpsLogDir || dps.DEFAULT_DIR, exists: fs.existsSync(config.dpsLogDir || dps.DEFAULT_DIR), logs: dps.listLogs(config.dpsLogDir || dps.DEFAULT_DIR) }));
handle('dps:parse', (_e, file) => dps.parseLog(file));
handle('dps:upload', (_e, file) => dps.upload(file));
handle('tp:get', (_e, force) => { if (force) tp.invalidate(); return tp.fetchTp(config.apiKey); });
handle('chars:get', (_e, force) => { if (force) characters.invalidate(); return characters.fetchCharacters(config.apiKey); });
handle('chars:review', (_e, name) => characters.review(config, name, dps, config.dpsLogDir || dps.DEFAULT_DIR));
handle('guild:get', (_e, force) => { if (force) guild.invalidate(); return guild.fetchGuilds(config.apiKey); });
handle('arc:status', () => arcdps.status(config.gw2Dir));
handle('arc:install', async () => {
  const dir = arcdps.isGameDir(config.gw2Dir) ? config.gw2Dir : await arcdps.detectDir();
  if (!dir) throw new Error('Velg spillmappa under Innstillinger først.');
  return arcdps.install(dir);
});
handle('arc:uninstall', () => arcdps.uninstall(config.gw2Dir));
handle('arc:installBridge', async () => {
  const dir = arcdps.isGameDir(config.gw2Dir) ? config.gw2Dir : await arcdps.detectDir();
  if (!dir) throw new Error('Velg spillmappa under Innstillinger først.');
  return arcdps.installBridge(dir);
});
handle('live:get', () => live.snapshot());
handle('overlays:get', () => overlays.getAll());
handle('overlays:set', (_e, type, patch) => { const r = overlays.set(type, patch); saveConfig(); return r; });
handle('skills:get', (_e, opts) => skills.getSkillbar(config, live.snapshot(), mumble.state, opts || {}));
handle('skills:setRotation', (_e, key, rotation) => { config.rotations = config.rotations || {}; config.rotations[key] = rotation; saveConfig(); overlays.broadcast('skills:changed', { key }); return true; });
handle('skills:suggest', (_e, key) => skills.suggestRotation(config, key, { onProgress: progress }));
handle('gw2:detectDir', async () => { const d = await arcdps.detectDir(); if (d && !config.gw2Dir) { config.gw2Dir = d; saveConfig(); } return d; });
handle('gw2:pickDir', async () => {
  const r = await dialog.showOpenDialog(panelWin, { title: 'Velg mappa der Gw2-64.exe ligger', properties: ['openDirectory'], defaultPath: config.gw2Dir || 'C:\\' });
  if (r.canceled || !r.filePaths[0]) return null;
  const dir = r.filePaths[0];
  if (!arcdps.isGameDir(dir)) throw new Error('Fant ikke Gw2-64.exe i den mappa.');
  return dir;
});
handle('wheel:ignoreMouse', (_e, ignore) => { if (wheelWin && !wheelWin.isDestroyed()) wheelWin.setIgnoreMouseEvents(!!ignore, { forward: true }); });
handle('app:setStartup', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: [path.resolve(__dirname, '..')] }); return app.getLoginItemSettings().openAtLogin; });

handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
// Lim inn tekst i spillets chat: kopier, gi GW2 fokus, Enter (hvis chatten ikke allerede er åpen), Ctrl+V.
handle('game:paste', (_e, text) => new Promise((resolve) => {
  clipboard.writeText(String(text));
  if (!mumble.state?.running) return resolve({ ok: false, reason: 'NOGAME' });
  const args = [app.isPackaged ? path.join(process.resourcesPath, 'helpers', 'sendchat.py') : path.join(__dirname, 'helpers', 'sendchat.py')];
  if (mumble.state?.ui?.textboxFocus) args.push('--no-enter');
  const { execFile } = require('child_process');
  execFile(process.platform === 'win32' ? 'python' : 'python3', args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
    const out = String(stdout || '').trim();
    if (err && !out) return resolve({ ok: false, reason: 'NOPYTHON' });
    resolve({ ok: out === 'OK', reason: out || 'UKJENT' });
  });
}));
handle('open:wiki', (_e, name) => shell.openExternal('https://wiki.guildwars2.com/wiki/Special:Search?search=' + encodeURIComponent(name)));
handle('open:url', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

handle('panel:open', (_e, id) => openModule(id));
handle('panel:show', (_e, id) => openModule(id, { toggle: false }));
handle('panel:close', () => { if (panelWin) { panelWin.hide(); broadcast('panel:visible', { visible: false, module: currentModule }); } });
handle('panel:state', () => ({ visible: !!panelWin?.isVisible(), module: currentModule }));
handle('wheel:setLocked', (_e, locked) => { const prev = JSON.parse(JSON.stringify(config)); config.wheel.locked = !!locked; saveConfig(); applyConfig(prev); return config.wheel.locked; });
handle('app:quit', () => { quitting = true; app.quit(); });

// Feilsøking: loggmappe og feilrapport (uten hemmeligheter) til utklippstavla
handle('log:open', async () => { const r = await shell.openPath(log.path()); if (r) throw new Error(r); return log.path(); });
handle('log:report', () => {
  const os = require('os');
  const SECRET = /key|token|secret|passw/i; // nøkler i konfigen som aldri skal med i rapporten
  const safe = JSON.parse(JSON.stringify(config, (k, v) => (k && SECRET.test(k) ? undefined : v)));
  const gw2Dir = config.gw2Dir || '';
  const arcInstalled = !!gw2Dir && fs.existsSync(path.join(gw2Dir, 'd3d11.dll'));
  let bridge = null;
  try { bridge = arcdps.bridgeStatus(gw2Dir); } catch (e) { bridge = { error: e.message }; }
  const snap = live.snapshot();
  const lines = [
    'GW2 Overlay feilrapport',
    'Tid: ' + new Date().toISOString(),
    'App-versjon: ' + APP_VERSION + (app.isPackaged ? ' (pakket)' : ' (utvikling)'),
    'Electron: ' + process.versions.electron + ', Chrome: ' + process.versions.chrome + ', Node: ' + process.versions.node,
    'OS: ' + os.type() + ' ' + os.release() + ' (' + process.getSystemVersion() + ') ' + process.arch,
    'Konfigsti: ' + configPath,
    'Loggmappe: ' + log.path(),
    'Demo: ' + DEMO + ', testmodus: ' + TEST_MODE,
    'API-nøkkel: ' + (config.apiKey ? 'satt' : 'ikke satt'),
    'Moduler på hjulet: ' + (config.wheelModules ? config.wheelModules.join(', ') : 'alle'),
    'Spillmappe: ' + (gw2Dir || '(ikke satt)') + (gw2Dir ? (arcdps.isGameDir(gw2Dir) ? ' (Gw2-64.exe funnet)' : ' (Gw2-64.exe ikke funnet)') : ''),
    'ArcDPS installert: ' + (arcInstalled ? 'ja' : 'nei'),
    'Bro: ' + JSON.stringify(bridge),
    'Live: connected=' + snap.connected + ', arcVersion=' + (snap.arcVersion || '-') + ', inCombat=' + snap.inCombat,
    'MumbleLink: running=' + !!mumble.state?.running + (mumble.state?.error ? ', feil=' + mumble.state.error : ''),
    '',
    '--- Konfig (uten hemmeligheter) ---',
    JSON.stringify(safe, null, 2),
    '',
    '--- Siste 200 logglinjer ---',
    ...log.tail(200),
  ];
  const text = lines.join('\n');
  clipboard.writeText(text);
  return text;
});

// ---------- Oppstart ----------
app.whenReady().then(async () => {
  configPath = path.join(app.getPath('userData'), 'config.json');
  log.init(app);
  log.info('app', 'Start', { version: APP_VERSION, electron: process.versions.electron, node: process.versions.node, platform: process.platform + ' ' + process.arch, os: process.getSystemVersion(), configPath, packaged: app.isPackaged, demo: DEMO, testMode: TEST_MODE });
  loadConfig();
  gw2.init(app.getPath('userData'));
  createWheel();
  createPanel();
  // Auto-skjul: når verken spillet eller overlayen har fokus i 2 s, skjul; vis igjen når spillet får fokus
  let hiddenByAuto = false, panelWasVisible = false, hideTimer = null;
  const overlayFocused = () => [wheelWin, panelWin].some((w) => w && !w.isDestroyed() && w.isFocused());
  mumble.on('state', (s) => {
    broadcast('mumble:state', s);
    if (!config.autoHide || TEST_MODE) return;
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
  mumble.start();
  startDpsWatch();

  // Live-data fra ArcDPS-broen og de små overlay-vinduene (buffs, debuffs, target, skill-bar)
  overlays.init({ config, webPreferences, icon: APP_ICON, saveSoon, testMode: TEST_MODE });
  live.on('update', (snap) => { broadcast('live:state', snap); overlays.broadcast('live:state', snap); });
  live.start();
  mumble.on('state', (s) => overlays.broadcast('mumble:state', s));

  // Hurtigtast: vis/skjul panelet med siste modul
  globalShortcut.register('CommandOrControl+Shift+G', () => openModule(currentModule || 'inventory'));

  // Systemstatusfelt: appen kan ligge skjult og vente på spillet
  let tray = null;
  try {
    const iconPath = path.join(__dirname, '..', 'assets', 'tray.png');
    tray = new Tray(nativeImage.createFromPath(iconPath));
    tray.setToolTip('GW2 Overlay');
    tray.setContextMenu(Menu.buildFromTemplate([
      { label: 'Vis hjulet', click: () => { wheelWin?.show(); } },
      { label: 'Åpne panel', click: () => openModule(currentModule || 'inventory', { toggle: false }) },
      { label: 'Innstillinger', click: () => openModule('settings', { toggle: false }) },
      { type: 'separator' },
      { label: 'Avslutt', click: () => { quitting = true; app.quit(); } },
    ]));
    tray.on('click', () => { if (wheelWin?.isVisible()) wheelWin.hide(); else wheelWin?.show(); });
  } catch (e) { console.error('Tray:', e.message); }

  // Følg spillet: vis hjulet når Gw2-64.exe kjører, skjul når det avsluttes
  let gameWasRunning = null;
  const pollGame = async () => {
    if (!config.followGame || TEST_MODE) return;
    const running = await arcdps.gameRunning();
    if (running === gameWasRunning) return;
    gameWasRunning = running;
    if (running) { wheelWin?.showInactive(); }
    else { wheelWin?.hide(); panelWin?.hide(); }
  };
  if (config.followGame && !TEST_MODE) { if (!(await arcdps.gameRunning())) { wheelWin?.hide(); gameWasRunning = false; } else gameWasRunning = true; }
  setInterval(pollGame, 5000);

  // Første gang: åpne innstillinger og finn spillmappa
  if (!config.apiKey && !TEST_MODE && !DEMO) {
    if (!config.gw2Dir) { const d = await arcdps.detectDir(); if (d) { config.gw2Dir = d; saveConfig(); } }
    openModule('settings', { toggle: false });
  }

  if (process.env.GW2_SHOT) {
    // Testkrok: åpne en modul, vent, ta skjermbilde og avslutt
    const target = process.env.GW2_SHOT_MODULE || 'wheel';
    let win = target === 'wheel' ? wheelWin : panelWin;
    if (process.env.GW2_SHOT_OVERLAY) {
      win = overlays.ensure(process.env.GW2_SHOT_OVERLAY, { locked: process.env.GW2_SHOT_LOCKED === '1', ...JSON.parse(process.env.GW2_SHOT_PATCH || '{}') });
      await new Promise((resolve) => win.webContents.once('did-finish-load', resolve));
    }
    for (const w of [wheelWin, panelWin]) w.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg));
    if (process.env.GW2_SHOT_SIZE) { const [w, h] = process.env.GW2_SHOT_SIZE.split('x').map(Number); panelWin.setSize(w, h); }
    if (target !== 'wheel') await openModule(target, { toggle: false });
    await new Promise((r) => setTimeout(r, Number(process.env.GW2_SHOT_WAIT || 2500)));
    if (process.env.GW2_SHOT_EVAL) console.log('[eval]', JSON.stringify(await win.webContents.executeJavaScript(process.env.GW2_SHOT_EVAL)));
    const img = await win.webContents.capturePage();
    fs.writeFileSync(process.env.GW2_SHOT, img.toPNG());
    quitting = true;
    app.quit();
  }
});

app.on('before-quit', () => { quitting = true; mumble.stop(); log.info('app', 'Avslutter'); });

// Renderer-feil fra alle vinduer (hjul, panel, overlay-vinduer) i loggen
app.on('web-contents-created', (_e, wc) => {
  wc.on('console-message', (ev, level, message, line, sourceId) => {
    const lvl = ev?.level ?? level;
    if (lvl !== 3 && lvl !== 'error') return;
    const src = ev?.sourceId ?? sourceId, ln = ev?.lineNumber ?? line;
    log.error('renderer', String(ev?.message ?? message), src ? path.basename(String(src)) + ':' + ln : undefined);
  });
  wc.on('render-process-gone', (_ev, details) => log.error('renderer', 'Renderer-prosess borte', details));
});
app.on('window-all-closed', () => app.quit());
