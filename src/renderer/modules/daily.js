'use strict';
// "I dag"-modul (renderer): Wizard's Vault, world bosses, kart-kister, daglig crafting, fraktaler.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
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
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    $('#dyRefresh', el).addEventListener('click', () => refresh(true));
    tick = mounted.interval(renderResets, 1000);
    if (!timers) timers = await window.api.invoke('timers:data').catch(() => null);
    if (!mounted.valid()) return;
    await refresh(false);
  }
  function unmount() { life.clear(); clearInterval(tick); tick = null; root = null; }

  async function refresh(force) {
    const valid = scope.request('refresh');
    if (!Panel.config?.apiKey) { setStatus(t('common.noApiKey'), true); return; }
    setStatus(t('daily.fetching'));
    try {
      const result = await window.api.invoke('daily:get', !!force);
      if (!valid()) return;
      data = result;
      setStatus(data.errors?.length ? t('common.partial', { errors: data.errors.join(' | ') }) : t('common.updatedAt', { time: new Date(data.fetchedAt).toLocaleTimeString(T.locale) }), !!data.errors?.length);
      render();
    } catch (e) { if (valid()) setStatus(t('common.error', { message: e.message }), true); }
  }

  function fmt(ms) {
    const s = Math.max(0, Math.round(ms / 1000));
    const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60);
    return d ? t('common.time.dh', { d, h }) : t('common.time.hm', { h, m: String(m).padStart(2, '0') });
  }
  function renderResets() {
    if (!root || !data) return;
    $('#dyResets', root).textContent = t('daily.resets', { daily: fmt(data.resets.daily - Date.now()), weekly: fmt(data.resets.weekly - Date.now()) });
    const spawns = bossSpawns();
    for (const row of root.querySelectorAll('[data-boss]')) {
      const spawn = spawns.get(row.dataset.boss);
      $('.dy-boss-time', row).textContent = bossTime(spawn);
      const button = $('button.wp', row);
      if (button && spawn) button.title = t('daily.pasteWpTitle', { line: pasteText(spawn.name, spawn.start, spawn.chatlink) });
    }
  }

  function pretty(id) { return id.replace(/_heros_choice_chest$/, '').replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase()); }

  // Aktivt segment betyr tidsplanen, ikke at bossen fortsatt lever i denne kartinstansen.
  function bossSpawns() { return TimerLogic.bossSpawns(timers?.events, Date.now()); }
  const bossTime = (spawn) => spawn ? spawn.active ? t('daily.now') : t('daily.inMin', { n: Math.max(1, Math.round(spawn.inMin)) }) : t('daily.noFixedTime');

  // Waypoint-oppslag (kartnavn) fra chat-lenka, samme koding som i timers.js: byte 0 = 4 (waypoint), byte 1-3 = id
  // Teksten som limes i chatten bygges i TimerLogic.pasteText, delt med overlay-vinduet «Neste bosser».
  // start = minutt i døgnet (UTC) fra tidsplanen, brukt bare hvis bossen ikke finnes i tidsplanen lenger.
  function pasteText(name, start, link) {
    const m = (Date.now() / 60000) % 1440;
    const spawn = bossSpawns().get(TimerLogic.bossId(name));
    const inMin = spawn ? spawn.inMin : start >= m ? start - m : start + 1440 - m;
    return TimerLogic.pasteText({ name, chatlink: link, active: !!spawn?.active, inMin }, Date.now(), { t, locale: T.locale, waypoints: timers?.waypoints });
  }


  function wizardSection(title, w) {
    if (!w) return `<section class="dy-card"><h3>${esc(title)}</h3><p class="muted">${esc(t('daily.unavailable'))}</p></section>`;
    const objs = (w.objectives || []).slice().sort((a, b) => (a.claimed - b.claimed) || a.title.localeCompare(b.title));
    return `<section class="dy-card">
      <h3>${esc(title)} <span class="muted small">${esc(w.meta_progress_current)}/${esc(w.meta_progress_complete)}${w.meta_reward_claimed ? ' · ' + esc(t('daily.rewardClaimed')) : ''}</span></h3>
      ${objs.map((o) => `<div class="dy-row ${o.claimed ? 'done' : ''}">
        <span class="dy-check">${o.claimed ? '✓' : (o.progress_current >= o.progress_complete ? '★' : '○')}</span>
        <span class="dy-title">${esc(o.title)} <span class="muted small">${esc(o.track)} · ${esc(o.acclaim)} AA</span></span>
        <span class="dy-prog"><span class="dy-bar" style="width:${Math.min(100, Math.round(o.progress_current / Math.max(1, o.progress_complete) * 100))}%"></span><span>${esc(o.progress_current)}/${esc(o.progress_complete)}</span></span>
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
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root || !data) return;
    renderResets();
    const spawns = bossSpawns();
    const done = new Set(data.worldbosses.done);
    const bosses = data.worldbosses.all.map((id) => ({ id, done: done.has(id), spawn: spawns.get(id) }))
      .sort((a, b) => a.done - b.done || (a.spawn?.inMin ?? 9999) - (b.spawn?.inMin ?? 9999));
    const bossHtml = `<section class="dy-card"><h3>${esc(t('daily.worldBosses'))} <span class="muted small">${data.worldbosses.done.length}/${data.worldbosses.all.length} ${esc(t('daily.today'))}</span></h3>
      ${bosses.map((b) => `<div data-boss="${esc(b.id)}" class="dy-row ${b.done ? 'done' : ''}">
        <span class="dy-check">${b.done ? '✓' : '○'}</span>
        <span class="dy-title">${esc(b.spawn?.name || pretty(b.id))}</span>
        <span class="muted small dy-boss-time">${esc(bossTime(b.spawn))}</span>
        ${b.spawn?.chatlink ? `<button class="wp" data-link="${esc(b.spawn.chatlink)}" data-name="${esc(b.spawn.name)}" data-start="${b.spawn.start}" title="${esc(t('daily.pasteWpTitle', { line: pasteText(b.spawn.name, b.spawn.start, b.spawn.chatlink) }))}">⧉</button>` : ''}
      </div>`).join('')}
    </section>`;
    const fracHtml = `<section class="dy-card"><h3>${esc(t('daily.fractals'))} <span class="muted small">${data.fractals.filter((f) => f.done).length}/${data.fractals.length}</span></h3>
      ${data.fractals.map((f) => `<div class="dy-row ${f.done ? 'done' : ''}"><span class="dy-check">${f.done ? '✓' : '○'}</span><span class="dy-title">${esc(f.name)}<br><span class="muted small">${esc(f.requirement || '')}</span></span><span class="muted small">${esc(f.current)}/${esc(f.max)}</span></div>`).join('') || `<p class="muted">${esc(t('daily.noData'))}</p>`}
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
      const line = b.dataset.name ? pasteText(b.dataset.name, Number(b.dataset.start), b.dataset.link) : b.dataset.link;
      const r = await window.api.invoke('game:paste', line);
      setStatus(r.ok ? t('daily.pasted', { link: line }) : t('daily.copied', { link: line, reason: r.reason }));
    }));
  }

  Panel.register({ id: 'daily', title: () => T.t('module.daily'), icon: '📅', mount, unmount });
})();
