'use strict';
// Rang på fiender til DPS-meteret: boss, legendary, champion, elite, veteran eller vanlig.
//
// ArcDPS sender IKKE rang, og det som kunne avslørt den kommer ikke i sanntid: evtc-README merker CBTS_MAXHEALTHUPDATE,
// CBTS_HEALTHPCTUPDATE og CBTS_DEFIANCEBARSTATE med «realtime: no», og ingen av dem finnes i eierens to opptak
// (13. og 18. sept 2026, broen videresender alle andre statechange-koder). Derfor to kilder som faktisk finnes i strømmen:
//   1. Art-id: README sier «if evtc_agent.is_elite == 0xffffffff && upper half of evtc_agent.prof != 0xffff, agent is a npc with
//      species id as lower half of evtc_agent.prof (reliable id)». data/bosses.json har id-ene for raid-, strike- og
//      fractal-bosser og treningsgolemene, hentet fra Elite Insights (MIT). Gadgets (øvre halvdel 0xffff) har flyktig id og er ute.
//   2. Rangordet i navnet («Veteran», «Elite», «Champion», «Legendary»; også tysk, fransk og spansk form). Spillet viser rangen
//      som en del av navnet, men det er IKKE sett i et opptak ennå (begge opptakene hadde bare vanlige fiender). Står ordet
//      ikke i navnet, blir fienden rett og slett ikke merket.
const fs = require('fs');
const path = require('path');

const NPC_ELITE = 0xffffffff;
const RANK = Object.freeze({ normal: 0, veteran: 1, elite: 2, champion: 3, legendary: 4, boss: 5 });
const KEYS = ['normal', 'veteran', 'elite', 'champion', 'legendary', 'boss'];
// Høyeste rang først. \p{L} så «Legendär» og «Légendaire» treffer; ordgrenser så «Elite» ikke treffer «Elitesoldat».
const WORDS = [
  [RANK.legendary, /(^|[^\p{L}])(legendary|legend[äa]re?[rsn]?|l[ée]gendaire|legendari[oa])(?![\p{L}])/iu],
  [RANK.champion, /(^|[^\p{L}])(champion(ne)?|campe[óo]n|campeona)(?![\p{L}])/iu],
  [RANK.elite, /(^|[^\p{L}])([ée]lite)(?![\p{L}])/iu],
  [RANK.veteran, /(^|[^\p{L}])(veteran|v[ée]t[ée]ran|veteran[oa])(?![\p{L}])/iu],
];

let bosses = null;
function bossTable() {
  if (!bosses) {
    try { bosses = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'data', 'bosses.json'), 'utf8')).bosses || {}; }
    catch { bosses = {}; }
  }
  return bosses;
}

// Art-id for en NPC-agent, ellers 0 (spillere og gadgets)
function speciesId(agent) {
  if (!agent || agent.elite !== NPC_ELITE) return 0;
  const prof = Number(agent.prof) >>> 0;
  if ((prof >>> 16) === 0xffff) return 0; // gadget: flyktig pseudo-id
  return prof & 0xffff;
}

// { rank: 0–5, key: 'boss' | 'legendary' | ..., boss: { name, kind } | null }
function rankOf(agent) {
  const boss = bossTable()[String(speciesId(agent))] || null;
  if (boss) return { rank: RANK.boss, key: 'boss', boss };
  const name = String(agent?.name || '');
  for (const [rank, re] of WORDS) if (re.test(name)) return { rank, key: KEYS[rank], boss: null };
  return { rank: RANK.normal, key: 'normal', boss: null };
}

module.exports = { rankOf, speciesId, RANK, KEYS };
