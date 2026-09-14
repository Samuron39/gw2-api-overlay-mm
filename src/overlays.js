'use strict';
// Små, gjennomsiktige overlay-vinduer: buffs, debuffs, target og skill-bar. Hvert vindu kan flyttes,
// strekkes og låses. Låst = klikk går gjennom til spillet. Ulåst = redigeringsmodus (dra hvor som helst, strekk i kantene).
const { BrowserWindow, screen } = require('electron');
const path = require('path');

const DEFAULTS = {
  buffs: { enabled: false, x: null, y: null, w: 340, h: 60, locked: false, layout: 'grid', sort: 'timeAsc', iconSize: 40, mode: 'both', filter: 'boons', showNames: false, showIcons: true, opacity: 1, direction: 'row' },
  debuffs: { enabled: false, x: null, y: null, w: 340, h: 60, locked: false, layout: 'grid', sort: 'timeAsc', iconSize: 40, mode: 'both', filter: 'conditions', showNames: false, showIcons: true, opacity: 1, direction: 'row' },
  target: { enabled: false, x: null, y: null, w: 340, h: 60, locked: false, layout: 'grid', sort: 'timeAsc', iconSize: 36, mode: 'both', filter: 'conditions', showNames: false, showIcons: true, opacity: 1, direction: 'row' },
  skillbar: { enabled: false, x: null, y: null, w: 560, h: 130, locked: false, iconSize: 44, mode: 'both', showNext: true, showCooldown: true, delayMs: 3000, opacity: 1 },
  // Tre DPS-vinduer med samme valg: view = hva som vises (all, damage, squad, taken, healing), period = denne kampen (fight),
  // forrige kamp (last) eller hele økta (session). Flere vinduer lar deg legge squad i ett hjørne og mottatt i et annet.
  dps: { enabled: false, x: null, y: null, w: 300, h: 180, locked: false, view: 'all', period: 'fight', fontSize: 14, showTaken: true, showSkills: 3, takenRows: 3, showLast: true, showHealing: true, opacity: 1, showSquad: true, squadRows: 5 },
  dps2: { enabled: false, x: null, y: null, w: 300, h: 180, locked: false, view: 'squad', period: 'fight', fontSize: 14, showTaken: true, showSkills: 3, takenRows: 3, showLast: true, showHealing: true, opacity: 1, showSquad: true, squadRows: 5 },
  dps3: { enabled: false, x: null, y: null, w: 300, h: 180, locked: false, view: 'taken', period: 'fight', fontSize: 14, showTaken: true, showSkills: 3, takenRows: 3, showLast: true, showHealing: true, opacity: 1, showSquad: true, squadRows: 5 },
};

const wins = new Map();
let ctx = null;

function cfgFor(type) { return { ...DEFAULTS[type], ...((ctx.config.overlays || {})[type] || {}) }; }

function apply(type) {
  const c = cfgFor(type);
  const w = wins.get(type);
  if (!c.enabled) { if (w && !w.isDestroyed()) { w.close(); } wins.delete(type); return; }
  if (!w || w.isDestroyed()) create(type, c);
  else {
    w.setIgnoreMouseEvents(!!c.locked, { forward: true });
    w.setResizable(!c.locked);
    w.setOpacity(Number(c.opacity) || 1);
    w.webContents.send('overlays:changed', { type, config: c });
  }
}

function create(type, c) {
  const disp = screen.getPrimaryDisplay().workArea;
  const x = c.x ?? Math.round(disp.x + disp.width / 2 - c.w / 2);
  const y = c.y ?? Math.round(disp.y + disp.height - c.h - 160 - (type === 'skillbar' ? 0 : type.startsWith('dps') ? 300 + (type === 'dps2' ? 60 : type === 'dps3' ? 120 : 0) : 140));
  const w = new BrowserWindow({
    x, y, width: c.w, height: c.h, minWidth: 80, minHeight: 40,
    transparent: true, frame: false, alwaysOnTop: true, skipTaskbar: true, hasShadow: false, resizable: !c.locked, show: !suspended,
    focusable: false, title: `GW2 Overlay ${type}`, icon: ctx.icon, opacity: Number(c.opacity) || 1, webPreferences: ctx.webPreferences,
  });
  w.setAlwaysOnTop(true, 'screen-saver');
  w.setMenuBarVisibility(false);
  w.setIgnoreMouseEvents(!!c.locked, { forward: true });
  w.webContents.once('did-finish-load', () => { const z = Number(ctx.config.uiScale) || 1; if (z !== 1) w.webContents.setZoomFactor(z); });
  w.loadFile(path.join(__dirname, 'renderer', 'overlay.html'), { query: { type } });
  const save = () => { if (w.isDestroyed()) return; const b = w.getBounds(); const cur = (ctx.config.overlays[type] ||= {}); Object.assign(cur, { x: b.x, y: b.y, w: b.width, h: b.height }); ctx.saveSoon(); };
  w.on('moved', save); w.on('resized', save);
  w.on('closed', () => { if (wins.get(type) === w) wins.delete(type); });
  wins.set(type, w);
}

function init(c) {
  ctx = c;
  ctx.config.overlays = ctx.config.overlays || {};
  if (ctx.testMode) return;
  for (const type of Object.keys(DEFAULTS)) apply(type);
}

function getAll() {
  const out = {};
  for (const type of Object.keys(DEFAULTS)) out[type] = cfgFor(type);
  return out;
}

function set(type, patch) {
  if (!DEFAULTS[type]) throw new Error('Ukjent overlay ' + type);
  ctx.config.overlays[type] = { ...(ctx.config.overlays[type] || {}), ...patch };
  if (!ctx.testMode) apply(type);
  return cfgFor(type);
}

function broadcast(channel, payload) {
  for (const w of wins.values()) if (w && !w.isDestroyed()) w.webContents.send(channel, payload);
}

// Testkrok: lag ett vindu uansett konfig og returner det
function ensure(type, patch = {}) {
  ctx.config.overlays[type] = { ...(ctx.config.overlays[type] || {}), enabled: true, ...patch };
  apply(type);
  return wins.get(type);
}

function setZoom(scale) { for (const w of wins.values()) if (w && !w.isDestroyed()) w.webContents.setZoomFactor(scale); }

// Midlertidig skjul av alle overlay-vinduene (auto-skjul ved alt-tab, «følg spillet» når spillet ikke kjører).
// Konfigen røres ikke; vinduene vises igjen uten å ta fokus. Vinduer som lages mens vi er suspendert, starter skjult.
let suspended = false;
function setSuspended(on) {
  on = !!on;
  if (on === suspended) return;
  suspended = on;
  for (const w of wins.values()) {
    if (!w || w.isDestroyed()) continue;
    if (on) w.hide(); else w.showInactive();
  }
}

module.exports = { init, getAll, set, broadcast, ensure, setZoom, setSuspended, isSuspended: () => suspended, DEFAULTS, get: (type) => wins.get(type) || null };
