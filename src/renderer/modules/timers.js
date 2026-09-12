'use strict';
// Tidsplan-modul (renderer): hva skjer nå, hva er neste, hvor er det. Data fra GW2-wikien (CC BY-SA).
(() => {
  const { $, esc, setStatus } = Panel;
  let root = null;
  let data = null;
  let mumble = { running: false };
  let offMumble = null;
  let tick = null;
  let hidden = new Set();
  let category = '';
  let editMode = false;
  let doneBosses = new Set();
  let doneTimer = null;
  const BOSS_ALIAS = { 'golem mark ii': 'inquest_golem_mark_ii', 'triple trouble': 'triple_trouble_wurm' };
  const bossId = (name) => { const n = String(name || '').toLowerCase().trim(); return BOSS_ALIAS[n] || n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); };
  async function loadDone() {
    if (!Panel.config?.apiKey) return;
    try { const d = await window.api.invoke('daily:get', false); doneBosses = new Set(d.worldbosses?.done || []); } catch { /* uten progression */ }
  }
  const timelines = new Map();

  const FILLER = (name) => !name || name.startsWith('(') || /^(Reset|Downtime|Nothing|Idle|Pause|Break)$/i.test(name);

  function timeline(e) {
    if (timelines.has(e)) return timelines.get(e);
    const segs = [];
    let t = 0;
    for (const s of e.sequences?.partial || []) { segs.push({ r: s.r, start: t, end: t + s.d }); t += s.d; }
    const pat = e.sequences?.pattern || [];
    let guard = 0;
    while (pat.length && t < 1440 && guard++ < 3000) {
      for (const s of pat) { segs.push({ r: s.r, start: t, end: t + s.d }); t += s.d; if (t >= 1440) break; }
    }
    timelines.set(e, segs);
    return segs;
  }

  function nowMin() { return (Date.now() / 60000) % 1440; }

  function status(key, e) {
    const segs = timeline(e);
    if (!segs.length) return null;
    const m = nowMin();
    let idx = segs.findIndex((s) => s.start <= m && m < s.end);
    if (idx < 0) idx = segs.length - 1;
    const cur = segs[idx];
    const curSeg = e.segments[cur.r];
    let next = null, nextStart = null;
    for (let i = 1; i <= segs.length; i++) {
      const s = segs[(idx + i) % segs.length];
      const seg = e.segments[s.r];
      const start = s.start + ((idx + i) >= segs.length ? 1440 : 0);
      if (s.r === cur.r || FILLER(seg?.name)) continue;
      next = seg; nextStart = start; break;
    }
    return { key, e, cur: curSeg, curFiller: FILLER(curSeg?.name), remaining: (cur.end - m) * 60, progress: (m - cur.start) / (cur.end - cur.start), next, nextIn: nextStart == null ? null : (nextStart - m) * 60 };
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? `${h}t ${String(m).padStart(2, '0')}m` : `${m}m ${String(s).padStart(2, '0')}s`;
  }

  function wpInfo(seg) {
    if (!seg?.chatlink) return null;
    try {
      const raw = atob(seg.chatlink.slice(2, -1));
      if (raw.charCodeAt(0) !== 4) return null;
      const id = raw.charCodeAt(1) | (raw.charCodeAt(2) << 8) | (raw.charCodeAt(3) << 16);
      return data.waypoints[String(id)] || null;
    } catch { return null; }
  }

  function bg(seg) {
    const c = Array.isArray(seg?.bg) ? (Array.isArray(seg.bg[0]) ? seg.bg[0] : seg.bg) : null;
    return c ? `rgba(${c[0]},${c[1]},${c[2]},0.35)` : 'var(--line)';
  }

  const TEMPLATE = `
    <div class="toolbar">
      <select id="tmCategory"><option value="">Alle utvidelser</option></select>
      <label class="inline"><input type="checkbox" id="tmEdit" /> Velg hva som vises</label>
      <div class="spacer"></div>
      <span id="tmHere" class="muted"></span>
    </div>
    <div class="table-wrap"><div id="tmList" class="tm-list"></div></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
    hidden = new Set(Panel.config?.timersHidden || []);
    if (!data) {
      try { data = await window.api.invoke('timers:data'); }
      catch (e) { setStatus('Kunne ikke laste tidsplaner: ' + e.message, true); return; }
    }
    const cats = [...new Set(Object.values(data.events).map((e) => e.category).filter(Boolean))];
    $('#tmCategory', el).innerHTML = '<option value="">Alle utvidelser</option>' + cats.map((c) => `<option value="${esc(c)}" ${c === category ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#tmCategory', el).addEventListener('change', (e) => { category = e.target.value; render(); });
    $('#tmEdit', el).addEventListener('change', (e) => { editMode = e.target.checked; render(); });
    mumble = await window.api.invoke('mumble:get').catch(() => mumble);
    offMumble = window.api.on('mumble:state', (s) => { mumble = s; });
    loadDone().then(render);
    doneTimer = setInterval(loadDone, 5 * 60e3);
    render();
    tick = setInterval(render, 1000);
  }

  function unmount() { clearInterval(tick); tick = null; clearInterval(doneTimer); doneTimer = null; offMumble?.(); offMumble = null; root = null; }
  const killed = (seg) => doneBosses.size && seg?.name && doneBosses.has(bossId(seg.name)) ? ' <span class="badge done" title="Drept i dag, gir ikke loot igjen før reset">✓ i dag</span>' : '';

  function render() {
    if (!root || !data) return;
    const here = mumble.running && mumble.mapId ? mumble.mapId : null;
    $('#tmHere', root).textContent = here ? 'Rader merket «her» er på kartet du står i' : 'Ingen posisjon fra spillet';
    const rows = [];
    for (const [key, e] of Object.entries(data.events)) {
      if (category && e.category !== category) continue;
      if (!editMode && hidden.has(key)) continue;
      const st = status(key, e);
      if (st) rows.push(st);
    }
    rows.sort((a, b) => (a.curFiller ? 1 : 0) - (b.curFiller ? 1 : 0) || (a.nextIn ?? 1e9) - (b.nextIn ?? 1e9));
    $('#tmList', root).innerHTML = rows.map((r) => {
      const curWp = wpInfo(r.cur), nextWp = wpInfo(r.next);
      const hereNow = here && (curWp?.mapId === here || nextWp?.mapId === here);
      const place = (wp, seg) => wp ? `${esc(wp.map)} · ${esc(wp.name)}` : esc(seg?.link || r.e.name);
      return `<div class="tm-row ${hereNow ? 'here' : ''} ${hidden.has(r.key) ? 'hidden-row' : ''}">
        ${editMode ? `<label class="inline tm-toggle"><input type="checkbox" data-key="${esc(r.key)}" ${hidden.has(r.key) ? '' : 'checked'} /></label>` : ''}
        <div class="tm-head"><b>${esc(r.e.name)}</b><span class="muted"> ${esc(r.e.category)}</span>${hereNow ? '<span class="badge here">her</span>' : ''}</div>
        <div class="tm-now" style="background:${bg(r.cur)}">
          <div class="tm-bar" style="width:${Math.round(r.progress * 100)}%"></div>
          <span class="tm-txt">${r.curFiller ? '<span class="muted">Ingenting nå</span>' : `Nå: <b>${esc(r.cur?.name)}</b>${killed(r.cur)}`} · ${r.curFiller ? 'neste' : 'slutter'} om ${fmt(r.curFiller && r.nextIn != null ? r.nextIn : r.remaining)}</span>
          ${!r.curFiller && r.cur?.chatlink ? `<button class="wp" data-link="${esc(r.cur.chatlink)}" title="Lim waypointen inn i chatten i spillet">${place(curWp, r.cur)} ⧉</button>` : ''}
        </div>
        ${r.next ? `<div class="tm-next">Neste: <b>${esc(r.next.name)}</b>${killed(r.next)} om ${fmt(r.nextIn)}
          ${r.next.chatlink ? `<button class="wp" data-link="${esc(r.next.chatlink)}" title="Lim waypointen inn i chatten i spillet">${place(nextWp, r.next)} ⧉</button>` : ''}</div>` : ''}
      </div>`;
    }).join('') || '<div class="empty">Ingen tidsplaner å vise.</div>';
    root.querySelectorAll('button.wp').forEach((b) => b.addEventListener('click', async () => {
      const r = await window.api.invoke('game:paste', b.dataset.link);
      if (r.ok) setStatus(`${b.dataset.link} er limt inn i chatten. Trykk Enter i spillet, så klikk lenken.`);
      else if (r.reason === 'NOGAME') setStatus(`Kopierte ${b.dataset.link}. Spillet kjører ikke, lim inn selv med Ctrl+V.`);
      else if (r.reason === 'NOHELPER') setStatus(`Kopierte ${b.dataset.link}. Hjelperen mangler, lim inn selv med Ctrl+V.`);
      else setStatus(`Kopierte ${b.dataset.link}, men fikk ikke fokus på spillet (${r.reason}). Lim inn selv med Ctrl+V.`);
    }));
    root.querySelectorAll('.tm-toggle input').forEach((cb) => cb.addEventListener('change', async () => {
      if (cb.checked) hidden.delete(cb.dataset.key); else hidden.add(cb.dataset.key);
      await window.api.invoke('config:set', { timersHidden: [...hidden] });
    }));
  }

  Panel.register({ id: 'timers', title: 'Tidsplan', icon: '⏱️', mount, unmount });
})();
