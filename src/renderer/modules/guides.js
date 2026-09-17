'use strict';
// Guider-modul (renderer): venstre kolonne med søk og grupper (verdensbosser, fraktaler, raids, strikes), høyre kolonne med
// AI-utdraget fra wikien for valgt boss: punktliste, chat-linjer med «Lim inn i chat», wikilenke og lisenslinje (CC BY-SA).
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  const GROUPS = ['worldbosses', 'fractals', 'raids', 'strikes', 'dungeons'];
  const CHAT_MAX = 190; // spillets chat tar 199 tegn; samme grense som i src/modules/guides.js
  const SELECT_KEY = 'guides.select'; // Tidsplan-fanen legger id her før den åpner Guider
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let data = null;
  let selected = null;
  let guide = null;
  let busy = null;
  const results = new Map(), jobs = new Map();
  let query = '';
  let mumble = { running: false };
  let offMumble = null;
  let offProgress = null;
  const open = new Set(); // åpne grupper i lista; alle starter sammenlagt, søk åpner alt midlertidig

  const template = () => `
    <div class="gd-wrap">
      <div class="gd-list">
        <input type="search" id="gdSearch" placeholder="${esc(t('guides.search'))}" value="${esc(query)}" />
        <div id="gdGroups"></div>
      </div>
      <div class="gd-detail" id="gdDetail"></div>
    </div>`;

  async function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    $('#gdSearch', el).addEventListener('input', (e) => { query = e.target.value; renderList(); });
    offProgress = scope.on('ai:progress', (p) => {
      if (jobs.get(selected)?.id !== p.requestId) return;
      const box = busy && root && $('#gdProgress', root);
      if (box) box.textContent = p.content ? t('common.writing', { n: p.content }) : t('common.thinking', { n: p.reasoning });
    });
    const initial = await window.api.invoke('mumble:get').catch(() => mumble);
    if (!mounted.valid()) return;
    mumble = initial;
    offMumble = scope.on('mumble:state', (s) => { const changed = s?.mapId !== mumble?.mapId; mumble = s; if (changed) { renderList(); renderDetail(); } });
    if (!data) {
      try { data = await window.api.invoke('guides:list'); }
      catch (e) { if (mounted.valid()) setStatus(t('common.error', { message: e.message }), true); return; }
    }
    if (!mounted.valid()) return;
    // Valg fra Tidsplan-fanen («Strategi»-knappen)
    let pick = null;
    try { pick = sessionStorage.getItem(SELECT_KEY); sessionStorage.removeItem(SELECT_KEY); } catch { /* ikke tilgjengelig */ }
    renderList();
    if (pick) select(pick); else renderDetail();
  }

  function unmount() { life.clear(); offMumble?.(); offMumble = null; offProgress?.(); offProgress = null; root = null; }

  const hereId = () => (mumble?.running && mumble.mapId ? mumble.mapId : null);
  const onMap = (e) => { const here = hereId(); return !!here && (e.map === here || (e.maps || []).includes(here)); };
  const matches = (e, q) => !q || [e.name, e.where, e.page, e.location, e.waypoint?.name, ...(e.aliases || []), ...(e.bosses || []), ...(e.paths || [])].some((s) => String(s || '').toLowerCase().includes(q));
  // «Navn · [&B...=]» på én linje, maks CHAT_MAX tegn (samme som pasteLine() i hovedprosessen)
  function wpLine(e) {
    const code = e.waypoint?.code || '';
    const name = String(e.name || '').replace(/\s+/g, ' ').trim();
    const room = CHAT_MAX - (code ? code.length + 3 : 0);
    return (name.length > room ? name.slice(0, room - 1).trimEnd() + '…' : name) + (code ? ' · ' + code : '');
  }
  // compact = ikoner (i lista), ellers tekst (i detaljvisningen); tittelen viser linja som limes inn
  const wpButtons = (e, compact) => e.waypoint ? `<button class="small gd-wp-paste ${compact ? 'gd-ico' : ''}" data-id="${esc(e.id)}" title="${esc(t('guides.pasteWpTitle', { line: wpLine(e) }))}">${compact ? '💬' : esc(t('guides.paste'))}</button><button class="small gd-wp-copy ${compact ? 'gd-ico' : ''}" data-id="${esc(e.id)}" title="${esc(t('guides.copyWpTitle', { line: wpLine(e) }))}">${compact ? '📋' : esc(t('guides.copy'))}</button>` : '';
  function bindWpButtons(container) {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    container.querySelectorAll('.gd-wp-paste').forEach((b) => b.addEventListener('click', (ev) => { ev.stopPropagation(); const e = findEntry(b.dataset.id); if (e) paste(wpLine(e)); }));
    container.querySelectorAll('.gd-wp-copy').forEach((b) => b.addEventListener('click', async (ev) => { ev.stopPropagation(); const e = findEntry(b.dataset.id); if (!e) return; await window.api.invoke('clipboard:write', wpLine(e)); setStatus(t('guides.copied')); }));
  }

  function renderList() {
    if (!root || !data) return;
    const q = query.trim().toLowerCase();
    const here = hereId();
    const hereEntries = here ? GROUPS.flatMap((g) => (data.groups[g] || []).filter((e) => onMap(e) && matches(e, q))) : [];
    // Rad i lista: navn (klikk velger) pluss «Lim inn i chat»/«Kopier» for waypointet
    const row = (e) => `<div class="gd-item ${e.id === selected ? 'active' : ''}" data-id="${esc(e.id)}"><span class="gd-name"><b>${esc(e.name)}</b>${e.where && e.where !== e.name ? `<span class="muted"> · ${esc(e.where)}</span>` : ''}${e.wing ? `<span class="muted"> · ${esc(e.wing)}</span>` : ''}</span><span class="gd-wp">${wpButtons(e, true)}</span></div>`;
    const groups = GROUPS.map((g) => {
      const entries = (data.groups[g] || []).filter((e) => matches(e, q));
      if (!entries.length) return '';
      return `<details class="gd-group" data-group="${g}" ${open.has(g) || q ? 'open' : ''}><summary>${esc(t('guides.group.' + g))} <span class="muted">${entries.length}</span></summary>${entries.map(row).join('')}</details>`;
    }).join('');
    $('#gdGroups', root).innerHTML = (hereEntries.length ? `<div class="gd-here"><div class="gd-gt">${esc(t('guides.here'))}</div>${hereEntries.map(row).join('')}</div>` : '') + (groups || `<div class="empty">${esc(t('guides.empty'))}</div>`);
    root.querySelectorAll('.gd-item').forEach((b) => b.addEventListener('click', () => select(b.dataset.id)));
    bindWpButtons($('#gdGroups', root));
    root.querySelectorAll('.gd-group').forEach((d) => d.addEventListener('toggle', () => { if (query.trim()) return; if (d.open) open.add(d.dataset.group); else open.delete(d.dataset.group); }));
  }

  function findEntry(id) { for (const g of GROUPS) { const e = (data?.groups[g] || []).find((x) => x.id === id); if (e) return { ...e, group: g }; } return null; }

  async function select(id, refresh = false) {
    if (!findEntry(id)) return;
    selected = id; guide = results.get(id) || null;
    if (jobs.has(id)) { busy = id; renderList(); renderDetail(); return; }
    const job = { id: Panel.requestId('guide') }; jobs.set(id, job); busy = id;
    renderList();
    renderDetail();
    try {
      const r = await window.api.invoke('guides:get', id, refresh, { requestId: job.id });
      if (!job.cancelled && jobs.get(id) === job) results.set(id, r);
    } catch (e) { if (!job.cancelled && jobs.get(id) === job) results.set(id, { error: { code: 'ERR', message: e.message } }); }
    finally { if (jobs.get(id) === job) jobs.delete(id); }
    guide = results.get(selected) || null; busy = jobs.has(selected) ? selected : null;
    renderDetail();
  }

  function renderDetail() {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root) return;
    const box = $('#gdDetail', root);
    const e = selected && findEntry(selected);
    if (!e) { box.innerHTML = `<div class="empty">${esc(t('guides.pick'))}</div>`; return; }
    const url = guide?.url || ('https://wiki.guildwars2.com/wiki/' + encodeURIComponent(e.page.replace(/ /g, '_')));
    const head = `
      <div class="gd-head">
        <h3>${esc(e.name)}${onMap(e) ? ` <span class="badge here">${esc(t('guides.here'))}</span>` : ''}</h3>
        <div class="muted small">${esc(t('guides.group.' + e.group))}${e.where && e.where !== e.name ? ' · ' + esc(e.where) : ''}${e.wing ? ' · ' + esc(e.wing) : ''}${e.expansion ? ' · ' + esc(e.expansion) : ''}</div>
        ${e.bosses?.length ? `<div class="muted small">${esc(t('guides.bosses', { list: e.bosses.join(', ') }))}</div>` : ''}
        ${e.paths?.length ? `<div class="muted small">${esc(t('guides.paths'))}: ${esc(e.paths.join(' · '))}</div>` : ''}
        <div class="gd-where small">${esc(t('guides.location'))}: <b>${esc(e.location || '–')}</b> · ${esc(t('guides.waypoint'))}: ${e.waypoint ? `<b>${esc(e.waypoint.name)}</b> <code>${esc(e.waypoint.code)}</code> ${wpButtons(e)}` : `<span class="muted">${esc(t('guides.noWaypoint'))}</span>`}</div>
        <div class="row gd-actions">
          <button id="gdWiki" data-url="${esc(url)}">${esc(t('guides.wiki'))}</button>
          <button id="gdRefresh" ${busy === selected ? 'disabled' : ''}>${esc(t('guides.refresh'))}</button>
          <button id="gdCancel" ${jobs.has(selected) ? '' : 'hidden'}>${esc(t('common.cancel'))}</button>
        </div>
      </div>`;
    let body = '';
    if (busy === selected && !guide) body = `<div class="empty">${esc(t('guides.fetching'))}<br><span id="gdProgress" class="muted small"></span></div>`;
    else if (guide) {
      if (guide.error) body += `<div class="gd-error">${esc(guide.error.code === 'NOAI' ? t('guides.noAi') : guide.stale ? t('guides.staleNote', { message: guide.error.message }) : t('guides.failed', { message: guide.error.message }))}${guide.error.code === 'NOAI' ? ` <button id="gdSettings" class="small">${esc(t('module.settings'))}</button>` : ''}</div>`;
      if (guide.summary?.length) {
        body += `<h4>${esc(t('guides.summary'))}</h4><ul class="gd-summary">${guide.summary.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
        if (guide.chat?.length) body += `<h4>${esc(t('guides.chat'))}</h4><div class="gd-chat">${guide.chat.map((s, i) => `<div class="gd-line"><span class="gd-txt">${esc(s)}</span><span class="muted small">${s.length}</span><button class="small gd-paste" data-i="${i}" title="${esc(t('guides.pasteTitle'))}">${esc(t('guides.paste'))}</button><button class="small gd-copy" data-i="${i}">${esc(t('guides.copy'))}</button></div>`).join('')}</div>`;
        if (guide.tips?.length) body += `<h4>${esc(t('guides.tips'))}</h4><ul class="gd-summary">${guide.tips.map((s) => `<li>${esc(s)}</li>`).join('')}</ul>`;
        if (guide.fetchedAt) body += `<p class="muted small">${esc(t('guides.fetchedAt', { time: new Date(guide.fetchedAt).toLocaleString(T.locale), model: guide.model || '?' }))}${guide.language ? ' · ' + esc(guide.language) : ''}</p>`;
      }
    }
    const foot = `<p class="gd-license muted small">${esc(t('guides.license'))} · <a href="#" id="gdWikiLink" data-url="${esc(url)}">${esc(url)}</a></p>`;
    box.innerHTML = head + body + foot;
    for (const id of ['#gdWiki', '#gdWikiLink']) { const b = $(id, box); if (b) b.addEventListener('click', (ev) => { ev.preventDefault(); window.api.invoke('open:url', b.dataset.url); }); }
    $('#gdRefresh', box).addEventListener('click', () => select(selected, true));
    $('#gdCancel', box).addEventListener('click', () => { const job = jobs.get(selected); if (!job) return; job.cancelled = true; jobs.delete(selected); busy = null; window.api.invoke('ai:cancel', job.id).catch(() => {}); renderDetail(); });
    bindWpButtons(box);
    $('#gdSettings', box)?.addEventListener('click', () => window.api.invoke('panel:show', 'settings'));
    box.querySelectorAll('.gd-paste').forEach((b) => b.addEventListener('click', () => paste(guide.chat[Number(b.dataset.i)])));
    box.querySelectorAll('.gd-copy').forEach((b) => b.addEventListener('click', async () => { await window.api.invoke('clipboard:write', guide.chat[Number(b.dataset.i)]); setStatus(t('guides.copied')); }));
  }

  async function paste(text) {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    if (!text) return;
    try {
      const r = await window.api.invoke('game:paste', text);
      if (r.ok) setStatus(t('guides.pasted'));
      else if (r.reason === 'NOGAME') setStatus(t('guides.noGame'), true);
      else if (r.reason === 'NOHELPER') setStatus(t('guides.noHelper'), true);
      else setStatus(t('guides.pasteFailed', { reason: r.reason }), true);
    } catch (e) { setStatus(t('common.error', { message: e.message }), true); }
  }

  Panel.register({ id: 'guides', title: () => T.t('module.guides'), icon: '📖', mount, unmount });
})();
