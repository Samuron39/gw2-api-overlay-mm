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
const setup = require('./modules/setup');
const live = require('./live');
const overlays = require('./overlays');
const skills = require('./modules/skills');
const guides = require('./modules/guides');
const updater = require('./updater');
const mumble = require('./mumble');
const ai = require('./ai');
const aiProviders = require('./ai-providers');
const log = require('./log');
const i18n = require('./i18n');
const secrets = require('./secrets');
const security = require('./security');
const { plain, safeKey, rotation: validateRotation } = require('./config-validation');

const { DEMO, TEST_MODE } = cfg;
const { t } = i18n;
const APP_VERSION = require('../package.json').version;
const TEST_BLOCKED = new Set(['arc:install', 'arc:installBridge', 'setup:installArc', 'gw2:detectDir', 'gw2:pickDir', 'game:paste', 'update:install', 'dps:upload']);
const aiTasks = new Map();
async function aiTask(event, options, run) {
  const requestId = typeof options?.requestId === 'string' && options.requestId.length <= 128 ? options.requestId : require('crypto').randomUUID();
  const key = event.sender.id + ':' + requestId;
  if (aiTasks.has(key)) throw new Error(t('ai.requestBusy'));
  const controller = new AbortController(); aiTasks.set(key, controller);
  const cancel = () => controller.abort();
  event.sender.once('destroyed', cancel);
  try {
    return await run({ signal: controller.signal, onProgress: (p) => {
      if (!event.sender.isDestroyed()) event.sender.send('ai:progress', { ...p, requestId });
    } });
  } finally { aiTasks.delete(key); event.sender.removeListener('destroyed', cancel); }
}

// IPC-handler med logging: feil logges med kanalnavn og kastes videre til renderer
function handle(channel, fn) {
  ipcMain.handle(channel, async (e, ...args) => {
    try {
      if (!security.trustedSender(e)) throw new Error(t('security.sender'));
      if (TEST_MODE && TEST_BLOCKED.has(channel)) throw new Error(t('security.testBlocked'));
      return await fn(e, ...args);
    }
    catch (err) {
      const message = secrets.redact(err?.message || err);
      log.error('ipc', channel + ': ' + message);
      throw new Error(message);
    }
  });
}

function register() {
  const { broadcast, openModule } = win;

  // ---------- Konfig ----------
  handle('config:get', () => cfg.publicConfig());
  handle('config:set', (_e, patch) => {
    const config = cfg.config;
    const prev = JSON.parse(JSON.stringify(config));
    cfg.applyPatch(patch);
    const saved = cfg.saveConfig();
    win.applyConfig(prev);
    if (!saved) throw new Error(cfg.lastSaveError);
    return cfg.publicConfig();
  });
  // Ordboka for valgt språk (lagt oppå nb) pluss lista over språk som finnes i src/i18n/
  handle('i18n:get', () => i18n.bundle());

  // ---------- Inventory og AI ----------
  handle('inv:refresh', () => inventory.refresh(cfg.config, DEMO));
  handle('ai:cancel', (e, requestId) => { const controller = aiTasks.get(e.sender.id + ':' + requestId); controller?.abort(); return !!controller; });
  handle('ai:models', () => ai.listModels(cfg.config));
  handle('ai:providers', () => ({ providers: aiProviders.list(), current: ai.describe(cfg.config) }));
  handle('ai:prioritize', (e, options) => aiTask(e, options, (opts) => inventory.prioritize(cfg.config, opts)));
  handle('ai:chat', (e, history, options) => aiTask(e, options, (opts) => inventory.chat(cfg.config, history, opts)));

  // ---------- Tidsplan, I dag, kart, MumbleLink ----------
  handle('timers:data', () => timers.getData());
  handle('daily:get', (_e, force) => { if (force) daily.invalidate(); return daily.fetchDaily(cfg.config.apiKey); });
  handle('daily:worldbosses', (_e, force) => daily.fetchWorldbosses(cfg.config.apiKey, { force: !!force }));
  handle('gw2:maps', (_e, ids) => gw2.fetchMaps(ids));
  handle('mumble:get', () => mumble.state);

  // ---------- Guider: bossliste og AI-utdrag fra wikien (chat-linjer limes inn via game:paste, lenka åpnes via open:url) ----------
  handle('guides:list', () => guides.list());
  handle('guides:get', (e, id, refresh, options) => aiTask(e, options, (opts) => guides.get(cfg.config, id, { ...opts, refresh: !!refresh })));

  // ---------- DPS ----------
  const logDir = () => cfg.config.dpsLogDir || (TEST_MODE ? path.join(app.getPath('userData'), 'evtc-test') : dps.DEFAULT_DIR);
  const checkedLog = (file) => { try { return security.logFile(logDir(), file); } catch { throw new Error(t('security.logPath')); } };
  handle('dps:list', async () => { const dir = logDir(); return { dir, exists: fs.existsSync(dir), logs: await dps.listLogs(dir) }; });
  handle('dps:parse', (_e, file) => dps.parseLog(checkedLog(file)));
  handle('dps:upload', (_e, file) => dps.upload(checkedLog(file)));

  // ---------- Trading Post, karakterer, guild ----------
  handle('tp:get', (_e, force) => { if (force) tp.invalidate(); return tp.fetchTp(cfg.config.apiKey); });
  handle('chars:get', (_e, force) => { if (force) characters.invalidate(); return characters.fetchCharacters(cfg.config.apiKey); });
  handle('chars:review', (e, name, options) => aiTask(e, options, (opts) => characters.review(cfg.config, name, dps, logDir(), opts)));
  handle('guild:get', (_e, force) => { if (force) guild.invalidate(); return guild.fetchGuilds(cfg.config.apiKey); });

  // ---------- ArcDPS og broen ----------
  handle('arc:status', () => arcdps.status(cfg.config.gw2Dir));
  // Fremdrift (nedlasting, antivirus-sjekk, bro) til vinduet som ba om installasjonen, så knappen kan vise en ekte linje
  const arcProgress = (e) => (p) => { if (!e.sender.isDestroyed()) e.sender.send('arc:progress', p); };
  handle('arc:install', async (e) => {
    const dir = arcdps.isGameDir(cfg.config.gw2Dir) ? cfg.config.gw2Dir : await arcdps.detectDir();
    if (!dir) throw new Error(t('main.pickGameDirFirst'));
    return arcdps.install(dir, { onProgress: arcProgress(e) });
  });
  handle('arc:installBridge', async () => {
    const dir = arcdps.isGameDir(cfg.config.gw2Dir) ? cfg.config.gw2Dir : await arcdps.detectDir();
    if (!dir) throw new Error(t('main.pickGameDirFirst'));
    return arcdps.installBridge(dir);
  });

  // ---------- Kom i gang-veiviseren ----------
  // Eierens konfig hadde fortsatt setupDone: false etter en uke i bruk, så veiviseren åpnet seg ved hver start. Når en sjekk
  // viser at alt påkrevd er på plass, regnes oppsettet som ferdig. Avhukingen «ikke vis igjen» virker som før begge veier.
  const finishSetup = (r) => {
    if (!TEST_MODE && !cfg.config.setupDone && setup.isComplete(r)) { cfg.config.setupDone = true; cfg.saveConfig(); win.broadcast('config:changed', cfg.publicConfig()); log.info('setup', 'Alt påkrevd er på plass, veiviseren åpnes ikke automatisk igjen'); }
    return r;
  };
  handle('setup:check', async () => finishSetup(await setup.check(cfg.config, TEST_MODE ? {
    gw2, arcdps: { isGameDir: () => false, detectDir: async () => '', gameRunning: async () => false },
    dps: { DEFAULT_DIR: path.join(app.getPath('userData'), 'test-logs'), listLogs: async () => [] },
    ai: { describe: () => ai.describe(cfg.config), listModels: async () => [] }, mumble: { state: { running: false } },
  } : { gw2, arcdps, dps, ai, mumble })));
  // ArcDPS og broen i ett: samme knapp i veiviseren
  handle('setup:installArc', async (e) => {
    const dir = arcdps.isGameDir(cfg.config.gw2Dir) ? cfg.config.gw2Dir : await arcdps.detectDir();
    if (!dir) throw new Error(t('main.pickGameDirFirst'));
    if (!cfg.config.gw2Dir) { cfg.config.gw2Dir = dir; cfg.saveConfig(); }
    const progress = arcProgress(e);
    const arc = await arcdps.install(dir, { onProgress: progress });
    progress({ phase: 'bridge' });
    const bridge = await arcdps.installBridge(dir);
    return { arc, bridge };
  });
  handle('setup:done', (_e, done) => { cfg.config.setupDone = done !== false; cfg.saveConfig(); return cfg.config.setupDone; });

  // ---------- Live, overlay-vinduer, skill-bar ----------
  handle('live:get', () => live.snapshot());
  handle('live:resetSession', () => { live.resetSession(); return true; });
  // Spillerliste og detaljer til DPS-meteret. Bare kjente, enkle verdier slippes inn.
  handle('live:detail', (_e, o) => {
    const id = (v, words) => (words.includes(v) ? v : (typeof v === 'number' && Number.isFinite(v) ? v : null));
    return live.detail({ period: typeof o?.period === 'string' ? o.period : 'fight', player: id(o?.player, ['self']), target: id(o?.target, ['current', 'bosses']) });
  });
  // Feilsøking: ta opp den rå strømmen fra broen til loggmappa i inntil 3 minutter
  handle('live:record', (_e, ms) => live.record(path.join(log.path(), 'live-' + new Date().toISOString().replace(/[:.]/g, '-') + '.jsonl'), Math.min(Number(ms) || 180000, 600000)));
  handle('overlays:get', () => overlays.getAll());
  handle('overlays:set', (_e, type, patch) => { const r = overlays.set(type, patch); cfg.saveConfig(); return r; });
  // Låst overlay-vindu slipper klikk gjennom; verktøylinja i DPS-vinduet ber om klikk mens pekeren er over den
  handle('overlays:ignoreMouse', (_e, type, ignore) => { const w = overlays.get(type); if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(!!ignore, { forward: true }); return true; });
  handle('skills:get', (_e, opts) => skills.getSkillbar(cfg.config, live.snapshot(), mumble.state, opts || {}));
  handle('skills:setRotation', (_e, key, rotation) => {
    if (typeof key !== 'string' || !key || !safeKey(key) || key.length > 512 || (!plain(rotation) && !Array.isArray(rotation))) throw new Error(t('config.invalidPatch', { field: 'rotation' }));
    cfg.config.rotations[key] = validateRotation(rotation);
    if (!cfg.saveConfig()) throw new Error(cfg.lastSaveError);
    overlays.broadcast('skills:changed', { key }); return true;
  });
  handle('skills:suggest', (e, key, options) => aiTask(e, options, (opts) => skills.suggestRotation(cfg.config, key, opts)));
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
    if (!plain(d) || !['start', 'move', 'end'].includes(d.phase) || (d.phase !== 'end' && (!Number.isFinite(d.x) || !Number.isFinite(d.y)))) return false;
    const w = d?.target === 'wheel' ? win.wheelWin : overlays.get(d?.target);
    if (!w || w.isDestroyed()) return false;
    if (d.phase === 'start') { const b = w.getBounds(); drags.set(e.sender.id, { x: b.x, y: b.y, w: b.width, h: b.height, px: d.x, py: d.y }); return true; }
    // Posisjon og størrelse settes sammen: setPosition alene lar Windows med DPI-skalering avrunde størrelsen opp for hver flytting
    if (d.phase === 'move') { const s = drags.get(e.sender.id); if (!s) return false; w.setBounds({ x: Math.round(s.x + (d.x - s.px)), y: Math.round(s.y + (d.y - s.py)), width: s.w, height: s.h }); return true; }
    drags.delete(e.sender.id); w.emit('moved'); return true;
  });
  handle('wheel:ignoreMouse', (_e, ignore) => { const w = win.wheelWin; if (w && !w.isDestroyed()) w.setIgnoreMouseEvents(!!ignore, { forward: true }); });

  handle('clipboard:write', (_e, text) => { clipboard.writeText(String(text)); return true; });
  // Lim inn tekst i spillets chat: kopier, gi GW2 fokus, Enter (hvis chatten ikke allerede er åpen), Ctrl+V.
  handle('game:paste', (_e, text) => new Promise((resolve) => {
    if (mumble.state?.error) return resolve({ ok: false, reason: 'NOHELPER' }); // hjelperen kunne ikke startes: si det, ikke "spillet kjører ikke"
    if (!mumble.state?.running) return resolve({ ok: false, reason: 'NOGAME' });
    clipboard.writeText(String(text));
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
  handle('open:url', (_e, url) => {
    try { const parsed = new URL(url); if (!['http:', 'https:'].includes(parsed.protocol)) return false; return shell.openExternal(parsed.href); }
    catch { return false; }
  });

  // ---------- Panel og app ----------
  handle('panel:open', (_e, id) => openModule(id));
  handle('panel:show', (_e, id) => openModule(id, { toggle: false }));
  handle('panel:close', () => win.closePanel());
  handle('panel:state', () => win.panelState());
  handle('wheel:setLocked', (_e, locked) => { const config = cfg.config; const prev = JSON.parse(JSON.stringify(config)); config.wheel.locked = !!locked; cfg.saveConfig(); win.applyConfig(prev); return config.wheel.locked; });
  handle('app:quit', () => { win.setQuitting(); app.quit(); });
  handle('app:hide', () => win.hideAll()); // brukerens valg beholdes gjennom alt-tab

  // ---------- Feilsøking: loggmappe og feilrapport (uten hemmeligheter) til utklippstavla ----------
  handle('log:open', async () => { const r = await shell.openPath(log.path()); if (r) throw new Error(r); return log.path(); });
  handle('log:report', async () => {
    const os = require('os');
    // Tilstanden i hvert overlay-vindu (window.__diag i overlay.js): hva vinduet selv tror det viser
    const diag = [];
    for (const type of Object.keys(overlays.DEFAULTS)) {
      const w = overlays.get(type);
      if (!w || w.isDestroyed()) continue;
      try { diag.push(type + ': ' + JSON.stringify(await w.webContents.executeJavaScript('window.__diag ? window.__diag() : "ingen __diag"'))); }
      catch (e) { diag.push(type + ': feil ' + e.message); }
    }
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
      'DPS: ' + JSON.stringify({ current: !!snap.dps?.current, last: snap.dps?.last ? { total: snap.dps.last.total, dps: snap.dps.last.dps } : null, session: snap.dps?.session ? { fights: snap.dps.session.fights, total: snap.dps.session.total } : null }),
      '',
      '--- Overlay-vinduer ---',
      ...(diag.length ? diag : ['(ingen vinduer åpne)']),
      '',
      '--- Konfig (uten hemmeligheter) ---',
      JSON.stringify(safe, null, 2),
      '',
      '--- Siste 200 logglinjer ---',
      ...log.tail(200),
    ];
    secrets.rememberConfig(config);
    const text = secrets.redact(lines.join('\n'));
    clipboard.writeText(text);
    return text;
  });

  // ---------- Oppdatering: manuell sjekk fra Innstillinger, og installer nedlastet versjon (avslutter og starter på nytt) ----------
  handle('update:check', () => updater.check());
  handle('update:get', () => updater.getState());
  handle('update:install', () => { const ok = updater.install(); if (ok) win.setQuitting(); return ok; });
}

module.exports = { register, handle };
