'use strict';
// Hjulet. Tekster via T (i18n.js): etiketter slås opp når de vises, så språkbytte virker uten omstart.
const MODULES = [
  { id: 'inventory', icon: '🎒' },
  { id: 'daily', icon: '📅' },
  { id: 'timers', icon: '⏱️' },
  { id: 'tp', icon: '💰' },
  { id: 'dps', icon: '⚔️' },
  { id: 'live', icon: '⚡' },
  { id: 'characters', icon: '🧙' },
  { id: 'guild', icon: '🏰' },
  { id: 'guides', icon: '📖' },
  { id: 'settings', icon: '⚙️' },
].map((m) => ({ ...m, label: () => T.t('module.' + m.id) }));
let size, cx, cy, R, r, enabledModules = null;
const svg = document.getElementById('svg');
const center = document.getElementById('center');
function geometry() {
size = Math.min(window.innerWidth, window.innerHeight - 34);
cx = size / 2; cy = size / 2; R = size / 2 - 2; r = size * 0.19;
svg.setAttribute('width', size); svg.setAttribute('height', size);
center.style.width = center.style.height = (r * 2 - 6) + 'px';
center.style.left = (cx - r + 3) + 'px'; center.style.top = (cy - r + 3) + 'px';
}

const pt = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
const gap = 0.035;
let active = null;

// Tegner segmentene for modulene som er slått på (Innstillinger er alltid med)
function build(enabledIds) {
  enabledModules = enabledIds;
  geometry();
  const enabled = MODULES.filter((m) => m.id === 'settings' || !enabledIds || enabledIds.includes(m.id));
  svg.innerHTML = '';
  const n = enabled.length;
  enabled.forEach((m, i) => {
    const a0 = -Math.PI / 2 + (i / n) * 2 * Math.PI + (n > 1 ? gap : 0);
    const a1 = -Math.PI / 2 + ((i + 1) / n) * 2 * Math.PI - (n > 1 ? gap : 0.001);
    const [x0, y0] = pt(R, a0), [x1, y1] = pt(R, a1), [x2, y2] = pt(r + 4, a1), [x3, y3] = pt(r + 4, a0);
    const large = (a1 - a0) > Math.PI ? 1 : 0;
    const path = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    path.setAttribute('d', `M${x0},${y0} A${R},${R} 0 ${large} 1 ${x1},${y1} L${x2},${y2} A${r + 4},${r + 4} 0 ${large} 0 ${x3},${y3} Z`);
    path.setAttribute('class', 'seg' + (m.id === active ? ' active' : '')); path.dataset.id = m.id;
    path.addEventListener('mouseenter', () => setLabel(m.label()));
    path.addEventListener('mouseleave', () => setLabel(null));
    path.addEventListener('click', () => window.api.invoke('panel:open', m.id));
    svg.appendChild(path);
    const [ix, iy] = pt((R + r) / 2 + 2, (a0 + a1) / 2);
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('x', ix); t.setAttribute('y', iy); t.setAttribute('class', 'icon'); t.textContent = m.icon;
    svg.appendChild(t);
  });
}
build(null);
window.addEventListener('resize', () => build(enabledModules));

// Statuslinja under hjulet: karakter og kart fra MumbleLink, ellers hvorfor vi ikke har posisjon
const mapNames = {};
const pendingMaps = new Map();
let lastMumble = null;
function statusText() {
  const s = lastMumble;
  if (!s) return T.t('wheel.title');
  if (s.running && s.mapId) return (s.identity?.name ? s.identity.name + ' · ' : '') + (mapNames[s.mapId] || T.t('wheel.map', { id: s.mapId })) + (s.ui?.inCombat ? ' · ' + T.t('wheel.inCombat') : '');
  return s.error ? T.t('wheel.noPosition', { error: s.error }) : T.t('wheel.notFound');
}
function setLabel(txt) { document.getElementById('labelText').textContent = txt || statusText(); }
function setActive(id) {
  active = id;
  svg.querySelectorAll('.seg').forEach((p) => p.classList.toggle('active', p.dataset.id === id));
}
function setLocked(locked) {
  document.body.classList.toggle('locked', locked);
  document.getElementById('lockBtn').textContent = locked ? '🔒' : '🔓';
  document.getElementById('lockBtn').title = T.t(locked ? 'wheel.unlockPosition' : 'wheel.lockPosition');
  document.getElementById('centerBadge').textContent = locked ? '🔒' : '✥';
  center.title = T.t(locked ? 'wheel.locked' : 'wheel.dragToMove');
}
// Statiske tekster i wheel.html
function applyStatic() {
  document.title = T.t('wheel.title');
  document.getElementById('quitBtn').title = T.t(followGame ? 'wheel.hide' : 'wheel.quit');
  setLocked(document.body.classList.contains('locked'));
  setLabel(null);
}

document.getElementById('lockBtn').addEventListener('click', async () => {
  const locked = await window.api.invoke('wheel:setLocked', !document.body.classList.contains('locked'));
  setLocked(locked);
});
let followGame = false;
document.getElementById('quitBtn').addEventListener('click', () => window.api.invoke(followGame ? 'app:hide' : 'app:quit'));
function applyFollow(c) { followGame = !!c?.followGame; document.getElementById('quitBtn').title = T.t(followGame ? 'wheel.hide' : 'wheel.quit'); }

async function onMumble(s) {
  lastMumble = s;
  const dot = document.getElementById('dot');
  dot.classList.toggle('on', !!s.running);
  if (s.running && s.mapId && !mapNames[s.mapId]) {
    if (!pendingMaps.has(s.mapId)) pendingMaps.set(s.mapId, window.api.invoke('gw2:maps', [s.mapId])
      .then((r) => { mapNames[s.mapId] = r[s.mapId]?.name || T.t('wheel.map', { id: s.mapId }); })
      .catch(() => { mapNames[s.mapId] = T.t('wheel.map', { id: s.mapId }); })
      .finally(() => pendingMaps.delete(s.mapId)));
    await pendingMaps.get(s.mapId);
  }
  setLabel(null);
}

// Manuell draing av hjulet fra midten. CSS-drag (-webkit-app-region) er upålitelig i gjennomsiktige vinduer
// med klikk-gjennom og DPI-skalering, så vi flytter vinduet selv ut fra skjermkoordinatene til pekeren.
let dragging = false;
center.addEventListener('pointerdown', (e) => {
  if (document.body.classList.contains('locked') || e.button !== 0) return;
  dragging = true; center.setPointerCapture(e.pointerId);
  window.api.invoke('win:drag', { target: 'wheel', phase: 'start', x: e.screenX, y: e.screenY });
});
center.addEventListener('pointermove', (e) => { if (dragging) window.api.invoke('win:drag', { target: 'wheel', phase: 'move', x: e.screenX, y: e.screenY }); });
const endDrag = (e) => { if (!dragging) return; dragging = false; try { center.releasePointerCapture(e.pointerId); } catch { /* allerede sluppet */ } window.api.invoke('win:drag', { target: 'wheel', phase: 'end' }); };
center.addEventListener('pointerup', endDrag);
center.addEventListener('pointercancel', endDrag);

// Klikk-gjennom: gjennomsiktige områder slipper museklikk videre til spillet
let ignoring = false;
document.addEventListener('mousemove', (e) => {
  const el = document.elementFromPoint(e.clientX, e.clientY);
  const interactive = el && el !== document.body && el !== document.documentElement && el.id !== 'wrap' && el.id !== 'svg' && el.id !== 'bar';
  const shouldIgnore = !interactive;
  if (shouldIgnore !== ignoring) { ignoring = shouldIgnore; window.api.invoke('wheel:ignoreMouse', shouldIgnore); }
});
document.addEventListener('mouseleave', () => { if (!ignoring) { ignoring = true; window.api.invoke('wheel:ignoreMouse', true); } });

window.api.on('mumble:state', onMumble);
window.api.on('wheel:locked', ({ locked }) => setLocked(locked));
window.api.on('panel:visible', ({ visible, module }) => setActive(visible ? module : null));
window.api.on('config:changed', async (c) => { if (await T.sync(c)) applyStatic(); if (JSON.stringify(c.wheelModules || null) !== JSON.stringify(enabledModules)) build(c.wheelModules || null); applyFollow(c); });
T.load().then(() => {
  applyStatic();
  window.api.invoke('config:get').then((c) => { setLocked(!!c.wheel?.locked); build(c.wheelModules || null); applyFollow(c); });
  window.api.invoke('mumble:get').then(onMumble);
  window.api.invoke('panel:state').then(({ visible, module }) => setActive(visible ? module : null));
});
