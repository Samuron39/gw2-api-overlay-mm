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
const boonSeen = new Map(); // boon-navn -> sist sett (ms), for hold-oppe med forsinkelsestoleranse
let boonSince = 0; // når vi begynte å få live-data
const ammoState = new Map(); // skill -> { charges, nextAt } (ladninger, telles ned per aktivering)
const lastFiredBySkill = new Map(); // skill -> castStart for siste aktivering vi har telt
const L = window.SkillbarLogic;

const grid = document.getElementById('grid');
const sb = document.getElementById('sb');
const sbStatus = document.getElementById('sbStatus');
const dp = document.getElementById('dps');
const hint = document.getElementById('hint');

function classify(skill) { if (BOONS[skill]) return 'boon'; if (CONDS[skill]) return 'cond'; return 'other'; }
function abbr(b) { return BOONS[b.skill] || CONDS[b.skill] || (b.name || '?').replace(/[^A-Za-z]/g, '').slice(0, 3).toUpperCase(); }
function fmtSec(ms) { const s = ms / 1000; return s >= 10 ? Math.round(s) + '' : s.toFixed(1); }

// Ikoner: boons og conditions ligger lokalt i assets/effects (fra wikien, CC BY-SA). Andre effekter slås opp i
// skill-indeksen via 'skills:icons' (render.guildwars2.com), samlet i batch og maks én gang per sekund. Uten ikon vises forkortelsen.
const iconCache = new Map(); // skill-id -> url, eller null når indeksen ikke har noe
const iconPending = new Set();
const iconBroken = new Set(); // bilder som ikke lot seg laste
let iconTimer = null, iconLast = 0;
function iconFor(b) {
  if (cfg?.showIcons === false || iconBroken.has(b.skill)) return null;
  if (BOONS[b.skill] || CONDS[b.skill]) return `../../assets/effects/${b.skill}.png`;
  if (iconCache.has(b.skill)) return iconCache.get(b.skill);
  iconPending.add(b.skill);
  scheduleIcons();
  return null;
}
function scheduleIcons() {
  if (iconTimer) return;
  iconTimer = setTimeout(async () => {
    iconTimer = null; iconLast = Date.now();
    const ids = [...iconPending]; iconPending.clear();
    for (const id of ids) iconCache.set(id, null); // ikke spør igjen mens vi venter, eller hvis oppslaget feiler
    try { const res = await window.api.invoke('skills:icons', ids); for (const id of ids) iconCache.set(id, res[id] || null); render(); }
    catch { /* ingen API-nøkkel eller indeks ennå: forkortelsen står */ }
  }, Math.max(0, 1000 - (Date.now() - iconLast)));
}
grid.addEventListener('error', (e) => { const id = Number(e.target?.dataset?.skill); if (id) { iconBroken.add(id); render(); } }, true);

function applyConfig(c) {
  cfg = c;
  document.body.classList.toggle('edit', !c.locked);
  hint.textContent = T.t('overlay.hint', { label: labelFor(TYPE) });
  document.documentElement.style.setProperty('--is', (c.iconSize || 40) + 'px');
  document.documentElement.style.setProperty('--ps', Math.round((c.iconSize || 40) * 0.72) + 'px');
  grid.classList.toggle('col', c.direction === 'col');
  const isSb = TYPE === 'skillbar', isDps = TYPE === 'dps';
  grid.hidden = isSb || isDps; sb.hidden = !isSb; sbStatus.hidden = !isSb; dp.hidden = !isDps;
  document.documentElement.style.setProperty('--fs', (c.fontSize || 14) + 'px');
  render();
}

// ---------- DPS-måler ----------
function fmtK(n) { n = Math.round(n || 0); return n >= 100000 ? Math.round(n / 1000) + 'k' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function fmtDur(ms) { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
function renderDps() {
  if (!cfg) return;
  const d = snap?.dps || {};
  const edit = document.body.classList.contains('edit');
  let cur = d.current, last = d.last, sample = false;
  if (!cur && !last && edit) { sample = true; cur = { active: true, dps10: 18420, dps: 15980, total: 287640, durationMs: 18000, taken: 9120, target: 'Legendary Destroyer', skills: [{ name: 'Arc Divider', dmg: 98000, pct: 34 }, { name: 'Decapitate', dmg: 61000, pct: 21 }, { name: 'Bleeding', dmg: 40000, pct: 14 }],
    // Squad-DPS: eksempel med tre spillere så brukeren ser hvordan lista blir
    squad: [{ name: 'Kara Nightwind', self: false, dmg: 380520, dps: 21140, pct: 45 }, { name: 'Morticon Storm', self: true, dmg: 287640, dps: 15980, pct: 34 }, { name: 'Thorn Ironbark', self: false, dmg: 176300, dps: 9790, pct: 21 }] }; }
  const show = cur || (cfg.showLast !== false ? last : null);
  if (!show) { dp.innerHTML = `<div class="top"><span class="big idle">–</span><span class="lbl">DPS</span></div><div class="sub">${esc(T.t('overlay.dps.noFight'))}</div>`; return; }
  const active = !!cur;
  const main = active ? show.dps10 : show.dps;
  const rows = [];
  rows.push(`<div class="top"><span class="big ${active ? '' : 'idle'}">${fmtK(main)}</span><span class="lbl">${esc(active ? T.t('overlay.dps.now') : T.t('overlay.dps.last'))}</span>${sample ? `<span class="lbl">(${esc(T.t('overlay.dps.sample'))})</span>` : ''}</div>`);
  rows.push(`<div class="sub">${esc(T.t('overlay.dps.line', { dur: fmtDur(show.durationMs), avg: fmtK(show.dps), total: fmtK(show.total) }))}${show.target ? ' · ' + esc(show.target) : ''}${cfg.showTaken !== false && show.taken ? ` · <span class="tk">${esc(T.t('overlay.dps.taken', { n: fmtK(show.taken) }))}</span>` : ''}</div>`);
  const n = Number(cfg.showSkills ?? 3);
  for (const s of (show.skills || []).slice(0, n)) rows.push(`<div class="sk"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || s.skill)}</span><span class="v">${fmtK(s.dmg)} · ${s.pct || 0}%</span></div>`);
  // ---------- Squad-DPS ----------
  // Rangert liste over squaden (som en WoW-måler) når flere enn deg har gjort skade. Søyla er relativ til den øverste,
  // pct er andel av squadens samlede skade. Din rad er alltid med, også når du ligger under de viste radene.
  const squad = show.squad || [];
  if (cfg.showSquad !== false && squad.length > 1) {
    const rowsN = Math.max(1, Math.min(10, Number(cfg.squadRows ?? 5)));
    const list = squad.slice(0, rowsN);
    const me = squad.find((p) => p.self);
    if (me && !list.includes(me)) list[list.length - 1] = me;
    const top = squad[0]?.dmg || 1;
    rows.push(`<div class="sqh">${esc(T.t('overlay.dps.squad', { n: squad.length }))}</div>`);
    for (const p of list) {
      const rank = squad.indexOf(p) + 1;
      rows.push(`<div class="sq${p.self ? ' me' : ''}"><span class="bar" style="--w:${Math.round((p.dmg || 0) / top * 100)}%"></span><span class="n">${rank}. ${esc(shortName(p.name))}</span><span class="v">${fmtK(p.dps)} · ${p.pct || 0}%</span></div>`);
    }
  }
  dp.innerHTML = rows.join('');
}
// Kort navn i squad-lista: maks 14 tegn
function shortName(s) { s = String(s || '?'); return s.length > 14 ? s.slice(0, 13) + '…' : s; }
function labelFor(type) { return T.t('overlay.label.' + type); }

function renderBuffs() {
  if (!cfg) return;
  let list = [];
  if (TYPE === 'target') list = snap?.target?.buffs || [];
  else list = snap?.buffs || [];
  list = list.filter((b) => b.remainingMs > 0); // vinduet teller ned selv mellom tilstandene, utløpt vises aldri
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
      const icon = iconFor(b);
      return `<div class="l ${k} ${b.remainingMs < 2000 ? 'short' : ''}" title="${b.name}">
        ${showShade ? `<div class="sh" style="--w:${w.toFixed(1)}%"></div>` : ''}
        ${icon ? `<img class="ic2" src="${icon}" data-skill="${b.skill}" alt="" />` : ''}
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
    const icon = iconFor(b);
    return `<div class="b ${k} ${b.remainingMs < 2000 ? 'short' : ''}" style="width:${size}px;height:${size}px;font-size:${size}px" title="${b.name}">
      ${icon ? `<img class="ic" src="${icon}" data-skill="${b.skill}" alt="" />` : ''}
      ${showPie ? `<div class="pie" style="--p:${Math.round(p * 100)}%"></div>` : ''}
      ${icon ? '' : `<span class="ab">${abbr(b)}</span>`}
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
    sbStatus.textContent = skillbar?.error || T.t('overlay.waitingCharacter');
    return;
  }
  // Aktivt våpensett fra broen (A/B); skills og rotasjon følger settet
  const setId = snap?.weaponSet === 'B' && skillbar.sets?.B ? 'B' : 'A';
  const set = skillbar.sets?.[setId] || { skills: skillbar.weapon, rotation: skillbar.rotation };
  if (setId !== lastSet) { lastSet = setId; rotationPos = 0; }
  const rot = set.rotation?.steps || [];
  const upkeep = set.rotation?.upkeep || [];
  const cds = new Map((snap?.cooldowns || []).map((c) => [c.skill, c]));
  // Boons som mangler på deg, med toleranse for at evtc-kanalen fra ArcDPS kommer 2–3 s etter spillet (cfg.delayMs)
  const nowR = Date.now();
  if (!snap?.connected) { boonSeen.clear(); boonSince = 0; }
  else { if (!boonSince) boonSince = nowR; L.noteBoons(snap.buffs, boonSeen, nowR); }
  const missingFor = (skillId) => L.upkeepMissing(upkeep, skillId, boonSeen, boonSince || nowR, nowR, cfg.delayMs ?? 3000);
  // Rotasjonsposisjon: gå videre når forventet skill ble aktivert
  for (const c of snap?.cooldowns || []) {
    if (c.fired && c.castStart > lastFiredId) {
      if (rot.length && rot[rotationPos % rot.length]?.skill === c.skill) rotationPos = (rotationPos + 1) % rot.length;
      lastFiredId = Math.max(lastFiredId, c.castStart);
    }
  }
  const nextSkill = rot.length ? rot[rotationPos % rot.length]?.skill : null;
  // Hva som er aktivt nå: attunement (Elementalist), kit (Engineer), legend (Revenant), transformasjon (shroud, Berserk, elite)
  const alac = L.hasAlacrity(snap);
  const traits = skillbar.traits || [];
  const nowMs = Date.now();
  let weapons = set.skills || skillbar.weapon;
  let profession = skillbar.profession.slice();
  let heal = skillbar.heal, utilities = skillbar.utilities, elite = skillbar.elite;
  const modes = [];
  if (set.attunements) {
    const a = L.pickAttunement(snap, skillbar.attunementIds);
    weapons = L.attunementWeapon(set, a.main, a.off);
    modes.push(a.main + (set.dual && a.off && a.off !== a.main ? '/' + a.off : ''));
  }
  const kitId = L.pickKit(snap, skillbar.kits);
  if (kitId) { weapons = skillbar.kits[kitId].skills; modes.push(skillbar.kits[kitId].name); }
  const legendKey = L.pickLegend(snap, skillbar.legends, skillbar.legendOrder);
  if (legendKey) {
    const lg = skillbar.legends[legendKey];
    heal = lg.heal; utilities = lg.utilities; elite = lg.elite;
    const other = (skillbar.legendOrder || []).map((k) => skillbar.legends[k]).find((l) => l && l.key !== legendKey);
    if (other?.swapSkill) { const i = profession.findIndex((s) => s.slot === 'Profession_1'); if (i >= 0) profession[i] = other.swapSkill; else profession.unshift(other.swapSkill); }
    modes.push(lg.name.replace(/^Legendary | Stance$/g, ''));
  }
  const formKey = L.pickForm(snap, skillbar.forms);
  if (formKey) {
    const f = skillbar.forms[formKey];
    if (f.weapon) weapons = f.weapon;
    if (f.profession) profession = profession.map((s) => f.profession.find((p) => p.slot === s.slot) || s);
    modes.push(formKey);
  }
  // Ladninger: tell ned én per ny aktivering, lad opp per Count Recharge
  for (const c of snap?.cooldowns || []) {
    if (!c.fired || lastFiredBySkill.get(c.skill) === c.castStart) continue;
    lastFiredBySkill.set(c.skill, c.castStart);
    const s = skillbar.all.find((x) => x.id === c.skill);
    const am = s && L.ammoFor(s, traits, alac);
    if (am) ammoState.set(c.skill, L.ammoUse(ammoState.get(c.skill), am.count, am.recharge * 1000, nowMs - c.sinceMs));
  }
  const cell = (s) => {
    if (!s) return '<div class="s empty"></div>';
    const cd = cds.get(s.id);
    let cdHtml = '';
    let ammoHtml = '';
    const am = L.ammoFor(s, traits, alac);
    if (am) {
      const st = L.ammoTick(ammoState.get(s.id), am.count, am.recharge * 1000, nowMs);
      ammoState.set(s.id, st);
      ammoHtml = `<span class="am ${st.charges ? '' : 'none'}">${st.charges}</span>`;
      if (cfg.showCooldown && !st.charges && st.nextAt > nowMs) { const rechargeMs = am.recharge * 1000; const remain = st.nextAt - nowMs; cdHtml = `<div class="cd" style="--p:${Math.round((1 - remain / rechargeMs) * 100)}%"></div><span class="cdt">${fmtSec(remain)}</span>`; }
    } else if (cfg.showCooldown && cd && s.recharge) {
      const rechargeMs = L.cooldownSeconds(s, traits, alac) * 1000;
      const remain = rechargeMs - cd.sinceMs;
      if (remain > 0) cdHtml = `<div class="cd" style="--p:${Math.round((1 - remain / rechargeMs) * 100)}%"></div><span class="cdt">${fmtSec(remain)}</span>`;
    }
    const idx = rot.map((r, i) => (r.skill === s.id ? i + 1 : 0)).filter(Boolean);
    const isNext = cfg.showNext && nextSkill === s.id;
    const missing = snap?.connected ? missingFor(s.id) : [];
    const ready = !cdHtml;
    const alarm = missing.length && ready;
    return `<div class="s ${isNext ? 'next' : ''} ${alarm ? 'upkeep' : ''}" title="${s.name}${s.recharge ? ' · ' + s.recharge + 's' : ''}${am ? ' · ' + T.t('overlay.charges', { n: am.count }) : ''}${missing.length ? ' · ' + T.t('overlay.missing', { boons: missing.join(', ') }) : ''}"><img src="${s.icon}" alt="" />${cdHtml}${idx.length ? `<span class="rn">${idx.join(',')}</span>` : ''}${ammoHtml}${alarm ? `<span class="uk">${missing[0].slice(0, 3).toUpperCase()}</span>` : ''}</div>`;
  };
  const profHtml = profession.map(cell).join('');
  const weaponsHtml = weapons.map(cell).join('');
  const utilsHtml = [heal, ...utilities, elite].map(cell).join('');
  sb.innerHTML = `<div class="row prof">${profHtml}</div><div class="row">${weaponsHtml}<div class="gap"></div>${utilsHtml}</div>`;
  const setTxt = skillbar.sets?.B ? ' · ' + T.t('overlay.set', { set: setId, types: (set.types || []).join('+') }) : '';
  const modeTxt = modes.length ? ' · ' + modes.join(' · ') : '';
  sbStatus.textContent = `${skillbar.character} · ${skillbar.specName || skillbar.professionName}${setTxt}${modeTxt} · ${rot.length ? T.t('overlay.rotation', { pos: rotationPos + 1, total: rot.length }) : T.t('overlay.noRotation')}${snap?.connected ? '' : ' · ' + T.t('overlay.noLive')}`;
}

function render() { if (TYPE === 'skillbar') renderSkillbar(); else if (TYPE === 'dps') renderDps(); else renderBuffs(); }

// Skill-bar hentes fra API-et via skills:get. Én lasting om gangen (sbLoading), og MumbleLink-tilstanden som kommer
// hvert 500 ms utløser bare ny lasting når karakter eller spec faktisk har endret seg (sbTrigger). Feilet lasting
// (ingen karakter, ingen nøkkel, API nede) prøves ikke oftere enn hvert 30. sekund.
let sbLoading = null;
let sbTrigger = '';
let sbFailedAt = 0;
const SB_RETRY_MS = 30000;
function loadSkillbar() {
  if (sbLoading) return sbLoading;
  sbLoading = (async () => {
    try { skillbar = await window.api.invoke('skills:get'); rotationPos = 0; }
    catch (e) { skillbar = { ok: false, error: e.message }; }
    sbFailedAt = skillbar?.ok ? 0 : Date.now();
    render();
  })().finally(() => { sbLoading = null; });
  return sbLoading;
}

// Manuell draing i redigeringsmodus (se wheel.js for hvorfor CSS-drag ikke brukes). Strekking i kantene håndteres av Electron.
let dragging = false;
document.body.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('edit') || e.button !== 0) return;
  dragging = true; document.body.setPointerCapture(e.pointerId);
  window.api.invoke('win:drag', { target: TYPE, phase: 'start', x: e.screenX, y: e.screenY });
});
document.body.addEventListener('pointermove', (e) => { if (dragging) window.api.invoke('win:drag', { target: TYPE, phase: 'move', x: e.screenX, y: e.screenY }); });
const endDrag = (e) => { if (!dragging) return; dragging = false; try { document.body.releasePointerCapture(e.pointerId); } catch { /* ok */ } window.api.invoke('win:drag', { target: TYPE, phase: 'end' }); };
document.body.addEventListener('pointerup', endDrag);
document.body.addEventListener('pointercancel', endDrag);

window.api.on('live:state', (s) => { snap = s; render(); });
window.api.on('overlays:changed', ({ type, config }) => { if (type === TYPE) applyConfig(config); });
window.api.on('skills:changed', () => loadSkillbar());
window.api.on('mumble:state', (m) => {
  if (TYPE !== 'skillbar' || !m.identity?.name) return;
  const trigger = `${m.identity.name}|${m.identity.spec || 0}`;
  if (trigger === sbTrigger) {
    // Samme karakter og spec som sist: bare et nytt forsøk etter feil, og ikke oftere enn hvert 30. sekund
    if (!sbFailedAt || Date.now() - sbFailedAt < SB_RETRY_MS) return;
  } else if (skillbar?.ok && skillbar.character === m.identity.name && skillbar.specId === m.identity.spec) {
    sbTrigger = trigger; // allerede lastet for denne kombinasjonen (oppstart)
    return;
  }
  sbTrigger = trigger;
  loadSkillbar();
});
// Språkbytte: ny ordbok, så hint og statuslinje tegnes på nytt (feilmeldingen fra skills:get hentes på nytt)
window.api.on('config:changed', async (c) => { if (await T.sync(c) && cfg) { applyConfig(cfg); if (TYPE === 'skillbar' && !skillbar?.ok) loadSkillbar(); } });
T.load().then(() => {
  window.api.invoke('overlays:get').then((all) => applyConfig(all[TYPE]));
  window.api.invoke('live:get').then((s) => { snap = s; render(); });
  if (TYPE === 'skillbar') loadSkillbar();
});
setInterval(() => { if (snap) { const dt = 100; for (const b of snap.buffs || []) b.remainingMs -= dt; for (const b of snap.target?.buffs || []) b.remainingMs -= dt; for (const c of snap.cooldowns || []) c.sinceMs += dt; if (snap.dps?.current) snap.dps.current.durationMs += dt; render(); } }, 100);
