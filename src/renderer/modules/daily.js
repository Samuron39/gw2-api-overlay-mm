'use strict';
// "I dag"-modul (renderer): Wizard's Vault, world bosses, kart-kister, daglig crafting, fraktaler.
(() => {
  const { $, esc, setStatus } = Panel;
  let root = null;
  let data = null;
  let timers = null;
  let tick = null;

  const TEMPLATE = `
    <div class="toolbar">
      <span id="dyResets" class="muted"></span>
      <div class="spacer"></div>
      <button id="dyRefresh" class="primary">Oppdater</button>
    </div>
    <div class="table-wrap"><div id="dyBody" class="dy-grid"></div></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
    $('#dyRefresh', el).addEventListener('click', () => refresh(true));
    if (!timers) timers = await window.api.invoke('timers:data').catch(() => null);
    await refresh(false);
    tick = setInterval(renderResets, 1000);
  }
  function unmount() { clearInterval(tick); tick = null; root = null; }

  async function refresh(force) {
    if (!Panel.config?.apiKey) { setStatus('Legg inn API-nøkkel under Innstillinger.', true); return; }
    setStatus('Henter dagens status…');
    try {
      data = await window.api.invoke('daily:get', !!force);
      if (!root) return;
      setStatus(data.errors?.length ? 'Delvis hentet: ' + data.errors.join(' | ') : `Oppdatert ${new Date(data.fetchedAt).toLocaleTimeString('nb-NO')}`, !!data.errors?.length);
      render();
    } catch (e) { setStatus('Feil: ' + e.message, true); }
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? `${d}d ${h}t` : `${h}t ${String(m).padStart(2, '0')}m`;
  }
  function renderResets() {
    if (!root || !data) return;
    $('#dyResets', root).textContent = `Daglig reset om ${fmt(data.resets.daily - Date.now())} · ukentlig om ${fmt(data.resets.weekly - Date.now())}`;
  }

  function pretty(id) { return id.replace(/_heros_choice_chest$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

  // Neste spawn per world boss fra tidsplanen
  function bossSpawns() {
    const out = new Map();
    if (!timers) return out;
    const m = (Date.now() / 60000) % 1440;
    for (const key of ['core-wb', 'core-hwb']) {
      const e = timers.events[key]; if (!e) continue;
      const segs = []; let t = 0;
      for (const s of e.sequences?.partial || []) { segs.push({ r: s.r, start: t }); t += s.d; }
      let guard = 0;
      while ((e.sequences?.pattern || []).length && t < 1440 && guard++ < 3000) for (const s of e.sequences.pattern) { segs.push({ r: s.r, start: t }); t += s.d; if (t >= 1440) break; }
      for (const s of segs) {
        const seg = e.segments[s.r]; if (!seg?.name) continue;
        const id = normalize(seg.name);
        const inMin = s.start >= m ? s.start - m : s.start + 1440 - m;
        const cur = out.get(id);
        if (!cur || inMin < cur.inMin) out.set(id, { name: seg.name, inMin, chatlink: seg.chatlink });
      }
    }
    return out;
  }
  const ALIAS = { 'golem mark ii': 'inquest_golem_mark_ii', 'triple trouble': 'triple_trouble_wurm' };
  function normalize(name) { const n = name.toLowerCase().trim(); return ALIAS[n] || n.replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, ''); }

  function wizardSection(title, w) {
    if (!w) return `<section class="dy-card"><h3>${esc(title)}</h3><p class="muted">Ikke tilgjengelig (krever progression).</p></section>`;
    const objs = (w.objectives || []).slice().sort((a, b) => (a.claimed - b.claimed) || a.title.localeCompare(b.title));
    return `<section class="dy-card">
      <h3>${esc(title)} <span class="muted small">${w.meta_progress_current}/${w.meta_progress_complete}${w.meta_reward_claimed ? ' · belønning hentet' : ''}</span></h3>
      ${objs.map((o) => `<div class="dy-row ${o.claimed ? 'done' : ''}">
        <span class="dy-check">${o.claimed ? '✓' : (o.progress_current >= o.progress_complete ? '★' : '○')}</span>
        <span class="dy-title">${esc(o.title)} <span class="muted small">${esc(o.track)} · ${o.acclaim} AA</span></span>
        <span class="dy-prog"><span class="dy-bar" style="width:${Math.min(100, Math.round(o.progress_current / Math.max(1, o.progress_complete) * 100))}%"></span><span>${o.progress_current}/${o.progress_complete}</span></span>
      </div>`).join('') || '<p class="muted">Ingen mål.</p>'}
    </section>`;
  }

  function listSection(title, all, done, hint) {
    const doneSet = new Set(done);
    const rows = all.map((id) => ({ id, done: doneSet.has(id) })).sort((a, b) => a.done - b.done || a.id.localeCompare(b.id));
    return `<section class="dy-card"><h3>${esc(title)} <span class="muted small">${done.length}/${all.length}</span></h3>
      ${hint ? `<p class="muted small">${esc(hint)}</p>` : ''}
      <div class="dy-list">${rows.map((r) => `<span class="dy-item ${r.done ? 'done' : ''}">${r.done ? '✓' : '○'} ${esc(pretty(r.id))}</span>`).join('')}</div>
    </section>`;
  }

  function render() {
    if (!root || !data) return;
    renderResets();
    const spawns = bossSpawns();
    const done = new Set(data.worldbosses.done);
    const bosses = data.worldbosses.all.map((id) => ({ id, done: done.has(id), spawn: spawns.get(id) }))
      .sort((a, b) => a.done - b.done || (a.spawn?.inMin ?? 9999) - (b.spawn?.inMin ?? 9999));
    const bossHtml = `<section class="dy-card"><h3>World bosses <span class="muted small">${data.worldbosses.done.length}/${data.worldbosses.all.length} i dag</span></h3>
      ${bosses.map((b) => `<div class="dy-row ${b.done ? 'done' : ''}">
        <span class="dy-check">${b.done ? '✓' : '○'}</span>
        <span class="dy-title">${esc(b.spawn?.name || pretty(b.id))}</span>
        <span class="muted small">${b.spawn ? (b.spawn.inMin < 1 ? 'nå' : 'om ' + Math.round(b.spawn.inMin) + ' min') : 'ingen fast tid'}</span>
        ${b.spawn?.chatlink ? `<button class="wp" data-link="${esc(b.spawn.chatlink)}" title="Lim inn waypoint i chatten">⧉</button>` : ''}
      </div>`).join('')}
    </section>`;
    const fracHtml = `<section class="dy-card"><h3>Daglige fraktaler <span class="muted small">${data.fractals.filter((f) => f.done).length}/${data.fractals.length}</span></h3>
      ${data.fractals.map((f) => `<div class="dy-row ${f.done ? 'done' : ''}"><span class="dy-check">${f.done ? '✓' : '○'}</span><span class="dy-title">${esc(f.name)}<br><span class="muted small">${esc(f.requirement || '')}</span></span><span class="muted small">${f.current}/${f.max}</span></div>`).join('') || '<p class="muted">Ingen data.</p>'}
    </section>`;
    $('#dyBody', root).innerHTML = [
      wizardSection("Wizard's Vault daglig", data.wizard.daily),
      wizardSection("Wizard's Vault ukentlig", data.wizard.weekly),
      bossHtml,
      fracHtml,
      listSection('Daglig crafting', data.dailycrafting.all, data.dailycrafting.done, 'Tidsbegrenset crafting, én av hver per dag.'),
      listSection("Hero's Choice-kister", data.mapchests.all, data.mapchests.done, 'Meta-event-kister du har åpnet i dag.'),
      data.wizard.special ? wizardSection("Wizard's Vault spesial", data.wizard.special) : '',
    ].join('');
    root.querySelectorAll('button.wp').forEach((b) => b.addEventListener('click', async () => {
      const r = await window.api.invoke('game:paste', b.dataset.link);
      setStatus(r.ok ? `${b.dataset.link} er limt inn i chatten.` : `Kopierte ${b.dataset.link} (${r.reason}).`);
    }));
  }

  Panel.register({ id: 'daily', title: 'I dag', icon: '📅', mount, unmount });
})();
