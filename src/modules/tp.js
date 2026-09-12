'use strict';
// Trading Post-modul (hovedprosess): egne ordrer, historikk, leveringsboks og reprisingsforslag.
const gw2 = require('../gw2');

const FEE = 0.85;
let cache = { at: 0, key: '', data: null };
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: e.message }));

async function fetchTp(key) {
  if (!key) throw new Error('Ingen API-nøkkel.');
  if (cache.data && cache.key === key && Date.now() - cache.at < 60e3) return cache.data;
  const g = (ep) => gw2.get(ep, { key });
  const [curBuys, curSells, histBuys, histSells, delivery] = await Promise.all([
    settle(g('/commerce/transactions/current/buys')), settle(g('/commerce/transactions/current/sells')),
    settle(g('/commerce/transactions/history/buys')), settle(g('/commerce/transactions/history/sells')),
    settle(g('/commerce/delivery')),
  ]);
  const errors = [];
  const take = (r, what) => { if (!r.ok) errors.push(`${what}: ${r.e}`); return r.ok ? r.v : []; };
  const buys = take(curBuys, 'Kjøpsordrer'), sells = take(curSells, 'Salgsordrer');
  const hBuys = take(histBuys, 'Kjøpshistorikk'), hSells = take(histSells, 'Salgshistorikk');
  const del = delivery.ok ? delivery.v : { coins: 0, items: [] };
  if (!delivery.ok) errors.push('Leveringsboks: ' + delivery.e);

  const ids = [...new Set([...buys, ...sells, ...hBuys, ...hSells, ...(del.items || [])].map((t) => t.item_id || t.id))];
  const [items, prices] = await Promise.all([gw2.fetchItems(ids), gw2.fetchPrices([...new Set([...buys, ...sells].map((t) => t.item_id))])]);
  const name = (id) => items.get(id)?.name || `Item ${id}`;
  const icon = (id) => items.get(id)?.icon || '';

  const sellRows = sells.map((t) => {
    const p = prices.get(t.item_id);
    const lowest = p?.sells?.unit_price || 0;
    const highestBuy = p?.buys?.unit_price || 0;
    let advice = '';
    if (lowest && t.price > lowest) advice = `Underbudt: laveste er ${lowest}c, du ligger ${t.price - lowest}c over`;
    else if (lowest && t.price === lowest) advice = 'Du er laveste pris';
    return { ...t, name: name(t.item_id), icon: icon(t.item_id), lowest, highestBuy, advice, net: Math.floor(t.price * FEE) * t.quantity };
  });
  const buyRows = buys.map((t) => {
    const p = prices.get(t.item_id);
    const highest = p?.buys?.unit_price || 0;
    const lowestSell = p?.sells?.unit_price || 0;
    let advice = '';
    if (highest && t.price < highest) advice = `Overbudt: høyeste bud er ${highest}c, du ligger ${highest - t.price}c under`;
    else if (highest && t.price === highest) advice = 'Du har høyeste bud';
    return { ...t, name: name(t.item_id), icon: icon(t.item_id), highest, lowestSell, advice, total: t.price * t.quantity };
  });

  const since = (days) => Date.now() - days * 864e5;
  const sumSells = (days) => hSells.filter((t) => new Date(t.purchased || t.created).getTime() > since(days)).reduce((s, t) => s + Math.floor(t.price * FEE) * t.quantity, 0);
  const sumBuys = (days) => hBuys.filter((t) => new Date(t.purchased || t.created).getTime() > since(days)).reduce((s, t) => s + t.price * t.quantity, 0);
  const history = [
    ...hSells.map((t) => ({ ...t, kind: 'sell', name: name(t.item_id), icon: icon(t.item_id), net: Math.floor(t.price * FEE) * t.quantity })),
    ...hBuys.map((t) => ({ ...t, kind: 'buy', name: name(t.item_id), icon: icon(t.item_id), net: -t.price * t.quantity })),
  ].sort((a, b) => new Date(b.purchased || b.created) - new Date(a.purchased || a.created)).slice(0, 200);

  const data = {
    fetchedAt: Date.now(), errors,
    delivery: { coins: del.coins || 0, items: (del.items || []).map((i) => ({ id: i.id, count: i.count, name: name(i.id), icon: icon(i.id) })) },
    sells: sellRows.sort((a, b) => b.net - a.net),
    buys: buyRows.sort((a, b) => b.total - a.total),
    history,
    summary: { sold7: sumSells(7), sold30: sumSells(30), bought7: sumBuys(7), bought30: sumBuys(30), listedValue: sellRows.reduce((s, r) => s + r.net, 0), buyOrders: buyRows.reduce((s, r) => s + r.total, 0) },
    listedItemIds: [...new Set(sells.map((t) => t.item_id))],
  };
  cache = { at: Date.now(), key, data };
  return data;
}

module.exports = { fetchTp, invalidate: () => { cache.at = 0; } };
