'use strict';
// Klient mot det offisielle GW2 API-et. Henter konto, karakterer, bank,
// delte plasser, materiallager og lommebok, og slår opp item-data og TP-priser.
const fs = require('fs');
const path = require('path');

const BASE = 'https://api.guildwars2.com/v2';
const CHUNK = 200;        // maks ids per bulk-kall
const CONCURRENCY = 4;    // parallelle kall (ratelimit er 600/min)

let cacheDir = null;
const itemCache = new Map();
let materialCategories = null;
let currencies = null;

function init(dir) {
  cacheDir = dir;
  try {
    const raw = JSON.parse(fs.readFileSync(path.join(dir, 'items-cache.json'), 'utf8'));
    for (const it of raw) itemCache.set(it.id, it);
  } catch { /* ingen cache ennå */ }
}

function persistItems() {
  if (!cacheDir) return;
  try {
    fs.writeFileSync(path.join(cacheDir, 'items-cache.json'), JSON.stringify([...itemCache.values()]));
  } catch { /* ikke kritisk */ }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function get(endpoint, { key, params = {}, bulk = false, retries = 3, withHeaders = false } = {}) {
  const url = new URL(BASE + endpoint);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers = { Accept: 'application/json', 'Accept-Language': 'en' };
  if (key) headers.Authorization = 'Bearer ' + key;
  for (let attempt = 0; ; attempt++) {
    const res = await fetch(url, { headers });
    if (res.status === 429 || res.status >= 500) {
      if (attempt >= retries) throw new Error(`GW2 API ${res.status} på ${endpoint}`);
      await sleep(1000 * (attempt + 1));
      continue;
    }
    if (res.status === 404 && bulk) return []; // ingen av id-ene fantes
    if (!res.ok) {
      let msg = '';
      try { msg = (await res.json()).text || ''; } catch { /* tom */ }
      throw new Error(`GW2 API ${res.status} på ${endpoint}${msg ? ': ' + msg : ''}`);
    }
    if (withHeaders) return { body: await res.json(), headers: Object.fromEntries(res.headers) };
    return res.json();
  }
}

function chunks(arr, n) {
  const out = [];
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n));
  return out;
}

async function mapLimit(items, limit, fn) {
  const out = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) { const idx = i++; out[idx] = await fn(items[idx], idx); }
  }
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

async function fetchItems(ids) {
  const unique = [...new Set(ids)];
  const missing = unique.filter((id) => !itemCache.has(id));
  if (missing.length) {
    const groups = chunks(missing, CHUNK);
    const res = await mapLimit(groups, CONCURRENCY, (g) => get('/items', { params: { ids: g.join(',') }, bulk: true }));
    for (const arr of res) for (const it of arr) itemCache.set(it.id, it);
    persistItems();
  }
  const map = new Map();
  for (const id of unique) { const it = itemCache.get(id); if (it) map.set(id, it); }
  return map;
}

async function fetchPrices(ids) {
  const unique = [...new Set(ids)];
  const groups = chunks(unique, CHUNK);
  const res = await mapLimit(groups, CONCURRENCY, (g) => get('/commerce/prices', { params: { ids: g.join(',') }, bulk: true }));
  const map = new Map();
  for (const arr of res) for (const p of arr) map.set(p.id, p);
  return map;
}

async function fetchMaterialCategories() {
  if (!materialCategories) materialCategories = await get('/materials', { params: { ids: 'all' } });
  return materialCategories;
}

async function fetchCurrencies() {
  if (!currencies) currencies = await get('/currencies', { params: { ids: 'all' } });
  return currencies;
}

// Opplåsninger på kontoen (krever unlocks-tillatelse)
const UNLOCK_ENDPOINTS = {
  skins: '/account/skins', dyes: '/account/dyes', recipes: '/account/recipes', minis: '/account/minis',
  outfits: '/account/outfits', gliders: '/account/gliders', mailcarriers: '/account/mailcarriers',
  novelties: '/account/novelties', finishers: '/account/finishers', jadebots: '/account/jadebots',
};
async function fetchUnlocks(key, perms) {
  const out = { available: perms.has('unlocks') };
  if (!out.available) return out;
  const entries = Object.entries(UNLOCK_ENDPOINTS);
  const res = await mapLimit(entries, CONCURRENCY, ([, ep]) => get(ep, { key }).catch(() => null));
  entries.forEach(([k], i) => {
    const v = res[i];
    out[k] = new Set(Array.isArray(v) ? v.map((x) => (x && typeof x === 'object' ? x.id : x)) : []);
  });
  return out;
}

// Kontoens achievement-fremdrift (krever progression-tillatelse): id -> { done, bits:Set }
async function fetchAccountAchievements(key, perms) {
  if (!perms.has('progression')) return null;
  const arr = await get('/account/achievements', { key });
  const map = new Map();
  for (const a of arr) map.set(a.id, { done: !!a.done, bits: new Set(a.bits || []) });
  return map;
}

// Indeks over hvilke achievements (samlinger) et item, skin eller mini inngår i. Caches en uke.
let achIndex = null;
async function fetchAchievementIndex(onProgress) {
  if (achIndex) return achIndex;
  const file = cacheDir ? path.join(cacheDir, 'achievements-index.json') : null;
  try {
    const raw = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (Date.now() - raw.fetchedAt < 7 * 864e5) { achIndex = raw; return raw; }
  } catch { /* ingen cache */ }
  const first = await get('/achievements', { params: { page: 0, page_size: 200 }, withHeaders: true });
  const total = Number(first.headers['x-page-total'] || 1);
  const pages = Array.from({ length: Math.max(0, total - 1) }, (_, i) => i + 1);
  let done = 1;
  const rest = await mapLimit(pages, CONCURRENCY, async (p) => { const r = await get('/achievements', { params: { page: p, page_size: 200 }, bulk: true }); onProgress?.(++done, total); return r; });
  const idx = { fetchedAt: Date.now(), count: 0, items: {}, skins: {}, minis: {} };
  for (const arr of [first.body, ...rest]) {
    for (const a of arr) {
      idx.count++;
      (a.bits || []).forEach((b, bit) => {
        if (!b || b.id == null) return;
        const bucket = b.type === 'Item' ? idx.items : b.type === 'Skin' ? idx.skins : b.type === 'Minipet' ? idx.minis : null;
        if (!bucket) return;
        (bucket[b.id] ||= []).push({ id: a.id, name: a.name, bit });
      });
    }
  }
  achIndex = idx;
  if (file) { try { fs.writeFileSync(file, JSON.stringify(idx)); } catch { /* ikke kritisk */ } }
  return idx;
}

// Henter alt fra kontoen og returnerer en flat liste av item-forekomster.
async function fetchAccountData(key) {
  const errors = [];
  const token = await get('/tokeninfo', { key });
  const perms = new Set(token.permissions || []);
  const need = ['account', 'inventories', 'characters', 'wallet'];
  const missing = need.filter((p) => !perms.has(p));
  if (missing.length) errors.push('API-nøkkelen mangler tillatelser: ' + missing.join(', '));

  const account = await get('/account', { key });

  const tasks = {};
  if (perms.has('characters') && perms.has('inventories')) tasks.characters = get('/characters', { key, params: { ids: 'all' } });
  if (perms.has('inventories')) {
    tasks.bank = get('/account/bank', { key });
    tasks.shared = get('/account/inventory', { key });
    tasks.materials = get('/account/materials', { key });
  }
  if (perms.has('wallet')) tasks.wallet = get('/account/wallet', { key });
  tasks.unlocks = fetchUnlocks(key, perms);
  tasks.achievements = fetchAccountAchievements(key, perms);
  const soft = ['unlocks', 'progression'].filter((p) => !perms.has(p));
  if (soft.length) errors.push(`Nøkkelen mangler ${soft.join(' og ')}: samlinger og skinn sjekkes ikke`);

  const keys = Object.keys(tasks);
  const settled = await Promise.allSettled(Object.values(tasks));
  const data = {};
  settled.forEach((s, i) => {
    if (s.status === 'fulfilled') data[keys[i]] = s.value;
    else errors.push(`${keys[i]}: ${s.reason.message}`);
  });

  const instances = [];
  const freeSlots = { characters: {}, bank: { free: 0, total: 0 }, shared: { free: 0, total: 0 } };

  for (const c of data.characters || []) {
    let total = 0, free = 0;
    for (const bag of c.bags || []) {
      if (!bag) continue;
      total += bag.size;
      for (const slot of bag.inventory || []) {
        if (!slot) { free++; continue; }
        instances.push({ itemId: slot.id, count: slot.count, binding: slot.binding || null, boundTo: slot.bound_to || null, source: c.name, sourceType: 'character' });
      }
    }
    freeSlots.characters[c.name] = { free, total };
  }

  for (const slot of data.bank || []) {
    freeSlots.bank.total++;
    if (!slot) { freeSlots.bank.free++; continue; }
    instances.push({ itemId: slot.id, count: slot.count, binding: slot.binding || null, boundTo: null, source: 'Bank', sourceType: 'bank' });
  }

  for (const slot of data.shared || []) {
    freeSlots.shared.total++;
    if (!slot) { freeSlots.shared.free++; continue; }
    instances.push({ itemId: slot.id, count: slot.count, binding: slot.binding || null, boundTo: null, source: 'Delte plasser', sourceType: 'shared' });
  }

  const materialCounts = new Map();
  for (const m of data.materials || []) {
    materialCounts.set(m.id, m.count);
    if (m.count > 0) instances.push({ itemId: m.id, count: m.count, binding: m.binding || null, boundTo: null, source: 'Materiallager', sourceType: 'materials' });
  }

  let wallet = [];
  if (data.wallet) {
    const cur = await fetchCurrencies().catch(() => []);
    const names = new Map(cur.map((c) => [c.id, c.name]));
    wallet = data.wallet.map((w) => ({ id: w.id, name: names.get(w.id) || `Valuta ${w.id}`, value: w.value }));
  }

  return { account, wallet, instances, freeSlots, materialCounts, errors, perms: [...perms], unlocks: data.unlocks || { available: false }, accountAchievements: data.achievements || null };
}

// Demo-data (GW2_DEMO=1): ekte items, oppdiktet inventory. Brukes til testing uten API-nøkkel.
function demoAccountData() {
  const mk = (itemId, count, source, sourceType = 'character', binding = null) => ({ itemId, count, binding, boundTo: null, source, sourceType });
  const instances = [
    mk(19721, 37, 'Demo Warrior'), mk(19976, 12, 'Demo Warrior'), mk(46747, 3, 'Demo Warrior'),
    mk(80080, 1, 'Demo Warrior'), mk(79362, 250, 'Demo Warrior'), mk(24, 5, 'Demo Warrior'),
    mk(19684, 143, 'Demo Warrior'), mk(12452, 8, 'Demo Warrior'), mk(68063, 2, 'Demo Warrior', 'character', 'Account'),
    mk(44941, 60, 'Demo Warrior'), mk(1041, 1, 'Demo Warrior'), mk(1074, 1, 'Demo Warrior', 'character', 'Character'),
    mk(3903, 1, 'Demo Warrior'), mk(1128, 1, 'Demo Warrior'), mk(13, 1, 'Demo Warrior'),
    mk(83008, 40, 'Demo Ranger'), mk(84731, 3, 'Demo Ranger'), mk(19748, 120, 'Demo Ranger'),
    mk(19700, 250, 'Bank', 'bank'), mk(19976, 30, 'Bank', 'bank'), mk(8932, 4, 'Bank', 'bank'),
    mk(19721, 250, 'Materiallager', 'materials'), mk(19700, 250, 'Materiallager', 'materials'),
  ];
  const materialCounts = new Map([[19721, 250], [19700, 250]]);
  return {
    account: { name: 'Demo.1234' },
    wallet: [{ id: 1, name: 'Coin', value: 1234567 }],
    instances,
    freeSlots: { characters: { 'Demo Warrior': { free: 12, total: 100 }, 'Demo Ranger': { free: 48, total: 80 } }, bank: { free: 20, total: 90 }, shared: { free: 0, total: 2 } },
    materialCounts,
    errors: [],
  };
}

const mapCache = new Map();
async function fetchMaps(ids) {
  const missing = [...new Set(ids)].filter((id) => id && !mapCache.has(id));
  if (missing.length) {
    const arr = await get('/maps', { params: { ids: missing.join(',') }, bulk: true });
    for (const m of arr) mapCache.set(m.id, { id: m.id, name: m.name, regionName: m.region_name, continentId: m.continent_id, type: m.type });
  }
  const out = {};
  for (const id of ids) if (mapCache.has(id)) out[id] = mapCache.get(id);
  return out;
}

module.exports = { get, mapLimit, init, fetchAccountData, fetchItems, fetchPrices, fetchMaterialCategories, demoAccountData, fetchMaps, fetchAchievementIndex };
