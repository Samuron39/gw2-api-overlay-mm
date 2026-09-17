'use strict';
// Tidsplan-modul (renderer): hva skjer nå, hva er neste, hvor er det. Data fra GW2-wikien (CC BY-SA).
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let data = null;
  let mumble = { running: false };
  let offMumble = null;
  let tick = null;
  let hidden = new Set();
  let category = '';
  let editMode = false;
  let doneBosses = new Set();
  let doneTimer = null;
  const bossId = TimerLogic.bossId;
  let signature = '';
  async function loadDone() {
    if (!Panel.config?.apiKey || !scope?.valid()) return;
    const valid = scope.request('worldbosses');
    try { const d = await window.api.invoke('daily:worldbosses', false); if (valid()) { doneBosses = new Set(d.done || []); render(); } } catch { /* uten progression */ }
  }

  // Guider: «Strategi»-knapp per boss. Lista hentes én gang (data/guides.json); oppføringen finnes når event-nøkkelen
  // stemmer og navnet er bossen selv, et alias (segmentnavn) eller hele metaen. Valget gis til Guider via sessionStorage.
  let guides = null;
  function guideFor(key, e, seg) {
    if (!guides || !seg?.name) return null;
    return guides.find((g) => g.event === key && (g.name === seg.name || (g.aliases || []).includes(seg.name))) || guides.find((g) => g.event === key && g.name === e.name) || null;
  }
  const strategyBtn = (key, e, seg) => { const g = guideFor(key, e, seg); return g ? ` <button class="gd-strat" data-guide="${esc(g.id)}" title="${esc(t('timers.strategyTitle'))}">📖 ${esc(t('timers.strategy'))}</button>` : ''; };

  function status(key, e) {
    const st = TimerLogic.status(e, Date.now());
    return st ? { key, e, ...st } : null;
  }
  const countdown = (r) => r.curFiller ? t('timers.nextIn', { t: fmt(r.nextIn ?? r.remaining) }) : t('timers.endsIn', { t: fmt(r.remaining) });
  function pasteLine(key, next) {
    const r = status(key, data.events[key]);
    const seg = next ? r?.next : r?.cur;
    if (!seg?.chatlink) return '';
    const wp = wpInfo(seg), m = Math.max(0, Math.round((next ? r.nextIn : r.remaining) / 60));
    const time = new Date(Date.now() + (r.nextIn || 0) * 1000).toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' });
    const head = next ? t('timers.pasteNext', { name: seg.name, m, time }) : t('timers.pasteNow', { name: seg.name, m });
    const line = `${head}${wp ? ' · ' + wp.map : ''} · ${seg.chatlink}`;
    return line.length <= 190 ? line : head.slice(0, 187 - seg.chatlink.length) + ' · ' + seg.chatlink;
  }

  function fmt(sec) {
    sec = Math.max(0, Math.round(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = sec % 60;
    return h ? t('common.time.hm', { h, m: String(m).padStart(2, '0') }) : t('common.time.ms', { m, s: String(s).padStart(2, '0') });
  }

  function wpInfo(seg) {
    if (!seg?.chatlink) return null;
    try {
      const raw = atob(seg.chatlink.trim().slice(2, -1));
      if (raw.charCodeAt(0) !== 4) return null;
      const id = raw.charCodeAt(1) | (raw.charCodeAt(2) << 8) | (raw.charCodeAt(3) << 16);
      return data.waypoints[String(id)] || null;
    } catch { return null; }
  }

  function bg(seg) {
    const c = Array.isArray(seg?.bg) ? (Array.isArray(seg.bg[0]) ? seg.bg[0] : seg.bg) : null;
    return c ? `rgba(${c[0]},${c[1]},${c[2]},0.35)` : 'var(--line)';
  }

  const template = () => `
    <div class="toolbar">
      <select id="tmCategory"><option value="">${esc(t('timers.allExpansions'))}</option></select>
      <label class="inline"><input type="checkbox" id="tmEdit" /> ${esc(t('timers.edit'))}</label>
      <div class="spacer"></div>
      <span id="tmHere" class="muted"></span>
    </div>
    <div class="table-wrap"><div id="tmList" class="tm-list"></div></div>`;

  async function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el; signature = "";
    el.innerHTML = template();
    hidden = new Set(Panel.config?.timersHidden || []);
    if (!data) {
      try { data = await window.api.invoke('timers:data'); }
      catch (e) { setStatus(t('timers.loadFailed', { message: e.message }), true); return; }
    }
    if (!mounted.valid()) return;
    const cats = [...new Set(Object.values(data.events).map((e) => e.category).filter(Boolean))];
    $('#tmCategory', el).innerHTML = `<option value="">${esc(t('timers.allExpansions'))}</option>` + cats.map((c) => `<option value="${esc(c)}" ${c === category ? 'selected' : ''}>${esc(c)}</option>`).join('');
    $('#tmCategory', el).addEventListener('change', (e) => { category = e.target.value; render(); });
    $('#tmEdit', el).addEventListener('change', (e) => { editMode = e.target.checked; render(); });
    const initial = await window.api.invoke('mumble:get').catch(() => mumble);
    if (!mounted.valid()) return;
    mumble = initial;
    offMumble = scope.on('mumble:state', (s) => { mumble = s; });
    loadDone();
    if (!guides) window.api.invoke('guides:list').then((g) => { if (!mounted.valid()) return; guides = g.groups?.worldbosses || []; render(); }).catch(() => {}); // uten guider vises bare ikke knappen
    doneTimer = mounted.interval(loadDone, 5 * 60e3);
    render();
    tick = mounted.interval(render, 1000);
  }

  function unmount() { life.clear(); clearInterval(tick); tick = null; clearInterval(doneTimer); doneTimer = null; offMumble?.(); offMumble = null; root = null; }
  const killed = (seg) => doneBosses.size && seg?.name && doneBosses.has(bossId(seg.name)) ? ` <span class="badge done" title="${esc(t('timers.killedTitle'))}">${esc(t('timers.killed'))}</span>` : '';

  function render() {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root || !data) return;
    const here = mumble.running && mumble.mapId ? mumble.mapId : null;
    $('#tmHere', root).textContent = here ? t('timers.hereHint') : t('timers.noPosition');
    const rows = [];
    for (const [key, e] of Object.entries(data.events)) {
      if (category && e.category !== category) continue;
      if (!editMode && hidden.has(key)) continue;
      const st = status(key, e);
      if (st) rows.push(st);
    }
    rows.sort((a, b) => (a.curFiller ? 1 : 0) - (b.curFiller ? 1 : 0) || (a.nextIn ?? 1e9) - (b.nextIn ?? 1e9));
    const nextSignature = JSON.stringify([category, editMode, [...hidden], [...doneBosses], here, !!guides, rows.map((r) => [r.key, r.curId, r.start, r.next?.name])]);
    if (signature === nextSignature) {
      for (const r of rows) {
        const row = root.querySelector(`.tm-row[data-event="${CSS.escape(r.key)}"]`);
        if (!row) continue;
        $('.tm-countdown', row).textContent = countdown(r);
        $('.tm-bar', row).style.width = Math.round(r.progress * 100) + '%';
        const next = $('.tm-next-countdown', row); if (next) next.textContent = t('timers.inTime', { t: fmt(r.nextIn) });
      }
      return;
    }
    signature = nextSignature;
    $('#tmList', root).innerHTML = rows.map((r) => {
      const curWp = wpInfo(r.cur), nextWp = wpInfo(r.next);
      const hereNow = here && (curWp?.mapId === here || nextWp?.mapId === here);
      const place = (wp, seg) => wp ? `${esc(wp.map)} · ${esc(wp.name)}` : esc(seg?.link || r.e.name);
      return `<div data-event="${esc(r.key)}" class="tm-row ${hereNow ? 'here' : ''} ${hidden.has(r.key) ? 'hidden-row' : ''}">
        ${editMode ? `<label class="inline tm-toggle"><input type="checkbox" data-key="${esc(r.key)}" ${hidden.has(r.key) ? '' : 'checked'} /></label>` : ''}
        <div class="tm-head"><b>${esc(r.e.name)}</b><span class="muted"> ${esc(r.e.category)}</span>${hereNow ? `<span class="badge here">${esc(t('timers.here'))}</span>` : ''}</div>
        <div class="tm-now" style="background:${bg(r.cur)}">
          <div class="tm-bar" style="width:${Math.round(r.progress * 100)}%"></div>
          <span class="tm-txt">${r.curFiller ? `<span class="muted">${esc(t('timers.nothingNow'))}</span>` : `${esc(t('timers.now'))} <b>${esc(r.cur?.name)}</b>${killed(r.cur)}${strategyBtn(r.key, r.e, r.cur)}`} · <span class="tm-countdown">${esc(countdown(r))}</span></span>
          ${!r.curFiller && r.cur?.chatlink ? `<button class="wp" data-link="${esc(r.cur.chatlink)}" data-next="0" title="${esc(t('timers.pasteWp'))}">${place(curWp, r.cur)} ⧉</button>` : ''}
        </div>
        ${r.next ? `<div class="tm-next">${esc(t('timers.next'))} <b>${esc(r.next.name)}</b>${killed(r.next)}${strategyBtn(r.key, r.e, r.next)} <span class="tm-next-countdown">${esc(t('timers.inTime', { t: fmt(r.nextIn) }))}</span>
          ${r.next.chatlink ? `<button class="wp" data-link="${esc(r.next.chatlink)}" data-next="1" title="${esc(t('timers.pasteWp'))}">${place(nextWp, r.next)} ⧉</button>` : ''}</div>` : ''}
      </div>`;
    }).join('') || `<div class="empty">${esc(t('timers.empty'))}</div>`;
    root.querySelectorAll('button.wp').forEach((b) => b.addEventListener('click', async () => {
      // Limer inn «Boss om N min · kart · [&lenke]» (maks 190 tegn, spillets chat tar 199), regnet ut i det du trykker
      const link = pasteLine(b.closest('.tm-row').dataset.event, b.dataset.next === '1');
      const r = await window.api.invoke('game:paste', link);
      if (r.ok) setStatus(t('timers.pasted', { link }));
      else if (r.reason === 'NOGAME') setStatus(t('timers.noGame', { link }));
      else if (r.reason === 'NOHELPER') setStatus(t('timers.noHelper', { link }));
      else setStatus(t('timers.noFocus', { link, reason: r.reason }));
    }));
    root.querySelectorAll('button.gd-strat').forEach((b) => b.addEventListener('click', () => {
      try { sessionStorage.setItem('guides.select', b.dataset.guide); } catch { /* Guider viser da bare lista */ }
      window.api.invoke('panel:show', 'guides');
    }));
    root.querySelectorAll('.tm-toggle input').forEach((cb) => cb.addEventListener('change', async () => {
      if (cb.checked) hidden.delete(cb.dataset.key); else hidden.add(cb.dataset.key);
      await window.api.invoke('config:set', { timersHidden: [...hidden] });
    }));
  }

  Panel.register({ id: 'timers', title: () => T.t('module.timers'), icon: '⏱️', mount, unmount });
})();
