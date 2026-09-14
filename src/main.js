'use strict';
// Inngangspunkt for hovedprosessen: app-navn, testmodus, én instans, og oppstart av vinduer, IPC og bakgrunnstjenester.
// Konfig ligger i config.js, vinduene i windows.js, IPC-handlerne i ipc.js.
const { app, globalShortcut } = require('electron');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const win = require('./windows');
const ipc = require('./ipc');
const gw2 = require('./gw2');
const dps = require('./modules/dps');
const arcdps = require('./modules/arcdps');
const live = require('./live');
const overlays = require('./overlays');
const updater = require('./updater');
const mumble = require('./mumble');
const log = require('./log');
const { t } = require('./i18n');

// Feil i hovedprosessen logges i stedet for å ta ned appen
process.on('uncaughtException', (e) => log.error('main', 'uncaughtException', e));
process.on('unhandledRejection', (e) => log.error('main', 'unhandledRejection', e));

const APP_VERSION = require('../package.json').version;
const { DEMO, TEST_MODE } = cfg;
app.setName('gw2-inventory-overlay'); // fast navn så konfig-mappa er den samme i utvikling og pakket versjon

if (TEST_MODE) {
  // Testkjøringer får egen userData så de aldri rører brukerens konfig
  app.setPath('userData', path.join(app.getPath('temp'), 'gw2-overlay-test'));
} else if (!app.requestSingleInstanceLock()) {
  // Én instans om gangen, ellers skriver de over hverandres konfig
  app.quit();
}

ipc.register();

// ---------- Oppstart ----------
app.whenReady().then(async () => {
  cfg.init({
    path: path.join(app.getPath('userData'), 'config.json'),
    extra: () => ({ demo: DEMO, dpsDefaultDir: dps.DEFAULT_DIR, appVersion: app.getVersion() }),
    systemLocale: app.getLocale(),
  });
  log.init(app);
  log.info('app', 'Start', { version: APP_VERSION, electron: process.versions.electron, node: process.versions.node, platform: process.platform + ' ' + process.arch, os: process.getSystemVersion(), configPath: cfg.configPath, packaged: app.isPackaged, demo: DEMO, testMode: TEST_MODE });
  cfg.loadConfig();
  const config = cfg.config;
  gw2.init(app.getPath('userData'));
  require('./modules/guides').init(app.getPath('userData')); // cache for AI-utdrag: <userData>/guides/<id>.json
  win.createWheel();
  win.createPanel();
  win.setupAutoHide();
  mumble.start();
  win.startDpsWatch();

  // Live-data fra ArcDPS-broen og de små overlay-vinduene (buffs, debuffs, target, skill-bar)
  overlays.init({ config, webPreferences: win.webPreferences, icon: win.APP_ICON, saveSoon: cfg.saveSoon, testMode: TEST_MODE });
  live.on('update', (snap) => { win.broadcast('live:state', snap); overlays.broadcast('live:state', snap); });
  live.start();
  mumble.on('state', (s) => overlays.broadcast('mumble:state', s));

  // Hurtigtast: vis/skjul panelet med siste modul
  globalShortcut.register('CommandOrControl+Shift+G', () => win.openModule(win.currentModule || 'inventory'));

  // Automatisk oppdatering fra GitHub Releases (bare pakket app, aldri i testmodus). electron-updater logger til app.log med scope "update".
  const short = (x) => String(x?.message || x).split(String.fromCharCode(10))[0].split(String.fromCharCode(13)).join('').split(' Headers:')[0].slice(0, 300);
  const updLog = Object.fromEntries(['info', 'warn', 'error', 'debug'].map((lvl) => [lvl, (msg) => log[lvl]('update', short(msg))]));
  // Ny versjon lastet ned: popup fra systemstatusfeltet og Innstillinger åpnes (oppdateringskortet ligger øverst). Én gang per versjon.
  let notifiedVersion = null;
  const notifyUpdate = (s) => {
    if (s.status !== 'downloaded' || !s.version || notifiedVersion === s.version) return;
    notifiedVersion = s.version;
    win.showBalloon(t('update.readyTitle'), t('update.readyBody', { v: s.version }));
    win.openModule('settings', { toggle: false });
  };
  updater.init({ app, config, testMode: TEST_MODE, log: updLog, onStatus: (s) => { win.broadcast('update:status', s); notifyUpdate(s); } });

  win.createTray();
  // Sjekk for ny versjon hver gang spillet startes (i tillegg til ved oppstart og hver 6. time)
  await win.startFollowGame({ onGameStart: () => { if (config.autoUpdate !== false) { log.info('update', 'Spillet startet, sjekker for ny versjon'); updater.check().catch(() => {}); } } });

  // Første gang: finn spillmappa og åpne Kom i gang-veiviseren
  if (!TEST_MODE && !DEMO) {
    if (!config.gw2Dir) { const d = await arcdps.detectDir(); if (d) { config.gw2Dir = d; cfg.saveConfig(); log.info('app', 'Fant spillmappa', d); } }
    if (!config.setupDone) win.openModule('setup', { toggle: false });
    else if (!config.apiKey) win.openModule('settings', { toggle: false });
  }

  if (process.env.GW2_SHOT) {
    // Testkrok: åpne en modul, vent, ta skjermbilde og avslutt
    const target = process.env.GW2_SHOT_MODULE || 'wheel';
    const { wheelWin, panelWin } = win;
    let w = target === 'wheel' ? wheelWin : panelWin;
    if (process.env.GW2_SHOT_OVERLAY) {
      w = overlays.ensure(process.env.GW2_SHOT_OVERLAY, { locked: process.env.GW2_SHOT_LOCKED === '1', ...JSON.parse(process.env.GW2_SHOT_PATCH || '{}') });
      await new Promise((resolve) => w.webContents.once('did-finish-load', resolve));
    }
    for (const x of [wheelWin, panelWin]) x.webContents.on('console-message', (_e, _l, msg) => console.log('[renderer]', msg));
    if (process.env.GW2_SHOT_SIZE) { const [pw, ph] = process.env.GW2_SHOT_SIZE.split('x').map(Number); panelWin.setSize(pw, ph); }
    if (target !== 'wheel') await win.openModule(target, { toggle: false });
    await new Promise((r) => setTimeout(r, Number(process.env.GW2_SHOT_WAIT || 2500)));
    if (process.env.GW2_SHOT_EVAL) console.log('[eval]', JSON.stringify(await w.webContents.executeJavaScript(process.env.GW2_SHOT_EVAL)));
    const img = await w.webContents.capturePage();
    fs.writeFileSync(process.env.GW2_SHOT, img.toPNG());
    win.setQuitting();
    app.quit();
  }
});

app.on('before-quit', () => { win.setQuitting(); mumble.stop(); log.info('app', 'Avslutter'); });

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
