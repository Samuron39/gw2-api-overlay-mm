'use strict';
// Guild-modul (renderer): MOTD, logg, lager og treasury.
(() => {
  const { $, esc, gold, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let data = null;
  let selected = null;
  let view = 'log';

  const template = () => `
    <div class="toolbar">
      <select id="glSelect"></select>
      <div class="subtabs">
        <button class="subtab ${view === 'log' ? 'active' : ''}" data-view="log">${esc(t('guild.log'))}</button>
        <button class="subtab ${view === 'stash' ? 'active' : ''}" data-view="stash">${esc(t('guild.stash'))}</button>
        <button class="subtab ${view === 'treasury' ? 'active' : ''}" data-view="treasury">${esc(t('guild.treasury'))}</button>
      </div>
      <div class="spacer"></div>
      <button id="glRefresh" class="primary">${esc(t('common.refresh'))}</button>
    </div>
    <div id="glMotd" class="gl-motd" hidden></div>
    <div class="table-wrap" id="glBody"></div>`;

  async function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    $('#glSelect', el).addEventListener('change', (e) => { selected = e.target.value; render(); });
    el.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; el.querySelectorAll('.subtab').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
    $('#glRefresh', el).addEventListener('click', () => refresh(true));
    await refresh(false);
  }
  function unmount() { life.clear(); root = null; }

  async function refresh(force) {
    const valid = scope.request('refresh');
    if (!Panel.config?.apiKey) { setStatus(t('common.noApiKey'), true); return; }
    setStatus(t('guild.fetching'));
    try {
      const result = await window.api.invoke('guild:get', !!force);
      if (!valid()) return;
      data = result;
      if (!selected || !data.guilds.some((g) => g.id === selected)) selected = data.guilds[0]?.id || null;
      $('#glSelect', root).innerHTML = data.guilds.map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? 'selected' : ''}>[${esc(g.tag)}] ${esc(g.name)}${g.leader ? ' ' + esc(t('guild.leader')) : ''}</option>`).join('') || `<option value="">${esc(t('guild.none'))}</option>`;
      setStatus(data.guilds.length ? t('guild.fetched', { n: data.guilds.length }) : t('guild.notMember'));
      render();
    } catch (e) { if (valid()) setStatus(t('common.error', { message: e.message }), true); }
  }

  const when = (s) => { const d = new Date(s); return d.toLocaleDateString(T.locale, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' }); };

  function render() {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root || !data) return;
    const g = data.guilds.find((x) => x.id === selected);
    const body = $('#glBody', root);
    const motd = $('#glMotd', root);
    if (!g) { body.innerHTML = `<div class="empty">${esc(t('guild.noGuild'))}</div>`; motd.hidden = true; return; }
    motd.hidden = !g.motd;
    motd.textContent = g.motd || '';
    const err = g.errors.length ? `<p class="muted small" style="padding:0 12px">${esc(t('guild.unavailable', { errors: g.errors.join(' | ') }))}</p>` : '';
    if (view === 'log') {
      body.innerHTML = err + `<table class="gl-log"><thead><tr><th>${esc(t('guild.col.time'))}</th><th>${esc(t('guild.col.type'))}</th><th>${esc(t('guild.col.what'))}</th></tr></thead><tbody>${g.logRows.map((l) => `<tr><td class="muted">${when(l.time)}</td><td>${esc(l.type)}</td><td class="msg">${esc(l.text)}</td></tr>`).join('') || `<tr><td colspan="3" class="empty">${esc(t('guild.noLog'))}</td></tr>`}</tbody></table>`;
    } else if (view === 'stash') {
      body.innerHTML = err + g.stashSummary.map((s) => `<div class="dy-card" style="margin:8px 12px"><h3>${esc(s.note || t('guild.stashDefault'))} <span class="muted small">${gold(s.coins)} · ${esc(t('guild.slots', { used: s.items.length, size: s.size }))}</span></h3><div class="dy-list">${s.items.map((it) => `<span class="dy-item"><img src="${esc(it.icon)}" alt="" style="width:16px;height:16px;vertical-align:middle" /> ${esc(it.name)} ×${esc(it.count)}</span>`).join('') || `<span class="muted">${esc(t('guild.empty'))}</span>`}</div></div>`).join('') || `<div class="empty">${esc(t('guild.noStash'))}</div>`;
    } else {
      body.innerHTML = err + `<table><thead><tr><th>${esc(t('common.item'))}</th><th class="num">${esc(t('guild.col.have'))}</th><th class="num">${esc(t('guild.col.missing'))}</th><th>${esc(t('guild.col.forUpgrade'))}</th></tr></thead><tbody>${g.treasuryRows.map((r) => `<tr><td class="name"><img src="${esc(r.icon)}" alt="" />${esc(r.name)}</td><td class="num">${esc(r.count)}</td><td class="num ${r.missing ? 'down' : 'up'}">${esc(r.missing)}</td><td class="small">${r.needed.map((n) => `${esc(n.upgrade)} (${esc(n.count)})`).join(', ')}</td></tr>`).join('') || `<tr><td colspan="4" class="empty">${esc(t('guild.noTreasury'))}</td></tr>`}</tbody></table>`;
    }
  }

  Panel.register({ id: 'guild', title: () => T.t('module.guild'), icon: '🏰', mount, unmount });
})();
