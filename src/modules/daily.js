'use strict';
// "I dag"-modul (hovedprosess): Wizard's Vault, world bosses drept i dag, kart-kister, daglig crafting, fraktaler.
const gw2 = require('../gw2');

const FRACTAL_CATEGORY = 88;
let cache = { at: 0, key: '', data: null };

function resets() {
  const now = new Date();
  const daily = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  let weekly = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 30);
  while (new Date(weekly).getUTCDay() !== 1 || weekly <= now.getTime()) weekly += 864e5;
  return { daily, weekly };
}

const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: e.message }));

async function fetchDaily(key) {
  if (!key) throw new Error('Ingen API-nøkkel.');
  if (cache.data && cache.key === key && Date.now() - cache.at < 60e3) return cache.data;
  const g = (ep, params) => gw2.get(ep, { key, params });
  const [wvD, wvW, wvS, wbAll, wbDone, mcAll, mcDone, dcAll, dcDone, fracCat] = await Promise.all([
    settle(g('/account/wizardsvault/daily')), settle(g('/account/wizardsvault/weekly')), settle(g('/account/wizardsvault/special')),
    settle(g('/worldbosses')), settle(g('/account/worldbosses')),
    settle(g('/mapchests')), settle(g('/account/mapchests')),
    settle(g('/dailycrafting')), settle(g('/account/dailycrafting')),
    settle(g(`/achievements/categories/${FRACTAL_CATEGORY}`)),
  ]);
  const errors = [];
  const need = (r, what) => { if (!r.ok) errors.push(`${what}: ${r.e}`); return r.ok ? r.v : null; };

  let fractals = [];
  const cat = need(fracCat, 'Fraktaler');
  if (cat?.achievements?.length) {
    const ids = cat.achievements.map((a) => (typeof a === 'object' ? a.id : a));
    const [defs, prog] = await Promise.all([
      settle(g('/achievements', { ids: ids.join(',') })),
      settle(g('/account/achievements', { ids: ids.join(',') })),
    ]);
    const progMap = new Map((prog.ok ? prog.v : []).map((p) => [p.id, p]));
    fractals = (defs.ok ? defs.v : []).map((d) => {
      const p = progMap.get(d.id);
      return { id: d.id, name: d.name, requirement: d.requirement, done: !!p?.done, current: p?.current ?? 0, max: p?.max ?? (d.tiers?.at(-1)?.count || 1) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    if (!prog.ok) errors.push('Fraktal-fremdrift: ' + prog.e);
  }

  const data = {
    fetchedAt: Date.now(),
    resets: resets(),
    wizard: { daily: need(wvD, 'Wizard\'s Vault daglig'), weekly: need(wvW, 'Wizard\'s Vault ukentlig'), special: need(wvS, 'Wizard\'s Vault spesial') },
    worldbosses: { all: need(wbAll, 'World bosses') || [], done: need(wbDone, 'World bosses i dag') || [] },
    mapchests: { all: need(mcAll, 'Kart-kister') || [], done: need(mcDone, 'Kart-kister i dag') || [] },
    dailycrafting: { all: need(dcAll, 'Daglig crafting') || [], done: need(dcDone, 'Daglig crafting i dag') || [] },
    fractals,
    errors,
  };
  cache = { at: Date.now(), key, data };
  return data;
}

// Kobler navn fra tidsplanen til API-id for world bosses
const BOSS_ALIAS = { 'golem mark ii': 'inquest_golem_mark_ii', 'triple trouble': 'triple_trouble_wurm', 'evolved jungle wurm': 'triple_trouble_wurm' };
function bossIdFromName(name) {
  const n = String(name || '').toLowerCase().trim();
  if (BOSS_ALIAS[n]) return BOSS_ALIAS[n];
  return n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
}

module.exports = { fetchDaily, resets, bossIdFromName, invalidate: () => { cache.at = 0; } };
