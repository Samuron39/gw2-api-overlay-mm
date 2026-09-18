'use strict';
// Overlay-vindu: type fra URL (buffs, debuffs, target, skillbar). Tegner fra live-tilstanden 10 ganger i sekundet.
const TYPE = new URLSearchParams(location.search).get('type') || 'buffs';
const KIND = TYPE.startsWith('dps') ? 'dps' : TYPE; // dps, dps2 og dps3 tegnes likt
const BOONS = { 740: 'MGT', 725: 'FUR', 1187: 'QCK', 30328: 'ALA', 717: 'PRO', 718: 'REG', 719: 'SWF', 726: 'VIG', 1122: 'STB', 743: 'AEG', 873: 'RES', 26980: 'RST' };
const CONDS = { 736: 'BLD', 737: 'BRN', 861: 'CNF', 723: 'PSN', 19426: 'TRM', 720: 'BLN', 722: 'CHL', 721: 'CRP', 791: 'FER', 727: 'IMM', 26766: 'SLW', 27705: 'TNT', 742: 'WKN', 738: 'VLN' };
let cfg = null;
let snap = null;
let dragging = false; // manuell draing pågår (se nederst)
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
const dpBar = document.getElementById('dpsbar');
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
  if (BOONS[b.skill] || CONDS[b.skill]) return `../../assets/effects/${esc(b.skill)}.png`;
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
  const isSb = TYPE === 'skillbar', isDps = KIND === 'dps';
  grid.hidden = isSb || isDps; sb.hidden = !isSb; sbStatus.hidden = !isSb; dp.hidden = !isDps; dpBar.hidden = !isDps;
  hint.style.display = isDps ? 'none' : ''; // DPS-vinduet har verktøylinja med låseknapp; hintet ville dekket den
  document.documentElement.style.setProperty('--fs', (c.fontSize || 14) + 'px');
  if (isDps) renderDpsBar();
  // Hovedprosessen setter klikk-gjennom på nytt ved hver innstillingsendring; glem hover-tilstanden så neste
  // musebevegelse over verktøylinja ber om klikk igjen (ellers virket bare første klikk)
  barHover = false;
  render();
  fetchDetail();
}

// ---------- Verktøylinja i DPS-vinduet ----------
// Visning, periode og lås rett i boksen. Låst vindu slipper klikk gjennom til spillet, men mousemove kommer likevel
// (setIgnoreMouseEvents med forward), så når pekeren er over verktøylinja slår vi klikk-gjennom av midlertidig, som hjulet gjør.
// Nedtrekksmenyer (<select>) får ikke åpnet lista si i gjennomsiktige, rammeløse vinduer, så valgene er knapper som blar videre.
const VIEWS = ['all', 'damage', 'squad', 'taken', 'healing'];
const PERIODS = ['fight', 'last', 'session'];
// ---------- Spillerliste med detaljer (squad-visningen) ----------
// dpPlayer: null = lista, 'self' eller agent-id = detaljer for den spilleren (åpnes inne i meteret, «Tilbake» lukker).
// dpTarget: 'all', 'current' (nåværende mål) eller agent-id for en fiende i perioden. Tallene hentes ved behov med
// live:detail, så den faste live:state-strømmen ikke vokser med squad-størrelsen. Valgene huskes bare i vinduet.
let dpPlayer = null, dpTarget = 'all', detail = null, detailBusy = false, detailAgain = false, barKey = '';
const playersMode = () => KIND === 'dps' && !!cfg && (cfg.view === 'squad' || dpPlayer != null);
async function fetchDetail() {
  if (!playersMode()) return;
  if (detailBusy) { detailAgain = true; return; }
  detailBusy = true;
  try { detail = await window.api.invoke('live:detail', { period: cfg.period || 'fight', player: dpPlayer, target: dpTarget === 'all' ? null : dpTarget }); }
  catch { detail = null; }
  detailBusy = false;
  render();
  if (detailAgain) { detailAgain = false; fetchDetail(); }
}
function targetLabel() {
  if (dpTarget === 'all') return T.t('overlay.dps.target.all');
  if (dpTarget === 'current') return T.t('overlay.dps.target.current');
  if (dpTarget === 'bosses') return T.t('overlay.dps.target.bosses');
  const name = detail?.targets?.find((t) => t.id === dpTarget)?.name || detail?.target?.name || '#' + dpTarget;
  return T.t('overlay.dps.target.named', { name });
}
function nextTarget() {
  // «Bosser» (champion og opp) tilbys bare når perioden faktisk har en slik fiende
  const list = ['all', 'current', ...((detail?.targets || []).some((t) => t.rank >= 3) ? ['bosses'] : []), ...(detail?.targets || []).map((t) => t.id)];
  const i = list.indexOf(dpTarget);
  dpTarget = list[(i + 1) % list.length];
  renderDpsBar(); fetchDetail();
}
function renderDpsBar() {
  const view = VIEWS.includes(cfg.view) ? cfg.view : 'all', period = PERIODS.includes(cfg.period) ? cfg.period : 'fight';
  const players = playersMode();
  barKey = [view, period, cfg.locked, players, players ? targetLabel() : ''].join('|');
  dpBar.classList.toggle('four', players);
  dpBar.innerHTML = `<button id="dpView" title="${esc(T.t('live.view'))}">${esc(T.t('live.view.' + view))} ▸</button>`
    + `<button id="dpPeriod" title="${esc(T.t('live.period'))}">${esc(T.t('live.period.' + period))} ▸</button>`
    + (players ? `<button id="dpTarget" title="${esc(T.t('overlay.dps.target.title'))}">${esc(targetLabel())} ▸</button>` : '')
    + `<button id="dpLock" class="lock ${cfg.locked ? 'locked' : ''}" title="${esc(T.t(cfg.locked ? 'wheel.unlockPosition' : 'wheel.lockPosition'))}">${cfg.locked ? '🔒' : '🔓'}</button>`;
  const next = (list, cur) => list[(list.indexOf(cur) + 1) % list.length];
  dpBar.querySelector('#dpView').addEventListener('click', () => { dpPlayer = null; window.api.invoke('overlays:set', TYPE, { view: next(VIEWS, view) }); });
  dpBar.querySelector('#dpTarget')?.addEventListener('click', nextTarget);
  dpBar.querySelector('#dpPeriod').addEventListener('click', () => window.api.invoke('overlays:set', TYPE, { period: next(PERIODS, period) }));
  dpBar.querySelector('#dpLock').addEventListener('click', () => window.api.invoke('overlays:set', TYPE, { locked: !cfg.locked }));
}
let barHover = false;
document.addEventListener('mousemove', (e) => {
  if (KIND !== 'dps' || !cfg?.locked) return;
  if (dragging) return;
  const over = !!(e.target && e.target.closest && e.target.closest('#dpsbar, .click')); // verktøylinja og klikkbare rader
  if (over !== barHover) { barHover = over; window.api.invoke('overlays:ignoreMouse', TYPE, !over); }
});
document.addEventListener('mouseleave', () => { if (barHover) { barHover = false; window.api.invoke('overlays:ignoreMouse', TYPE, true); } });
// Draing i redigeringsmodus skal ikke starte fra verktøylinja (den har egne kontroller)
dpBar.addEventListener('pointerdown', (e) => e.stopPropagation());
// Klikk på rader: pointerdown med delegering, fordi radene tegnes på nytt ti ganger i sekundet og et vanlig click
// (ned og opp på SAMME element) da ofte uteblir. Stopper også draing fra radene i redigeringsmodus.
dp.addEventListener('pointerdown', (e) => {
  const el = e.target?.closest?.('.click');
  if (!el || e.button !== 0) return;
  e.stopPropagation();
  const num = (v) => (v === 'self' || v === 'current' || v === 'all' || v === 'bosses' ? v : Number(v));
  if (el.dataset.back) dpPlayer = null;
  else if (el.dataset.player != null) dpPlayer = num(el.dataset.player);
  else if (el.dataset.target != null) { const t = num(el.dataset.target); dpTarget = dpTarget === t ? 'all' : t; }
  else return;
  detail = dpPlayer != null && detail ? { ...detail, player: null, pending: true } : detail;
  renderDpsBar(); render(); fetchDetail();
});

// ---------- DPS-måler ----------
function fmtK(n) { n = Math.round(n || 0); return n >= 100000 ? Math.round(n / 1000) + 'k' : n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); }
function fmtDur(ms) { const s = Math.max(0, Math.round(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); }
function esc(s) { return String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch])); }
const SAMPLE_DETAIL = () => {
  const players = [
    { id: 1, rank: 1, name: 'Kara Nightwind', self: false, dmg: 380520, dps: 21140, pct: 45, heal: 0, hps: 0 },
    { id: 'self', rank: 2, name: 'Morticon Storm', self: true, dmg: 287640, dps: 15980, pct: 34, heal: 41200, hps: 2290 },
    { id: 2, rank: 3, name: 'Thorn Ironbark', self: false, dmg: 176300, dps: 9790, pct: 21, heal: 96000, hps: 5330 },
  ];
  const row = players.find((p) => p.id === dpPlayer) || null;
  return { sample: true, empty: false, active: true, durationMs: 18000, total: 844460, dps: 46910, target: null, players,
    targets: [{ id: 9, name: 'Legendary Destroyer', dmg: 700000, pct: 83, current: true }, { id: 8, name: 'Destroyer Troll', dmg: 144460, pct: 17 }],
    player: row && { ...row, skills: [{ name: 'Arc Divider', dmg: Math.round(row.dmg * 0.4), hits: 6, pct: 40 }, { name: 'Decapitate', dmg: Math.round(row.dmg * 0.35), hits: 9, pct: 35 }, { name: 'Bleeding', dmg: Math.round(row.dmg * 0.25), hits: 41, pct: 25 }],
      targets: [{ id: 9, name: 'Legendary Destroyer', dmg: Math.round(row.dmg * 0.8), pct: 80, current: true }, { id: 8, name: 'Destroyer Troll', dmg: Math.round(row.dmg * 0.2), pct: 20 }] } };
};
// Rangmerke foran fiendenavn: ★ boss, ◆ legendary/champion, ◇ elite, ▪ veteran. Rangen kommer fra live.js (enemy-rank.js).
const RANK_MARK = { boss: '★', legendary: '◆', champion: '◆', elite: '◇', veteran: '▪' };
function rankMark(t) { const m = RANK_MARK[t?.rankKey]; return m ? `<span class="rk rk-${esc(t.rankKey)}" title="${esc(T.t('overlay.dps.rank.' + t.rankKey))}">${m}</span> ` : ''; }
function renderPlayers() {
  const edit = document.body.classList.contains('edit');
  let d = detail;
  if ((!d || d.empty) && edit) d = SAMPLE_DETAIL();
  const key = [VIEWS.includes(cfg.view) ? cfg.view : 'all', PERIODS.includes(cfg.period) ? cfg.period : 'fight', cfg.locked, true, targetLabel()].join('|');
  if (key !== barKey) renderDpsBar(); // målnavnet kan komme først med svaret
  const back = dpPlayer != null ? `<div class="bk click" data-back="1">${esc(T.t('overlay.dps.back'))}</div>` : '';
  if (!d || d.empty) { dp.innerHTML = back + `<div class="top"><span class="big idle">–</span><span class="lbl">DPS</span></div><div class="sub">${esc(T.t(cfg.period === 'session' ? 'overlay.dps.noSession' : 'overlay.dps.noFight'))}</div>`; return; }
  const rows = [];
  const tname = d.target ? (d.target.id === 'bosses' ? T.t('overlay.dps.target.bossesN', { n: d.target.count }) : (d.target.name || T.t('overlay.dps.target.none'))) : '';
  const sample = d.sample ? `<span class="lbl">(${esc(T.t('overlay.dps.sample'))})</span>` : '';
  if (dpPlayer == null) {
    // ---------- Lista: én linje per spiller, klikk for detaljer ----------
    rows.push(`<div class="top"><span class="big ${d.active ? '' : 'idle'}">${fmtK(d.dps)}</span><span class="lbl">${esc(T.t('overlay.dps.group'))}</span>${sample}</div>`);
    rows.push(`<div class="sub" title="${esc(T.t('overlay.dps.delayNote'))}">${esc(T.t('overlay.dps.line', { dur: fmtDur(d.durationMs), avg: fmtK(d.dps), total: fmtK(d.total) }))}${tname ? ' · ' + esc(tname) : ''}</div>`);
    const top = Math.max(1, ...d.players.map((p) => p.dmg || 0));
    for (const p of d.players) {
      rows.push(`<div class="sq click${p.self ? ' me' : ''}" data-player="${esc(p.id)}"><span class="bar" style="--w:${Math.round((p.dmg || 0) / top * 100)}%"></span><span class="n">${p.rank}. ${esc(shortName(p.name || (p.self ? T.t('overlay.dps.you') : '?')))}</span>${p.hps ? `<span class="h">+${fmtK(p.hps)}</span>` : ''}<span class="v">${fmtK(p.dps)} · ${p.pct || 0}%</span></div>`);
    }
    dp.innerHTML = rows.join('');
    return;
  }
  // ---------- Detaljer for én spiller ----------
  const p = d.player;
  if (!p) { dp.innerHTML = back + `<div class="sub">${esc(T.t(d.pending ? 'overlay.dps.loading' : 'overlay.dps.noPlayerData'))}</div>`; return; }
  rows.push(`<div class="bkrow">${back}<span class="pn">${esc(p.name || (p.self ? T.t('overlay.dps.you') : '?'))}</span></div>`);
  rows.push(`<div class="top"><span class="big ${d.active ? '' : 'idle'}">${fmtK(p.dps)}</span><span class="lbl">DPS · ${esc(T.t('overlay.dps.rank', { n: p.rank }))}</span>${p.hps ? `<span class="lbl h">+${fmtK(p.hps)} HPS</span>` : ''}${sample}</div>`);
  rows.push(`<div class="sub">${esc(T.t('overlay.dps.playerLine', { dur: fmtDur(d.durationMs), total: fmtK(p.dmg), pct: p.pct || 0 }))}${tname ? ' · ' + esc(tname) : ''}</div>`);
  if (!p.skills.length) rows.push(`<div class="sub muted">${esc(T.t('overlay.dps.noTargetDamage'))}</div>`);
  for (const s of p.skills.slice(0, 8)) rows.push(`<div class="sk"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || s.skill)}</span><span class="v">${fmtK(s.dmg)} · ${s.pct || 0}% · ${s.hits}×</span></div>`);
  if (p.targets.length) {
    rows.push(`<div class="sqh">${esc(T.t('overlay.dps.targetsTitle'))}</div>`);
    for (const t of p.targets.slice(0, 5)) rows.push(`<div class="sk tgr click${dpTarget === t.id ? ' on' : ''}" data-target="${esc(t.id)}"><span class="bar" style="--w:${t.pct || 0}%"></span><span class="n">${t.current ? '◉ ' : ''}${rankMark(t)}${esc(t.name || '#' + t.id)}</span><span class="v">${fmtK(t.dmg)} · ${t.pct || 0}%</span></div>`);
  }
  if (p.takenBySource?.length) {
    rows.push(`<div class="tkh">${esc(T.t('overlay.dps.takenTitle'))} · ${fmtK(p.taken)}</div>`);
    for (const s of p.takenBySource.slice(0, 3)) rows.push(`<div class="sk tkr"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || '?')}</span><span class="v">${fmtK(s.dmg)} · ${s.pct || 0}%</span></div>`);
  }
  if (p.healBySkill?.length) {
    rows.push(`<div class="sqh">${esc(T.t('overlay.dps.healTitle'))} · ${fmtK(p.heal)}</div>`);
    for (const s of p.healBySkill.slice(0, 3)) rows.push(`<div class="sk hs"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || s.skill)}</span><span class="v">${fmtK(s.heal)} · ${s.pct || 0}%</span></div>`);
  }
  dp.innerHTML = rows.join('');
}
function renderDps() {
  if (!cfg) return;
  if (playersMode()) { renderPlayers(); return; }
  const d = snap?.dps || {};
  const edit = document.body.classList.contains('edit');
  let cur = d.current, last = d.last, sample = false;
  let death = d.death;
  if (!cur && !last && edit) {
    sample = true;
    cur = { active: true, dps10: 18420, dps: 15980, total: 287640, durationMs: 18000, taken: 9120, target: 'Legendary Destroyer', skills: [{ name: 'Arc Divider', dmg: 98000, pct: 34 }, { name: 'Decapitate', dmg: 61000, pct: 21 }, { name: 'Bleeding', dmg: 40000, pct: 14 }],
      // Squad-DPS: eksempel med tre spillere så brukeren ser hvordan lista blir
      squad: [{ name: 'Kara Nightwind', self: false, dmg: 380520, dps: 21140, pct: 45 }, { name: 'Morticon Storm', self: true, dmg: 287640, dps: 15980, pct: 34 }, { name: 'Thorn Ironbark', self: false, dmg: 176300, dps: 9790, pct: 21 }],
      takenBySource: [{ name: 'Legendary Destroyer', dmg: 5200, hits: 6, pct: 57 }, { name: 'Destroyer Troll', dmg: 2900, hits: 4, pct: 32 }, { name: 'Destroyer Harpy', dmg: 1020, hits: 3, pct: 11 }] };
    death = { downed: true, killer: 'Destroyer Troll', skill: 'Flame Burst', amount: 4200, hits: [] };
    cur.healing = { available: true, done: 41200, barrier: 6000, hps: 2290, hps10: 3120, received: 12800, bySkill: [{ name: 'Healing Spring', heal: 18000, pct: 44 }, { name: 'Regeneration', heal: 12000, pct: 29 }, { name: 'Blast Finisher', heal: 6000, pct: 15 }], bySource: [] }; // healing-eksempel
  }
  // Periode: denne kampen (med forrige som reserve utenfor kamp), forrige kamp, eller hele økta. Visning: hvilke seksjoner.
  const period = cfg.period || 'fight';
  const view = cfg.view || 'all';
  const vDamage = view === 'all' || view === 'damage', vSquad = view === 'all' || view === 'squad', vTaken = view === 'all' || view === 'taken', vHeal = view === 'all' || view === 'healing';
  let show, active = false, isSession = false;
  if (period === 'session' && !sample) { show = d.session && (d.session.fights > 0) ? d.session : null; isSession = !!show; }
  else if (period === 'last' && !sample) show = last;
  else { show = cur || (cfg.showLast !== false ? last : null); active = !!cur; }
  if (!show && sample) { show = cur; active = true; }
  if (!show) { dp.innerHTML = `<div class="top"><span class="big idle">–</span><span class="lbl">${view === 'healing' ? 'HPS' : 'DPS'}</span></div><div class="sub">${esc(T.t(period === 'session' ? 'overlay.dps.noSession' : 'overlay.dps.noFight'))}</div>`; return; }
  const h0 = show.healing || {};
  const main = view === 'healing' ? (active ? h0.hps10 : h0.hps) : (active ? show.dps10 : show.dps);
  const label = view === 'healing' ? (active ? T.t('overlay.dps.hpsNow') : T.t('overlay.dps.hps')) : (active ? T.t('overlay.dps.now') : isSession ? T.t('overlay.dps.session') : T.t('overlay.dps.last'));
  const rows = [];
  rows.push(`<div class="top"><span class="big ${active ? '' : 'idle'}">${fmtK(main)}</span><span class="lbl">${esc(label)}</span>${sample ? `<span class="lbl">(${esc(T.t('overlay.dps.sample'))})</span>` : ''}</div>`);
  const line = view === 'healing'
    ? (isSession ? T.t('overlay.dps.sessionLine', { fights: show.fights, dur: fmtDur(show.combatMs), avg: fmtK(h0.hps), total: fmtK(h0.done) }) + ' · ' : '') + T.t('overlay.dps.healLine', { total: fmtK(h0.done), received: fmtK(h0.received) })
    : isSession
      ? T.t('overlay.dps.sessionLine', { fights: show.fights, dur: fmtDur(show.combatMs), avg: fmtK(show.dps), total: fmtK(show.total) })
      : T.t('overlay.dps.line', { dur: fmtDur(show.durationMs), avg: fmtK(show.dps), total: fmtK(show.total) });
  rows.push(`<div class="sub">${esc(line)}${!isSession && show.target ? ' · ' + esc(show.target) : ''}${vTaken && cfg.showTaken !== false && show.taken ? ` · <span class="tk">${esc(T.t('overlay.dps.taken', { n: fmtK(show.taken) }))}</span>` : ''}</div>`);
  const n = Number(cfg.showSkills ?? 3);
  if (view === 'healing') for (const s of (h0.bySkill || []).slice(0, Math.max(n, 3))) rows.push(`<div class="sk hs"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || s.skill)}</span><span class="v">${fmtK(s.heal)} · ${s.pct || 0}%</span></div>`);
  for (const s of (vDamage ? (show.skills || []) : []).slice(0, n)) rows.push(`<div class="sk"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || s.skill)}</span><span class="v">${fmtK(s.dmg)} · ${s.pct || 0}%</span></div>`);
  // ---------- Squad-DPS ----------
  // Rangert liste over squaden (som en WoW-måler) når flere enn deg har gjort skade. Søyla er relativ til den øverste,
  // pct er andel av squadens samlede skade. Din rad er alltid med, også når du ligger under de viste radene.
  const squad = show.squad || [];
  if (vSquad && cfg.showSquad !== false && squad.length > 1) {
    const rowsN = Math.max(1, Math.min(10, Number(cfg.squadRows ?? 5)));
    const list = squad.slice(0, rowsN);
    const me = squad.find((p) => p.self);
    if (me && !list.includes(me)) list[list.length - 1] = me;
    const top = squad[0]?.dmg || 1;
    rows.push(`<div class="sqh">${esc(T.t('overlay.dps.squad', { n: squad.length }))}</div>`);
    for (const p of list) {
      const rank = squad.indexOf(p) + 1;
      rows.push(`<div class="sq click${p.self ? ' me' : ''}" data-player="${p.self ? 'self' : esc(p.id ?? '')}"><span class="bar" style="--w:${Math.round((p.dmg || 0) / top * 100)}%"></span><span class="n">${rank}. ${esc(shortName(p.name))}</span><span class="v">${fmtK(p.dps)} · ${p.pct || 0}%</span></div>`);
    }
  }
  // Mottatt: topp kilder (minions tilskrevet eieren) med andel av alt mottatt, søyle i rød tone
  if (vTaken && cfg.showTaken !== false) {
    const tn = Number(cfg.takenRows ?? 3);
    const src = (show.takenBySource || []).slice(0, tn);
    if (src.length) {
      rows.push(`<div class="tkh">${esc(T.t('overlay.dps.takenTitle'))}</div>`);
      for (const s of src) rows.push(`<div class="sk tkr"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || s.id || '?')}</span><span class="v">${fmtK(s.dmg)} · ${s.pct || 0}%</span></div>`);
    }
  }
  // Dødslogg: «Nedkjempet av X · siste: skill 4.2k» så lenge den finnes (til neste kampstart)
  if (vTaken && death) {
    const who = T.t(death.downed ? 'overlay.dps.downedBy' : 'overlay.dps.killedBy', { killer: death.killer || '?' });
    const lastHit = death.skill ? ' · ' + T.t('overlay.dps.lastHit', { skill: death.skill, amount: fmtK(death.amount) }) : '';
    rows.push(`<div class="death"><b>${esc(who)}</b>${esc(lastHit)}</div>`);
  }
  // Healing (HPS): egen healing fra chatbox-kanalen via broen, se docs/healing-api.md. available = broen har meldt
  // heal-støtte (hello.heal) eller healing er telt. Uten det: en diskret linje bare i redigeringsmodus.
  if (vHeal && view !== 'healing' && cfg.showHealing !== false) {
    const h = show.healing;
    if (h && h.available) {
      rows.push(`<div class="hl"><span class="hv">${fmtK(active ? h.hps10 : h.hps)}</span><span class="lbl">${esc(T.t(active ? 'overlay.dps.hpsNow' : 'overlay.dps.hps'))}</span><span class="sub">${esc(T.t('overlay.dps.healLine', { total: fmtK(h.done), received: fmtK(h.received) }))}</span></div>`);
      for (const s of (h.bySkill || []).slice(0, Math.min(3, n))) rows.push(`<div class="sk hs"><span class="bar" style="--w:${s.pct || 0}%"></span><span class="n">${esc(s.name || s.skill)}</span><span class="v">${fmtK(s.heal)} · ${s.pct || 0}%</span></div>`);
    } else if (edit) rows.push(`<div class="sub muted">${esc(T.t('overlay.dps.healingUnavailable'))}</div>`);
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
  // Målvinduet: navnet på målet med rangmerke (★ boss, ◆ legendary/champion, ◇ elite, ▪ veteran) øverst, også når målet
  // ikke har noen conditions. Rangen kommer ferdig fra live.js (snapshot.target.rankKey, se src/modules/enemy-rank.js).
  let head = '';
  if (TYPE === 'target' && cfg.showTargetName !== false) {
    const edit = document.body.classList.contains('edit');
    const tg = snap?.target || (edit ? { name: 'Legendary Destroyer', rankKey: 'legendary' } : null);
    if (tg && (tg.name || tg.rankKey !== 'normal')) head = `<div class="tn rk-${esc(tg.rankKey || 'normal')}">${rankMark(tg)}<span class="tnn">${esc(tg.name || '')}</span></div>`;
  }
  if (!list.length && !document.body.classList.contains('edit')) { grid.innerHTML = head; return; }
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
    grid.innerHTML = head + list.map((b) => {
      const k = classify(b.skill);
      const total = b.max || Math.max(b.remainingMs, 10000);
      const w = Math.max(0, Math.min(100, (b.remainingMs / total) * 100));
      const icon = iconFor(b);
      return `<div class="l ${k} ${b.remainingMs < 2000 ? 'short' : ''}" title="${esc(b.name)}">
        ${showShade ? `<div class="sh" style="--w:${w.toFixed(1)}%"></div>` : ''}
        ${icon ? `<img class="ic2" src="${esc(icon)}" data-skill="${esc(b.skill)}" alt="" />` : ''}
        <span class="nm2">${esc(b.name)}</span>
        ${b.stacks > 1 ? `<span class="st2">×${esc(b.stacks)}</span>` : ''}
        ${showNum ? `<span class="tm2">${fmtSec(b.remainingMs)}s</span>` : ''}
      </div>`;
    }).join('');
    return;
  }
  grid.innerHTML = head + list.map((b) => {
    const k = classify(b.skill);
    const total = b.max || Math.max(b.remainingMs, 10000);
    const p = Math.max(0, Math.min(1, 1 - b.remainingMs / total));
    const showNum = cfg.mode === 'number' || cfg.mode === 'both';
    const showPie = cfg.mode === 'clock' || cfg.mode === 'both';
    const icon = iconFor(b);
    return `<div class="b ${k} ${b.remainingMs < 2000 ? 'short' : ''}" style="width:${size}px;height:${size}px;font-size:${size}px" title="${esc(b.name)}">
      ${icon ? `<img class="ic" src="${esc(icon)}" data-skill="${esc(b.skill)}" alt="" />` : ''}
      ${showPie ? `<div class="pie" style="--p:${Math.round(p * 100)}%"></div>` : ''}
      ${icon ? '' : `<span class="ab">${esc(abbr(b))}</span>`}
      ${b.stacks > 1 ? `<span class="st">${esc(b.stacks)}</span>` : ''}
      ${showNum ? `<span class="tm">${fmtSec(b.remainingMs)}</span>` : ''}
      ${cfg.showNames ? `<span class="nm">${esc(b.name)}</span>` : ''}
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

// Tegnefeil skal ikke stoppe vinduet stille: de logges (havner i app.log via console-message) og neste tegning prøver igjen
let renderErrors = 0;
function render() {
  if (dragging) return; // ingen ny tegning mens vinduet dras: elementet under pekeren skal ikke byttes ut midt i draget
  try { if (TYPE === 'skillbar') renderSkillbar(); else if (KIND === 'dps') renderDps(); else renderBuffs(); }
  catch (e) { if (renderErrors++ < 5) console.error('overlay ' + TYPE + ' render: ' + (e.stack || e.message)); }
}
// Diagnose til feilrapporten (ipc.js log:report kjører denne i hvert overlay-vindu)
window.__diag = () => ({
  type: TYPE, kind: KIND, cfg: cfg && { view: cfg.view, period: cfg.period, locked: cfg.locked, enabled: cfg.enabled, w: cfg.w, h: cfg.h, fontSize: cfg.fontSize },
  edit: document.body.classList.contains('edit'), size: [innerWidth, innerHeight], zoom: devicePixelRatio,
  dpsHidden: dp.hidden, dpsText: (dp.innerText || '').replace(/\n/g, ' | ').slice(0, 160), gridHidden: grid.hidden,
  snap: !!snap, dps: snap?.dps ? { cur: !!snap.dps.current, last: !!snap.dps.last, fights: snap.dps.session?.fights } : null,
  renderErrors, lang: T.language,
});

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
document.body.addEventListener('pointerdown', (e) => {
  if (!document.body.classList.contains('edit') || e.button !== 0) return;
  dragging = true; document.body.setPointerCapture(e.pointerId);
  window.api.invoke('win:drag', { target: TYPE, phase: 'start', x: e.screenX, y: e.screenY });
});
document.body.addEventListener('pointermove', (e) => { if (dragging) window.api.invoke('win:drag', { target: TYPE, phase: 'move', x: e.screenX, y: e.screenY }); });
const endDrag = (e) => { if (!dragging) return; dragging = false; try { document.body.releasePointerCapture(e.pointerId); } catch { /* ok */ } window.api.invoke('win:drag', { target: TYPE, phase: 'end' }); };
document.body.addEventListener('pointerup', endDrag);
document.body.addEventListener('pointercancel', endDrag);

window.api.on('live:state', (s) => { snap = s; render(); fetchDetail(); });
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
