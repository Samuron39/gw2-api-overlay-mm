'use strict';
const MODULES = [
  { id: 'inventory', label: 'Inventory', icon: '🎒' },
  { id: 'daily', label: 'I dag', icon: '📅' },
  { id: 'timers', label: 'Tidsplan', icon: '⏱️' },
  { id: 'tp', label: 'Trading Post', icon: '💰' },
  { id: 'dps', label: 'DPS', icon: '⚔️' },
  { id: 'live', label: 'Live', icon: '⚡' },
  { id: 'characters', label: 'Karakterer', icon: '🧙' },
  { id: 'guild', label: 'Guild', icon: '🏰' },
  { id: 'settings', label: 'Innstillinger', icon: '⚙️' },
];
const size = Math.min(window.innerWidth, window.innerHeight - 34);
const cx = size / 2, cy = size / 2, R = size / 2 - 2, r = size * 0.19;
const svg = document.getElementById('svg');
svg.setAttribute('width', size); svg.setAttribute('height', size);
const center = document.getElementById('center');
center.style.width = center.style.height = (r * 2 - 6) + 'px';
center.style.left = (cx - r + 3) + 'px'; center.style.top = (cy - r + 3) + 'px';

const pt = (rad, ang) => [cx + rad * Math.cos(ang), cy + rad * Math.sin(ang)];
const gap = 0.035;
let active = null;

// Tegner segmentene for modulene som er slått på (Innstillinger er alltid med)
function build(enabledIds) {
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
    path.addEventListener('mouseenter', () => setLabel(m.label));
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

let status = 'GW2 ikke funnet';
function setLabel(txt) { document.getElementById('labelText').textContent = txt || status; }
function setActive(id) {
  active = id;
  svg.querySelectorAll('.seg').forEach((p) => p.classList.toggle('active', p.dataset.id === id));
}
function setLocked(locked) {
  document.body.classList.toggle('locked', locked);
  document.getElementById('lockBtn').textContent = locked ? '🔒' : '🔓';
  document.getElementById('lockBtn').title = locked ? 'Lås opp plassering' : 'Lås plassering';
  document.getElementById('centerBadge').textContent = locked ? '🔒' : '✥';
  center.title = locked ? 'Låst' : 'Dra for å flytte';
}

document.getElementById('lockBtn').addEventListener('click', async () => {
  const locked = await window.api.invoke('wheel:setLocked', !document.body.classList.contains('locked'));
  setLocked(locked);
});
document.getElementById('quitBtn').addEventListener('click', () => window.api.invoke('app:quit'));

const mapNames = {};
async function onMumble(s) {
  const dot = document.getElementById('dot');
  dot.classList.toggle('on', !!s.running);
  if (s.running && s.mapId) {
    if (!mapNames[s.mapId]) {
      try { const r = await window.api.invoke('gw2:maps', [s.mapId]); mapNames[s.mapId] = r[s.mapId]?.name || ('Kart ' + s.mapId); } catch { mapNames[s.mapId] = 'Kart ' + s.mapId; }
    }
    status = (s.identity?.name ? s.identity.name + ' · ' : '') + mapNames[s.mapId] + (s.ui?.inCombat ? ' · i kamp' : '');
  } else status = s.error ? 'Ingen posisjon (' + s.error + ')' : 'GW2 ikke funnet';
  setLabel(null);
}

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
window.api.on('config:changed', (c) => build(c.wheelModules || null));
window.api.invoke('config:get').then((c) => { setLocked(!!c.wheel?.locked); build(c.wheelModules || null); });
window.api.invoke('mumble:get').then(onMumble);
window.api.invoke('panel:state').then(({ visible, module }) => setActive(visible ? module : null));
