'use strict';
// Overlay-vindu: type fra URL (buffs, debuffs, target, skillbar). Tegner fra live-tilstanden 10 ganger i sekundet.
const TYPE = new URLSearchParams(location.search).get('type') || 'buffs';
const BOONS = { 740: 'MGT', 725: 'FUR', 1187: 'QCK', 30328: 'ALA', 717: 'PRO', 718: 'REG', 719: 'SWF', 726: 'VIG', 1122: 'STB', 743: 'AEG', 873: 'RES', 26980: 'RST' };
const CONDS = { 736: 'BLD', 737: 'BRN', 861: 'CNF', 723: 'PSN', 19426: 'TRM', 720: 'BLN', 722: 'CHL', 721: 'CRP', 791: 'FER', 727: 'IMM', 26766: 'SLW', 27705: 'TNT', 742: 'WKN', 738: 'VLN' };
let cfg = null;
let snap = null;
let skillbar = null;
let rotationPos = 0;
let lastFiredId = 0;
let lastSet = 'A';
const seenActivations = new Set();

const grid = document.getElementById('grid');
const sb = document.getElementById('sb');
const sbStatus = document.getElementById('sbStatus');
const hint = document.getElementById('hint');

function classify(skill) { if (BOONS[skill]) return 'boon'; if (CONDS[skill]) return 'cond'; return 'other'; }
function abbr(b) { return BOONS[b.skill] || CONDS[b.skill] || (b.name || '?').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(); }
function fmtSec(ms) { const s = ms / 1000; return s >= 10 ? Math.round(s) + '' : s.toFixed(1); }

function applyConfig(c) {
  cfg = c;
  document.body.classList.toggle('edit', !c.locked);
  hint.textContent = `${labelFor(TYPE)}: dra for å flytte, strekk i kantene. Lås i panelet (Live).`;
  document.documentElement.style.setProperty('--is', (c.iconSize || 40) + 'px');
  document.documentElement.style.setProperty('--ps', Math.round((c.iconSize || 40) * 0.72) + 'px');
  grid.classList.toggle('col', c.direction === 'col');
  const isSb = TYPE === 'skillbar';
  grid.hidden = isSb; sb.hidden = !isSb; sbStatus.hidden = !isSb;
  render();
}
function labelFor(t) { return { buffs: 'Buffs', debuffs: 'Conditions på deg', target: 'Target', skillbar: 'Skill-bar' }[t] || t; }

function renderBuffs() {
  if (!cfg) return;
  let list = [];
  if (TYPE === 'target') list = snap?.target?.buffs || [];
  else list = snap?.buffs || [];
  const f = cfg.filter || 'all';
  list = list.filter((b) => {
    const k = classify(b.skill);
    if (f === 'boons') return k === 'boon';
    if (f === 'conditions') return k === 'cond';
    if (f === 'other') return k === 'other';
    return true;
  });
  if (!list.length && !document.body.classList.contains('edit')) { grid.innerHTML = ''; return; }
  if (!list.length) { // eksempel i redigeringsmodus
    list = TYPE === 'target' ? [{ skill: 736, name: 'Bleeding', stacks: 12, remainingMs: 4200, max: 6000 }, { skill: 738, name: 'Vulnerability', stacks: 25, remainingMs: 8000, max: 10000 }]
      : [{ skill: 740, name: 'Might', stacks: 25, remainingMs: 9000, max: 10000 }, { skill: 1187, name: 'Quickness', stacks: 1, remainingMs: 3200, max: 8000 }, { skill: 30328, name: 'Alacrity', stacks: 1, remainingMs: 1800, max: 8000 }];
  }
  const sorters = {
    timeAsc: (a, c) => a.remainingMs - c.remainingMs,
    timeDesc: (a, c) => c.remainingMs - a.remainingMs,
    stacks: (a, c) => c.stacks - a.stacks || a.remainingMs - c.remainingMs,
    name: (a, c) => (a.name || '').localeCompare(c.name || ''),
  };
  list = list.slice().sort(sorters[cfg.sort] || sorters.timeAsc);
  const size = cfg.iconSize || 40;
  const showNum = cfg.mode === 'number' || cfg.mode === 'both';
  const showShade = cfg.mode === 'clock' || cfg.mode === 'both';
  grid.classList.toggle('list', cfg.layout === 'list');
  if (cfg.layout === 'list') {
    const rh = Math.round(size * 0.55);
    document.documentElement.style.setProperty('--rh', rh + 'px');
    grid.innerHTML = list.map((b) => {
      const k = classify(b.skill);
      const total = b.max || Math.max(b.remainingMs, 10000);
      const w = Math.max(0, Math.min(100, (b.remainingMs / total) * 100));
      return `<div class="l ${k} ${b.remainingMs < 2000 ? 'short' : ''}" title="${b.name}">
        ${showShade ? `<div class="sh" style="--w:${w.toFixed(1)}%"></div>` : ''}
        <span class="nm2">${b.name}</span>
        ${b.stacks > 1 ? `<span class="st2">×${b.stacks}</span>` : ''}
        ${showNum ? `<span class="tm2">${fmtSec(b.remainingMs)}s</span>` : ''}
      </div>`;
    }).join('');
    return;
  }
  grid.innerHTML = list.map((b) => {
    const k = classify(b.skill);
    const total = b.max || Math.max(b.remainingMs, 10000);
    const p = Math.max(0, Math.min(1, 1 - b.remainingMs / total));
    const showNum = cfg.mode === 'number' || cfg.mode === 'both';
    const showPie = cfg.mode === 'clock' || cfg.mode === 'both';
    return `<div class="b ${k} ${b.remainingMs < 2000 ? 'short' : ''}" style="width:${size}px;height:${size}px;font-size:${size}px" title="${b.name}">
      ${showPie ? `<div class="pie" style="--p:${Math.round(p * 100)}%"></div>` : ''}
      <span class="ab">${abbr(b)}</span>
      ${b.stacks > 1 ? `<span class="st">${b.stacks}</span>` : ''}
      ${showNum ? `<span class="tm">${fmtSec(b.remainingMs)}</span>` : ''}
      ${cfg.showNames ? `<span class="nm">${b.name}</span>` : ''}
    </div>`;
  }).join('');
}

function renderSkillbar() {
  if (!cfg) return;
  if (!skillbar || !skillbar.ok) {
    sb.innerHTML = '';
    sbStatus.textContent = skillbar?.error || 'Venter på karakter…';
    return;
  }
  // Aktivt våpensett fra broen (A/B); skills og rotasjon følger settet
  const setId = snap?.weaponSet === 'B' && skillbar.sets?.B ? 'B' : 'A';
  const set = skillbar.sets?.[setId] || { skills: skillbar.weapon, rotation: skillbar.rotation };
  if (setId !== lastSet) { lastSet = setId; rotationPos = 0; }
  const rot = set.rotation?.steps || [];
  const upkeep = set.rotation?.upkeep || [];
  const cds = new Map((snap?.cooldowns || []).map((c) => [c.skill, c]));
  // Boons som mangler på deg akkurat nå (eller er i ferd med å gå ut)
  const haveBoon = new Set((snap?.buffs || []).filter((b) => b.remainingMs > 1500).map((b) => (b.name || '').toLowerCase()));
  const missingFor = (skillId) => upkeep.filter((u) => u.skill === skillId && !haveBoon.has(String(u.boon).toLowerCase())).map((u) => u.boon);
  // Rotasjonsposisjon: gå videre når forventet skill ble aktivert
  for (const c of snap?.cooldowns || []) {
    if (c.fired && c.castStart > lastFiredId) {
      if (rot.length && rot[rotationPos % rot.length]?.skill === c.skill) rotationPos = (rotationPos + 1) % rot.length;
      lastFiredId = Math.max(lastFiredId, c.castStart);
    }
  }
  const nextSkill = rot.length ? rot[rotationPos % rot.length]?.skill : null;
  const cell = (s) => {
    if (!s) return '<div class="s empty"></div>';
    const cd = cds.get(s.id);
    let cdHtml = '';
    if (cfg.showCooldown && cd && s.recharge) {
      const rechargeMs = s.recharge * 1000 * (snap?.buffs?.some((b) => b.skill === 30328) ? 0.75 : 1);
      const remain = rechargeMs - cd.sinceMs;
      if (remain > 0) cdHtml = `<div class="cd" style="--p:${Math.round((1 - remain / rechargeMs) * 100)}%"></div><span class="cdt">${fmtSec(remain)}</span>`;
    }
    const idx = rot.map((r, i) => (r.skill === s.id ? i + 1 : 0)).filter(Boolean);
    const isNext = cfg.showNext && nextSkill === s.id;
    const missing = snap?.connected ? missingFor(s.id) : [];
    const ready = !cdHtml;
    const alarm = missing.length && ready;
    return `<div class="s ${isNext ? 'next' : ''} ${alarm ? 'upkeep' : ''}" title="${s.name}${s.recharge ? ' · ' + s.recharge + 's' : ''}${missing.length ? ' · mangler ' + missing.join(', ') : ''}"><img src="${s.icon}" alt="" />${cdHtml}${idx.length ? `<span class="rn">${idx.join(',')}</span>` : ''}${alarm ? `<span class="uk">${missing[0].slice(0, 3).toUpperCase()}</span>` : ''}</div>`;
  };
  const prof = skillbar.profession.map(cell).join('');
  const weapons = (set.skills || skillbar.weapon).map(cell).join('');
  const utils = [skillbar.heal, ...skillbar.utilities, skillbar.elite].map(cell).join('');
  sb.innerHTML = `<div class="row prof">${prof}</div><div class="row">${weapons}<div class="gap"></div>${utils}</div>`;
  const setTxt = skillbar.sets?.B ? ` · sett ${setId} (${(set.types || []).join('+')})` : '';
  sbStatus.textContent = `${skillbar.character} · ${skillbar.specName || skillbar.professionName}${setTxt}${rot.length ? ` · rotasjon ${rotationPos + 1}/${rot.length}` : ' · ingen rotasjon'}${snap?.connected ? '' : ' · ingen live-data'}`;
}

function render() { if (TYPE === 'skillbar') renderSkillbar(); else renderBuffs(); }

async function loadSkillbar() {
  try { skillbar = await window.api.invoke('skills:get'); rotationPos = 0; }
  catch (e) { skillbar = { ok: false, error: e.message }; }
  render();
}

window.api.on('live:state', (s) => { snap = s; render(); });
window.api.on('overlays:changed', ({ type, config }) => { if (type === TYPE) applyConfig(config); });
window.api.on('skills:changed', () => loadSkillbar());
window.api.on('mumble:state', (m) => { if (TYPE === 'skillbar' && m.identity && skillbar && (m.identity.name !== skillbar.character || m.identity.spec !== skillbar.specId)) loadSkillbar(); });
window.api.invoke('overlays:get').then((all) => applyConfig(all[TYPE]));
window.api.invoke('live:get').then((s) => { snap = s; render(); });
if (TYPE === 'skillbar') loadSkillbar();
setInterval(() => { if (snap) { const dt = 100; for (const b of snap.buffs || []) b.remainingMs -= dt; for (const b of snap.target?.buffs || []) b.remainingMs -= dt; for (const c of snap.cooldowns || []) c.sinceMs += dt; render(); } }, 100);
