'use strict';
// "I dag"-modul (renderer): Wizard's Vault, world bosses, kart-kister, daglig crafting, fraktaler.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  let data = null;
  let timers = null;
  let tick = null;

  const template = () => `
    <div class="toolbar">
      <span id="dyResets" class="muted"></span>
      <div class="spacer"></div>
      <button id="dyRefresh" class="primary">${t('common.refresh')}</button>
    </div>
    <div class="table-wrap"><div id="dyBody" class="dy-grid"></div></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = template();
    $('#dyRefresh', el).addEventListener('click', () => refresh(true));
    if (!timers) timers = await window.api.invoke('timers:data').catch(() => null);
    await refresh(false);
    tick = setInterval(renderResets, 1000);
  }
  function unmount() { clearInterval(tick); tick = null; root = null; }

  async function refresh(force) {
    if (!Panel.config?.apiKey) { setStatus(t('common.noApiKey'), true); return; }
    setStatus(t('daily.fetching'));
    try {
      data = await window.api.invoke('daily:get', !!force);
      if (!root) return;
      setStatus(data.errors?.length ? t('common.partial', { errors: data.errors.join(' | ') }) : t('common.updatedAt', { time: new Date(data.fetchedAt).toLocaleTimeString(T.locale) }), !!data.errors?.length);
      render();
    } catch (e) { setStatus(t('common.error', { message: e.message }), true); }
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? t('common.time.dh', { d, h }) : t('common.time.hm', { h, m: String(m).padStart(2, '0') });
  }
  function renderResets() {
    if (!root || !data) return;
    $('#dyResets', root).textContent = t('daily.resets', { daily: fmt(data.resets.daily - Date.now()), weekly: fmt(data.resets.weekly - Date.now()) });
  }

  function pretty(id) { return id.replace(/_heros_choice_chest$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

  // Neste spawn per world boss fra tidsplanen
  function bossSpawns() {
    const out = new Map();
    if (!timers) return out;
    const m = (Date.now() / 60000) % 1440;
    for (const key of ['core-wb', 'core-hwb']) {
      const e = timers.events[key]; if (!e) continue;
      const segs = []; let tm = 0;
      for (const s of e.sequences?.partial || []) { segs.push({ r: s.r, start: tm }); tm += s.d; }
      let guard = 0;
      while ((e.sequences?.pattern || []).length && tm < 1440 && guard++ < 3000) for (const s of e.sequences.pattern) { segs.push({ r: s.r, start: tm }); tm += s.d; if (tm >= 1440) break; }
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
    if (!w) return `<section class="dy-card"><h3>${esc(title)}</h3><p class="muted">${esc(t('daily.unavailable'))}</p></section>`;
    const objs = (w.objectives || []).slice().sort((a, b) => (a.claimed - b.claimed) || a.title.localeCompare(b.title));
    return `<section class="dy-card">
      <h3>${esc(title)} <span class="muted small">${w.meta_progress_current}/${w.meta_progress_complete}${w.meta_reward_claimed ? ' · ' + esc(t('daily.rewardClaimed')) : ''}</span></h3>
      ${objs.map((o) => `<div class="dy-row ${o.claimed ? 'done' : ''}">
        <span class="dy-check">${o.claimed ? '✓' : (o.progress_current >= o.progress_complete ? '★' : '○')}</span>
        <span class="dy-title">${esc(o.title)} <span class="muted small">${esc(o.track)} · ${o.acclaim} AA</span></span>
        <span class="dy-prog"><span class="dy-bar" style="width:${Math.min(100, Math.round(o.progress_current / Math.max(1, o.progress_complete) * 100))}%"></span><span>${o.progress_current}/${o.progress_complete}</span></span>
      </div>`).join('') || `<p class="muted">${esc(t('daily.noObjectives'))}</p>`}
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
    const bossHtml = `<section class="dy-card"><h3>${esc(t('daily.worldBosses'))} <span class="muted small">${data.worldbosses.done.length}/${data.worldbosses.all.length} ${esc(t('daily.today'))}</span></h3>
      ${bosses.map((b) => `<div class="dy-row ${b.done ? 'done' : ''}">
        <span class="dy-check">${b.done ? '✓' : '○'}</span>
        <span class="dy-title">${esc(b.spawn?.name || pretty(b.id))}</span>
        <span class="muted small">${esc(b.spawn ? (b.spawn.inMin < 1 ? t('daily.now') : t('daily.inMin', { n: Math.round(b.spawn.inMin) })) : t('daily.noFixedTime'))}</span>
        ${b.spawn?.chatlink ? `<button class="wp" data-link="${esc(b.spawn.chatlink)}" title="${esc(t('daily.pasteWp'))}">⧉</button>` : ''}
      </div>`).join('')}
    </section>`;
    const fracHtml = `<section class="dy-card"><h3>${esc(t('daily.fractals'))} <span class="muted small">${data.fractals.filter((f) => f.done).length}/${data.fractals.length}</span></h3>
      ${data.fractals.map((f) => `<div class="dy-row ${f.done ? 'done' : ''}"><span class="dy-check">${f.done ? '✓' : '○'}</span><span class="dy-title">${esc(f.name)}<br><span class="muted small">${esc(f.requirement || '')}</span></span><span class="muted small">${f.current}/${f.max}</span></div>`).join('') || `<p class="muted">${esc(t('daily.noData'))}</p>`}
    </section>`;
    $('#dyBody', root).innerHTML = [
      wizardSection(t('daily.wvDaily'), data.wizard.daily),
      wizardSection(t('daily.wvWeekly'), data.wizard.weekly),
      bossHtml,
      fracHtml,
      listSection(t('daily.crafting'), data.dailycrafting.all, data.dailycrafting.done, t('daily.craftingHint')),
      listSection(t('daily.chests'), data.mapchests.all, data.mapchests.done, t('daily.chestsHint')),
      data.wizard.special ? wizardSection(t('daily.wvSpecial'), data.wizard.special) : '',
    ].join('');
    root.querySelectorAll('button.wp').forEach((b) => b.addEventListener('click', async () => {
      const r = await window.api.invoke('game:paste', b.dataset.link);
      setStatus(r.ok ? t('daily.pasted', { link: b.dataset.link }) : t('daily.copied', { link: b.dataset.link, reason: r.reason }));
    }));
  }

  Panel.register({ id: 'daily', title: () => T.t('module.daily'), icon: '📅', mount, unmount });
})();
