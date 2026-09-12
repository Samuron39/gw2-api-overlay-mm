'use strict';
// Guild-modul (hovedprosess): MOTD, logg, lager og treasury for guildene kontoen er med i.
const gw2 = require('../gw2');

let cache = { at: 0, key: '', data: null };
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: e.message }));

async function fetchGuilds(key) {
  if (!key) throw new Error('Ingen API-nøkkel.');
  if (cache.data && cache.key === key && Date.now() - cache.at < 120e3) return cache.data;
  const account = await gw2.get('/account', { key });
  const ids = account.guilds || [];
  const leaderOf = new Set(account.guild_leader || []);
  const guilds = [];
  const itemIds = new Set();
  for (const id of ids) {
    const [info, log, stash, treasury, upgrades] = await Promise.all([
      settle(gw2.get(`/guild/${id}`, { key })),
      settle(gw2.get(`/guild/${id}/log`, { key })),
      settle(gw2.get(`/guild/${id}/stash`, { key })),
      settle(gw2.get(`/guild/${id}/treasury`, { key })),
      settle(gw2.get(`/guild/${id}/upgrades`, { key })),
    ]);
    const g = { id, name: info.ok ? info.v.name : id, tag: info.ok ? info.v.tag : '', level: info.ok ? info.v.level : null, motd: info.ok ? info.v.motd : '', memberCount: info.ok ? info.v.member_count : null, leader: leaderOf.has(id), errors: [] };
    if (!info.ok) g.errors.push('Info: ' + info.e);
    g.log = log.ok ? log.v.slice(0, 60) : []; if (!log.ok) g.errors.push('Logg: ' + log.e);
    g.stash = stash.ok ? stash.v : []; if (!stash.ok) g.errors.push('Lager: ' + stash.e);
    g.treasury = treasury.ok ? treasury.v : []; if (!treasury.ok) g.errors.push('Treasury: ' + treasury.e);
    g.upgradeIds = upgrades.ok ? upgrades.v : [];
    for (const s of g.stash) for (const it of s.inventory || []) if (it) itemIds.add(it.id);
    for (const t of g.treasury) itemIds.add(t.item_id);
    for (const l of g.log) if (l.item_id) itemIds.add(l.item_id);
    guilds.push(g);
  }
  const items = await gw2.fetchItems([...itemIds]);
  const name = (id) => items.get(id)?.name || `Item ${id}`;
  const icon = (id) => items.get(id)?.icon || '';
  const upgradeNames = new Map();
  const upIds = new Set(guilds.flatMap((g) => g.treasury.flatMap((t) => (t.needed_by || []).map((n) => n.upgrade_id))));
  if (upIds.size) {
    try { const ups = await gw2.get('/guild/upgrades', { params: { ids: [...upIds].slice(0, 200).join(',') }, bulk: true }); for (const u of ups) upgradeNames.set(u.id, u.name); } catch { /* valgfritt */ }
  }
  for (const g of guilds) {
    g.stashSummary = g.stash.map((s) => ({ note: s.note || '', coins: s.coins || 0, size: s.size, items: (s.inventory || []).filter(Boolean).map((it) => ({ id: it.id, count: it.count, name: name(it.id), icon: icon(it.id) })) }));
    g.treasuryRows = g.treasury.map((t) => ({ id: t.item_id, name: name(t.item_id), icon: icon(t.item_id), count: t.count, needed: (t.needed_by || []).map((n) => ({ upgrade: upgradeNames.get(n.upgrade_id) || `Oppgradering ${n.upgrade_id}`, count: n.count })), missing: Math.max(0, Math.max(0, ...(t.needed_by || []).map((n) => n.count)) - t.count) }))
      .filter((r) => r.needed.length).sort((a, b) => b.missing - a.missing);
    g.logRows = g.log.map((l) => ({ id: l.id, time: l.time, type: l.type, user: l.user || '', text: describeLog(l, name) }));
    delete g.stash; delete g.treasury; delete g.log;
  }
  const data = { fetchedAt: Date.now(), guilds, treasuryNeeds: [...new Set(guilds.flatMap((g) => g.treasuryRows.filter((r) => r.missing > 0).map((r) => r.id)))] };
  cache = { at: Date.now(), key, data };
  return data;
}

function describeLog(l, name) {
  switch (l.type) {
    case 'joined': return `${l.user} ble med`;
    case 'invited': return `${l.user} ble invitert av ${l.invited_by}`;
    case 'kick': return `${l.user} ble kastet ut av ${l.kicked_by}`;
    case 'rank_change': return `${l.user} fikk rang ${l.new_rank} (var ${l.old_rank}) av ${l.changed_by}`;
    case 'treasury': return `${l.user} donerte ${l.count} × ${name(l.item_id)} til treasury`;
    case 'stash': return l.coins ? `${l.user} ${l.operation === 'deposit' ? 'satte inn' : 'tok ut'} ${(l.coins / 10000).toFixed(2)}g` : `${l.user} ${l.operation === 'deposit' ? 'satte inn' : 'tok ut'} ${l.count} × ${name(l.item_id)}`;
    case 'motd': return `${l.user} endret MOTD`;
    case 'upgrade': return `${l.user || ''} ${l.action} oppgradering ${l.upgrade_id}${l.count ? ' ×' + l.count : ''}`.trim();
    case 'influence': return `${l.participants?.length || 0} deltok (${l.activity})`;
    case 'mission': return `Guild mission: ${l.state}`;
    default: return l.type;
  }
}

module.exports = { fetchGuilds, invalidate: () => { cache.at = 0; } };
