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
  const api = { expand, status, bossSpawns, bossId, filler };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else target.TimerLogic = api;
})(globalThis);
