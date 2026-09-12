'use strict';
// Guild-modul (hovedprosess): MOTD, logg, lager og treasury for guildene kontoen er med i.
const gw2 = require('../gw2');
const { t } = require('../i18n');

let cache = { at: 0, key: '', data: null };
const settle = (p) => p.then((v) => ({ ok: true, v })).catch((e) => ({ ok: false, e: e.message }));

async function fetchGuilds(key) {
  if (!key) throw new Error(t('common.noApiKeyShort'));
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
    if (!info.ok) g.errors.push(t('guild.src.info') + ': ' + info.e);
    g.log = log.ok ? log.v.slice(0, 60) : []; if (!log.ok) g.errors.push(t('guild.src.log') + ': ' + log.e);
    g.stash = stash.ok ? stash.v : []; if (!stash.ok) g.errors.push(t('guild.src.stash') + ': ' + stash.e);
    g.treasury = treasury.ok ? treasury.v : []; if (!treasury.ok) g.errors.push(t('guild.src.treasury') + ': ' + treasury.e);
    g.upgradeIds = upgrades.ok ? upgrades.v : [];
    for (const s of g.stash) for (const it of s.inventory || []) if (it) itemIds.add(it.id);
    for (const t of g.treasury) itemIds.add(t.item_id);
    for (const l of g.log) if (l.item_id) itemIds.add(l.item_id);
    guilds.push(g);
  }
  const items = await gw2.fetchItems([...itemIds]);
  const name = (id) => items.get(id)?.name || t('common.itemId', { id });
  const icon = (id) => items.get(id)?.icon || '';
  const upgradeNames = new Map();
  const upIds = new Set(guilds.flatMap((g) => g.treasury.flatMap((t) => (t.needed_by || []).map((n) => n.upgrade_id))));
  if (upIds.size) {
    try { const ups = await gw2.get('/guild/upgrades', { params: { ids: [...upIds].slice(0, 200).join(',') }, bulk: true }); for (const u of ups) upgradeNames.set(u.id, u.name); } catch { /* valgfritt */ }
  }
  for (const g of guilds) {
    g.stashSummary = g.stash.map((s) => ({ note: s.note || '', coins: s.coins || 0, size: s.size, items: (s.inventory || []).filter(Boolean).map((it) => ({ id: it.id, count: it.count, name: name(it.id), icon: icon(it.id) })) }));
    g.treasuryRows = g.treasury.map((t) => ({ id: t.item_id, name: name(t.item_id), icon: icon(t.item_id), count: t.count, needed: (t.needed_by || []).map((n) => ({ upgrade: upgradeNames.get(n.upgrade_id) || t('guild.upgradeFallback', { id: n.upgrade_id }), count: n.count })), missing: Math.max(0, Math.max(0, ...(t.needed_by || []).map((n) => n.count)) - t.count) }))
      .filter((r) => r.needed.length).sort((a, b) => b.missing - a.missing);
    g.logRows = g.log.map((l) => ({ id: l.id, time: l.time, type: l.type, user: l.user || '', text: describeLog(l, name) }));
    delete g.stash; delete g.treasury; delete g.log;
  }
  const data = { fetchedAt: Date.now(), guilds, treasuryNeeds: [...new Set(guilds.flatMap((g) => g.treasuryRows.filter((r) => r.missing > 0).map((r) => r.id)))] };
  cache = { at: Date.now(), key, data };
  return data;
}

function describeLog(l, name) {
  const user = l.user;
  switch (l.type) {
    case 'joined': return t('guild.ev.joined', { user });
    case 'invited': return t('guild.ev.invited', { user, by: l.invited_by });
    case 'kick': return t('guild.ev.kick', { user, by: l.kicked_by });
    case 'rank_change': return t('guild.ev.rankChange', { user, newRank: l.new_rank, oldRank: l.old_rank, by: l.changed_by });
    case 'treasury': return t('guild.ev.treasury', { user, count: l.count, item: name(l.item_id) });
    case 'stash': { const op = t(l.operation === 'deposit' ? 'guild.ev.deposit' : 'guild.ev.withdraw'); return l.coins ? t('guild.ev.stashCoins', { user, op, gold: (l.coins / 10000).toFixed(2) }) : t('guild.ev.stashItems', { user, op, count: l.count, item: name(l.item_id) }); }
    case 'motd': return t('guild.ev.motd', { user });
    case 'upgrade': return t('guild.ev.upgrade', { user: l.user || '', action: l.action, id: l.upgrade_id, count: l.count ? ' ×' + l.count : '' }).trim();
    case 'influence': return t('guild.ev.influence', { n: l.participants?.length || 0, activity: l.activity });
    case 'mission': return t('guild.ev.mission', { state: l.state });
    default: return l.type;
  }
}

module.exports = { fetchGuilds, invalidate: () => { cache.at = 0; } };
