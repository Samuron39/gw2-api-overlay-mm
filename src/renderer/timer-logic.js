'use strict';
// Samme rene UTC-beregning brukes av begge panelmoduler, hovedprosessen og Node-testene.
(function (target) {
  const DAY = 1440, MINUTE = 60000;
  const cache = new WeakMap();
  const filler = (name) => !name || name.startsWith('(') || /^(Reset|Downtime|Nothing|Idle|Pause|Break)$/i.test(name);
  const aliases = { 'golem mark ii': 'inquest_golem_mark_ii', 'triple trouble': 'triple_trouble_wurm', 'evolved jungle wurm': 'triple_trouble_wurm', 'drakkar and spirits of the wild': 'drakkar' };
  function bossId(name) { const n = String(name || '').toLowerCase().trim(); return aliases[n] || n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }
  function expand(event) {
    if (cache.has(event)) return cache.get(event);
    const segments = []; let time = 0;
    const add = (s) => {
      const duration = Number(s.d);
      if (!Number.isFinite(duration) || duration <= 0 || !event.segments?.[s.r]) throw new Error('Ugyldig tidsplansegment');
      segments.push({ r: s.r, start: time, end: time + duration }); time += duration;
    };
    for (const s of event.sequences?.partial || []) { if (time >= DAY) break; add(s); }
    const pattern = event.sequences?.pattern || [];
    while (pattern.length && time < DAY) for (const s of pattern) { add(s); if (time >= DAY) break; }
    // Et innledende restsegment har samme start som forrige døgns siste segment.
    // Dette bevarer fremdrift og gjenstående tid over midnatt, f.eks. Dragon's Stand 23:30–01:30.
    const first = segments[0], last = segments.at(-1);
    if (first && last.end > DAY && String(first.r) === String(last.r) && first.end === last.end - DAY) first.start = last.start - DAY;
    cache.set(event, segments);
    return segments;
  }
  function nowMinute(now) { return ((now / MINUTE) % DAY + DAY) % DAY; }
  function status(event, now) {
    const timeline = expand(event), m = nowMinute(now);
    const idx = timeline.findIndex((s) => s.start <= m && m < s.end);
    if (idx < 0) return null;
    const current = timeline[idx]; let next = null, nextStart = null;
    for (let n = 1; n <= timeline.length; n++) {
      const i = (idx + n) % timeline.length, s = timeline[i];
      const start = s.start + (idx + n >= timeline.length ? DAY : 0);
      if (start < current.end || filler(event.segments[s.r]?.name)) continue;
      next = event.segments[s.r]; nextStart = start; break;
    }
    return { cur: event.segments[current.r], curId: current.r, curFiller: filler(event.segments[current.r]?.name), start: current.start, end: current.end,
      remaining: (current.end - m) * 60, progress: (m - current.start) / (current.end - current.start), next, nextIn: nextStart == null ? null : (nextStart - m) * 60 };
  }
  function bossSpawns(events, now) {
    const out = new Map(), m = nowMinute(now);
    for (const event of Object.values(events || {})) for (const s of expand(event)) {
      const seg = event.segments[s.r]; if (filler(seg?.name)) continue;
      const active = s.start <= m && m < s.end;
      const inMin = active ? 0 : ((s.start - m) % DAY + DAY) % DAY;
      const id = bossId(seg.name), old = out.get(id);
      if (!old || inMin < old.inMin || (active && !old.active)) out.set(id, { id, name: seg.name, active, inMin, start: s.start, end: s.end, chatlink: seg.chatlink });
    }
    return out;
  }
  // ---------- «Neste bosser»: overlay-vinduet og I dag deler utvalg og chat-tekst ----------
  // Verdensbossene: alt i «World bosses» og «Hard world bosses», pluss Drakkar fra Bjora Marches (de andre segmentene der er
  // vanlige kart-hendelser). Samme 15 som /v2/worldbosses og lista i I dag.
  const BOSS_EVENTS = ['core-wb', 'core-hwb'];
  const EXTRA = { 'lws5-bm': ['drakkar'] };
  // Alle forekomster det neste døgnet, også den som pågår: { id, name, chatlink, active, inMin (0 når den pågår), sinceMin, start, end }
  function bossOccurrences(events, now) {
    const out = [], m = nowMinute(now);
    for (const [key, event] of Object.entries(events || {})) {
      const only = EXTRA[key];
      if (!BOSS_EVENTS.includes(key) && !only) continue;
      for (const s of expand(event)) {
        const seg = event.segments[s.r]; if (filler(seg?.name)) continue;
        const id = bossId(seg.name); if (only && !only.includes(id)) continue;
        const active = s.start <= m && m < s.end;
        out.push({ id, name: seg.name, chatlink: seg.chatlink, active, inMin: active ? 0 : ((s.start - m) % DAY + DAY) % DAY, sinceMin: active ? m - s.start : 0, start: s.start, end: s.end });
      }
    }
    return out.sort((a, b) => (b.active - a.active) || a.inMin - b.inMin || a.name.localeCompare(b.name));
  }
  // Utvalget til vinduet. pick 'count': de `count` neste. pick 'within': alle som starter innen `within` minutter; er det ingen,
  // vises den neste alene (beyond: true) så vinduet aldri er tomt. En boss som pågår er med de første `activeMin` minuttene og
  // viker så for de neste: ellers viser vinduet ofte bosser man ikke rekker. done = API-id-er drept i dag (hideDone skjuler dem).
  // soon = under `soonMin` minutter til start. Maks 8 rader.
  function nextBosses(events, now, o = {}) {
    const pick = o.pick === 'within' ? 'within' : 'count';
    const count = Math.max(1, Math.min(8, Math.round(Number(o.count) || 2)));
    const within = Math.max(1, Number(o.within) || 20), activeMin = Math.max(0, Number(o.activeMin ?? 5)), soonMin = Math.max(0, Number(o.soonMin ?? 5));
    const done = new Set(o.hideDone === false ? [] : o.done || []);
    const all = bossOccurrences(events, now).filter((b) => !done.has(b.id) && (!b.active || b.sinceMin < activeMin));
    let list = pick === 'within' ? all.filter((b) => b.active || b.inMin <= within) : all.slice(0, count);
    let beyond = false;
    if (!list.length && all.length) { list = [all.find((b) => !b.active) || all[0]]; beyond = true; }
    return list.slice(0, 8).map((b) => ({ ...b, soon: !b.active && b.inMin < soonMin, beyond }));
  }
  // Kartnavn fra waypoint-lenka: byte 0 = 4 (waypoint), byte 1-3 = id
  function wpInfo(chatlink, waypoints) {
    if (!chatlink || !waypoints) return null;
    try {
      const raw = atob(String(chatlink).trim().slice(2, -1));
      if (raw.charCodeAt(0) !== 4) return null;
      return waypoints[String(raw.charCodeAt(1) | (raw.charCodeAt(2) << 8) | (raw.charCodeAt(3) << 16))] || null;
    } catch { return null; }
  }
  // Teksten som limes i chatten: bossnavn, minutter til start og klokkeslett, regnet ut i det du trykker (maks 190 tegn,
  // spillets chat tar 199). spawn: { name, chatlink, active, inMin }. t og locale kommer fra i18n, så teksten følger språket.
  function pasteText(spawn, now, { t, locale, waypoints } = {}) {
    const inMin = Math.max(0, Math.round(spawn.inMin || 0)), link = spawn.chatlink || '';
    const time = new Date(now + inMin * MINUTE).toLocaleTimeString(locale, { hour: '2-digit', minute: '2-digit' });
    const head = spawn.active ? t('daily.pasteNow', { name: spawn.name, time }) : t('daily.pasteNext', { name: spawn.name, m: inMin, time });
    const wp = wpInfo(link, waypoints);
    const s = `${head}${wp ? ' · ' + wp.map : ''}${link ? ' · ' + link : ''}`;
    return s.length > 190 ? head.slice(0, 190 - link.length - 3) + ' · ' + link : s;
  }
  const api = { expand, status, bossSpawns, bossId, filler, bossOccurrences, nextBosses, wpInfo, pasteText };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else target.TimerLogic = api;
})(globalThis);
