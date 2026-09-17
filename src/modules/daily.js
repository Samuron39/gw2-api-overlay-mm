'use strict';
// "I dag"-modul (hovedprosess): Wizard's Vault, world bosses drept i dag, kart-kister, daglig crafting, fraktaler.
const gw2 = require('../gw2');
const { t } = require('../i18n');

const FRACTAL_CATEGORY = 88;
let cache = { at: 0, key: '', data: null };
const bossCache = new Map();

// Tidsplan trenger bare ett endepunkt, ikke hele Wizard's Vault-/fraktaloversikten.
async function fetchWorldbosses(key, { force = false } = {}) {
  if (!key) throw new Error(t('common.noApiKeyShort'));
  const now = Date.now(), day = Math.floor(now / 864e5);
  let entry = bossCache.get(key);
  if (entry?.pending) return entry.pending;
  if (!force && entry?.data && entry.day === day && now - entry.at < 60e3) return entry.data;
  if (!entry) { entry = {}; bossCache.clear(); bossCache.set(key, entry); }
  const pending = gw2.get('/account/worldbosses', { key }).then((done) => {
    const data = { done, fetchedAt: Date.now() };
    entry.data = data; entry.at = data.fetchedAt; entry.day = day;
    return data;
  });
  entry.pending = pending;
  try { return await pending; } finally { if (entry.pending === pending) entry.pending = null; }
}

function resets() {
  const now = new Date();
  const daily = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  let weekly = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 7, 30);
  while (new Date(weekly).getUTCDay() !== 1 || weekly <= now.getTime()) weekly += 864e5;
  return { daily, weekly };
}

const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: e.message }));

async function fetchDaily(key) {
  if (!key) throw new Error(t('common.noApiKeyShort'));
  if (cache.data && cache.key === key && Date.now() - cache.at < 60e3) return cache.data;
  const g = (ep, params, extra) => gw2.get(ep, { key, params, ...(extra || {}) });
  const [wvD, wvW, wvS, wbAll, wbDone, mcAll, mcDone, dcAll, dcDone, fracCat] = await Promise.all([
    settle(g('/account/wizardsvault/daily')), settle(g('/account/wizardsvault/weekly')), settle(g('/account/wizardsvault/special')),
    settle(g('/worldbosses')), settle(fetchWorldbosses(key).then((d) => d.done)),
    settle(g('/mapchests')), settle(g('/account/mapchests')),
    settle(g('/dailycrafting')), settle(g('/account/dailycrafting')),
    settle(g(`/achievements/categories/${FRACTAL_CATEGORY}`)),
  ]);
  const errors = [];
  const need = (r, what) => { if (!r.ok) errors.push(`${what}: ${r.e}`); return r.ok ? r.v : null; };

  let fractals = [];
  const cat = need(fracCat, t('daily.src.fractals'));
  if (cat?.achievements?.length) {
    const ids = cat.achievements.map((a) => (typeof a === 'object' ? a.id : a));
    const [defs, prog] = await Promise.all([
      settle(g('/achievements', { ids: ids.join(',') })),
      settle(g('/account/achievements', { ids: ids.join(',') }, { bulk: true })), // 404 = ingen fremdrift på noen av dem
    ]);
    const progMap = new Map((prog.ok ? prog.v : []).map((p) => [p.id, p]));
    fractals = (defs.ok ? defs.v : []).map((d) => {
      const p = progMap.get(d.id);
      return { id: d.id, name: d.name, requirement: d.requirement, done: !!p?.done, current: p?.current ?? 0, max: p?.max ?? (d.tiers?.at(-1)?.count || 1) };
    }).sort((a, b) => a.name.localeCompare(b.name));
    if (!prog.ok) errors.push(t('daily.src.fractalProgress') + ': ' + prog.e);
  }

  const data = {
    fetchedAt: Date.now(),
    resets: resets(),
    wizard: { daily: need(wvD, t('daily.wvDaily')), weekly: need(wvW, t('daily.wvWeekly')), special: need(wvS, t('daily.wvSpecial')) },
    worldbosses: { all: need(wbAll, t('daily.worldBosses')) || [], done: need(wbDone, t('daily.src.worldBossesToday')) || [] },
    mapchests: { all: need(mcAll, t('daily.src.mapChests')) || [], done: need(mcDone, t('daily.src.mapChestsToday')) || [] },
    dailycrafting: { all: need(dcAll, t('daily.crafting')) || [], done: need(dcDone, t('daily.src.craftingToday')) || [] },
    fractals,
    errors,
  };
  cache = { at: Date.now(), key, data };
  return data;
}

// Kobler navn fra tidsplanen til API-id for world bosses
const { bossId: bossIdFromName } = require('../renderer/timer-logic');

module.exports = { fetchDaily, fetchWorldbosses, resets, bossIdFromName, invalidate: () => { cache.at = 0; for (const entry of bossCache.values()) entry.at = 0; } };
