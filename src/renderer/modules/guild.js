'use strict';
// Guild-modul (renderer): MOTD, logg, lager og treasury.
(() => {
  const { $, esc, gold, setStatus } = Panel;
  let root = null;
  let data = null;
  let selected = null;
  let view = 'log';

  const TEMPLATE = `
    <div class="toolbar">
      <select id="glSelect"></select>
      <div class="subtabs">
        <button class="subtab active" data-view="log">Logg</button>
        <button class="subtab" data-view="stash">Lager</button>
        <button class="subtab" data-view="treasury">Treasury</button>
      </div>
      <div class="spacer"></div>
      <button id="glRefresh" class="primary">Oppdater</button>
    </div>
    <div id="glMotd" class="gl-motd" hidden></div>
    <div class="table-wrap" id="glBody"></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
    $('#glSelect', el).addEventListener('change', (e) => { selected = e.target.value; render(); });
    el.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; el.querySelectorAll('.subtab').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
    $('#glRefresh', el).addEventListener('click', () => refresh(true));
    await refresh(false);
  }
  function unmount() { root = null; }

  async function refresh(force) {
    if (!Panel.config?.apiKey) { setStatus('Legg inn API-nøkkel under Innstillinger.', true); return; }
    setStatus('Henter guild-data…');
    try {
      data = await window.api.invoke('guild:get', !!force);
      if (!root) return;
      if (!selected || !data.guilds.some((g) => g.id === selected)) selected = data.guilds[0]?.id || null;
      $('#glSelect', root).innerHTML = data.guilds.map((g) => `<option value="${esc(g.id)}" ${g.id === selected ? 'selected' : ''}>[${esc(g.tag)}] ${esc(g.name)}${g.leader ? ' (leder)' : ''}</option>`).join('') || '<option value="">Ingen guild</option>';
      setStatus(data.guilds.length ? `${data.guilds.length} guild hentet.` : 'Kontoen er ikke med i noen guild.');
      render();
    } catch (e) { setStatus('Feil: ' + e.message, true); }
  }

  const when = (s) => { const d = new Date(s); return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }); };

  function render() {
    if (!root || !data) return;
    const g = data.guilds.find((x) => x.id === selected);
    const body = $('#glBody', root);
    const motd = $('#glMotd', root);
    if (!g) { body.innerHTML = '<div class="empty">Ingen guild.</div>'; motd.hidden = true; return; }
    motd.hidden = !g.motd;
    motd.textContent = g.motd || '';
    const err = g.errors.length ? `<p class="muted small" style="padding:0 12px">Ikke tilgjengelig: ${esc(g.errors.join(' | '))}. Guild-endepunkter krever guilds-tillatelse og at rangen din har innsyn.</p>` : '';
    if (view === 'log') {
      body.innerHTML = err + `<table class="gl-log"><thead><tr><th>Tid</th><th>Type</th><th>Hva</th></tr></thead><tbody>${g.logRows.map((l) => `<tr><td class="muted">${when(l.time)}</td><td>${esc(l.type)}</td><td class="msg">${esc(l.text)}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">Ingen logg.</td></tr>'}</tbody></table>`;
    } else if (view === 'stash') {
      body.innerHTML = err + g.stashSummary.map((s) => `<div class="dy-card" style="margin:8px 12px"><h3>${esc(s.note || 'Lager')} <span class="muted small">${gold(s.coins)} · ${s.items.length}/${s.size} plasser</span></h3><div class="dy-list">${s.items.map((it) => `<span class="dy-item"><img src="${esc(it.icon)}" alt="" style="width:16px;height:16px;vertical-align:middle" /> ${esc(it.name)} ×${it.count}</span>`).join('') || '<span class="muted">Tomt</span>'}</div></div>`).join('') || '<div class="empty">Ingen lager-data.</div>';
    } else {
      body.innerHTML = err + `<table><thead><tr><th>Item</th><th class="num">Har</th><th class="num">Mangler</th><th>Til oppgradering</th></tr></thead><tbody>${g.treasuryRows.map((r) => `<tr><td class="name"><img src="${esc(r.icon)}" alt="" />${esc(r.name)}</td><td class="num">${r.count}</td><td class="num ${r.missing ? 'down' : 'up'}">${r.missing}</td><td class="small">${r.needed.map((n) => `${esc(n.upgrade)} (${n.count})`).join(', ')}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">Ingen treasury-behov.</td></tr>'}</tbody></table>`;
    }
  }

  Panel.register({ id: 'guild', title: 'Guild', icon: '🏰', mount, unmount });
})();
