'use strict';
// Alle IPC-handlere i hovedprosessen, gruppert per modul. Kanalene må også stå i allowlisten i preload.js.
const { app, ipcMain, shell, clipboard, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const cfg = require('./config');
const win = require('./windows');
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
const updater = require('./updater');
const mumble = require('./mumble');
const ai = require('./ai');
const log = require('./log');
const i18n = require('./i18n');

const { DEMO, TEST_MODE } = cfg;
const { t } = i18n;
const APP_VERSION = require('../package.json').version;

// IPC-handler med logging: feil logges med kanalnavn og kastes videre til renderer
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try { return await fn(e, ...args); }
    catch (err) { log.error('ipc', channel + ': ' + (err?.message || err)); throw err; }
  });
}

function register() {
  const { broadcast, openModule } = win;

  // ---------- Konfig ----------
  handle('config:get', () => cfg.publicConfig());
  handle('config:set', (_e, patch) => {
    const config = cfg.config;
    const prev = JSON.parse(JSON.stringify(config));
    const { wheel, panel, ...rest } = patch || {};
    Object.assign(config, rest);
    if (wheel) Object.assign(config.wheel, wheel);
    if (panel) Object.assign(config.panel, panel);
    cfg.saveConfig();
    win.applyConfig(prev);
    return cfg.publicConfig();
  });
  // Ordboka for valgt språk (lagt oppå nb) pluss lista over språk som finnes i src/i18n/
  handle('i18n:get', () => i18n.bundle());

  // ---------- Inventory og AI ----------
  handle('inv:refresh', () => inventory.refresh(cfg.config, DEMO));
  const progress = (p) => broadcast('ai:progress', p);
  handle('ai:models', () => ai.listModels(cfg.config));
  handle('ai:prioritize', () => inventory.prioritize(cfg.config, { onProgress: progress }));
  handle('ai:chat', (_e, history) => inventory.chat(cfg.config, history, { onProgress: progress }));

  // ---------- Tidsplan, I dag, kart, MumbleLink ----------
  handle('timers:data', () => timers.getData());
  handle('daily:get', (_e, force) => { if (force) daily.invalidate(); return daily.fetchDaily(cfg.config.apiKey); });
  handle('gw2:maps', (_e, ids) => gw2.fetchMaps(ids));
  handle('mumble:get', () => mumble.state);

  // ---------- DPS ----------
  handle('dps:list', () => { const dir = cfg.config.dpsLogDir || dps.DEFAULT_DIR; return { dir, exists: fs.existsSync(dir), logs: dps.listLogs(dir) }; });
  handle('dps:parse', (_e, file) => dps.parseLog(file));
  handle('dps:upload', (_e, file) => dps.upload(file));

  // ---------- Trading Post, karakterer, guild ----------
  handle('tp:get', (_e, force) => { if (force) tp.invalidate(); return tp.fetchTp(cfg.config.apiKey); });
  handle('chars:get', (_e, force) => { if (force) characters.invalidate(); return characters.fetchCharacters(cfg.config.apiKey); });
  handle('chars:review', (_e, name) => characters.review(cfg.config, name, dps, cfg.config.dpsLogDir || dps.DEFAULT_DIR));
  handle('guild:get', (_e, force) => { if (force) guild.invalidate(); return guild.fetchGuilds(cfg.config.apiKey); });

  // ---------- ArcDPS og broen ----------
  handle('arc:status', () => arcdps.status(cfg.config.gw2Dir));
  handle('arc:install', async () => {
    const dir = arcdps.isGameDir(cfg.config.gw2Dir) ? cfg.config.gw2Dir : await arcdps.detectDir();
    if (!dir) throw new Error(t('main.pickGameDirFirst'));
    return arcdps.install(dir);
  });
  handle('arc:uninstall', () => arcdps.uninstall(cfg.config.gw2Dir));
  handle('arc:installBridge', async () => {
    const dir = arcdps.isGameDir(cfg.config.gw2Dir) ? cfg.config.gw2Dir : await arcdps.detectDir();
    if (!dir) throw new Error(t('main.pickGameDirFirst'));
    return arcdps.installBridge(dir);
  });

  // ---------- Live, overlay-vinduer, skill-bar ----------
  handle('live:get', () => live.snapshot());
  handle('overlays:get', () => overlays.getAll());
  handle('overlays:set', (_e, type, patch) => { const r = overlays.set(type, patch); cfg.saveConfig(); return r; });
  handle('skills:get', (_e, opts) => skills.getSkillbar(cfg.config, live.snapshot(), mumble.state, opts || {}));
  handle('skills:setRotation', (_e, key, rotation) => { const config = cfg.config; config.rotations = config.rotations || {}; config.rotations[key] = rotation; cfg.saveConfig(); overlays.broadcast('skills:changed', { key }); return true; });
  handle('skills:suggest', (_e, key) => skills.suggestRotation(cfg.config, key, { onProgress: progress }));
  handle('skills:icons', async (_e, ids) => { const { byId } = await skills.fetchIndex(); const out = {}; for (const id of ids || []) if (byId[id]?.icon) out[id] = byId[id].icon; return out; }); // ikon-URL per skill-id, for effekter uten lokalt ikon

  // ---------- Spillmappe ----------
  handle('gw2:detectDir', async () => { const d = await arcdps.detectDir(); if (d && !cfg.config.gw2Dir) { cfg.config.gw2Dir = d; cfg.saveConfig(); } return d; });
  handle('gw2:pickDir', async () => {
    const r = await dialog.showOpenDialog(win.panelWin, { title: t('main.pickDirTitle'), properties: ['openDirectory'], defaultPath: cfg.config.gw2Dir || 'C:\\' });
    if (r.canceled || !r.filePaths[0]) return null;
    const dir = r.filePaths[0];
    if (!arcdps.isGameDir(dir)) throw new Error(t('main.notGameDir'));
    return dir;
  });

  // ---------- Hjul, oppstart, utklippstavle, spillchat, lenker ----------
  // Manuell flytting av hjul og overlay-vinduer: start husker vindusposisjon og pekerens skjermposisjon, move flytter relativt
  const drags = new Map();
  handle('win:drag', (e, d) => {
    const w = d?.target === 'wheel' ? win.wheelWin : overlays.get(d?.target);
    if (!w || w.isDestroyed()) return false;
    if (d.phase === 'start') { const b = w.getBounds(); drags.set(e.sender.id, { x: b.x, y: b.y, w: b.width, h: b.height, px: d.x, py: d.y }); return true; }
    // Posisjon og størrelse settes sammen: setPosition alene lar Windows med DPI-skalering avrunde størrelsen opp for hver flytting
    if (d.phase === 'move') { const s = drags.get(e.sender.id); if (!s) return false; w.setBounds({ x: Math.round(s.x + (d.x - s.px)), y: Math.round(s.y + (d.y - s.py)), width: s.w, height: s.h }); return true; }
    drags.delete(e.sender.id); w.emit('moved'); return true;
  });
  handle('wheel:ignoreMouse', (_e, ignore) => { const w = win.wheelWin; if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(!!ignore, { forward: true }); });
  handle('app:setStartup', (_e, on) => { app.setLoginItemSettings({ openAtLogin: !!on, path: process.execPath, args: app.isPackaged ? [] : [path.resolve(__dirname, '..')] }); return app.getLoginItemSettings().openAtLogin; });

  handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
  // Lim inn tekst i spillets chat: kopier, gi GW2 fokus, Enter (hvis chatten ikke allerede er åpen), Ctrl+V.
  handle('game:paste', (_e, text) => new Promise((resolve) => {
    clipboard.writeText(String(text));
    if (mumble.state?.error) return resolve({ ok: false, reason: 'NOHELPER' }); // hjelperen kunne ikke startes: si det, ikke "spillet kjører ikke"
    if (!mumble.state?.running) return resolve({ ok: false, reason: 'NOGAME' });
    const args = ['paste'];
    if (mumble.state?.ui?.textboxFocus) args.push('--no-enter');
    const { execFile } = require('child_process');
    execFile(mumble.helperPath(), args, { timeout: 5000, windowsHide: true }, (err, stdout) => {
      const out = String(stdout || '').trim();
      if (err && !out) return resolve({ ok: false, reason: 'NOHELPER' });
      resolve({ ok: out === 'OK', reason: out || 'UKJENT' });
    });
  }));
  handle('open:wiki', (_e, name) => shell.openExternal('https://wiki.guildwars2.com/wiki/Special:Search?search=' + encodeURIComponent(name)));
  handle('open:url', (_e, url) => { if (/^https?:\/\//.test(url)) shell.openExternal(url); });

  // ---------- Panel og app ----------
  handle('panel:open', (_e, id) => openModule(id));
  handle('panel:show', (_e, id) => openModule(id, { toggle: false }));
  handle('panel:close', () => win.closePanel());
  handle('panel:state', () => win.panelState());
  handle('wheel:setLocked', (_e, locked) => { const config = cfg.config; const prev = JSON.parse(JSON.stringify(config)); config.wheel.locked = !!locked; cfg.saveConfig(); win.applyConfig(prev); return config.wheel.locked; });
  handle('app:quit', () => { win.setQuitting(); app.quit(); });
  handle('app:hide', () => { win.wheelWin?.hide(); win.panelWin?.hide(); }); // ligger i systemstatusfeltet og venter på spillet

  // ---------- Feilsøking: loggmappe og feilrapport (uten hemmeligheter) til utklippstavla ----------
  handle('log:open', async () => { const r = await shell.openPath(log.path()); if (r) throw new Error(r); return log.path(); });
  handle('log:report', () => {
    const os = require('os');
    const config = cfg.config;
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
      'Konfigsti: ' + cfg.configPath,
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

  // ---------- Oppdatering: manuell sjekk fra Innstillinger, og installer nedlastet versjon (avslutter og starter på nytt) ----------
  handle('update:check', () => updater.check());
  handle('update:install', () => { const ok = updater.install(); if (ok) win.setQuitting(); return ok; });
}

module.exports = { register, handle };
