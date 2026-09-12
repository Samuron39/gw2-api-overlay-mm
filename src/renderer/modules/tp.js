'use strict';
// Trading Post-modul (renderer)
(() => {
  const { $, esc, gold, setStatus } = Panel;
  let root = null;
  let data = null;
  let view = 'sells';

  const TEMPLATE = `
    <div class="toolbar">
      <div class="subtabs">
        <button class="subtab active" data-view="sells">Salg ute</button>
        <button class="subtab" data-view="buys">Kjøpsordrer</button>
        <button class="subtab" data-view="history">Historikk</button>
      </div>
      <div class="spacer"></div>
      <button id="tpRefresh" class="primary">Oppdater</button>
    </div>
    <div id="tpBox" class="tp-box"></div>
    <div class="table-wrap"><table id="tpTable"><thead></thead><tbody></tbody></table></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
    el.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; el.querySelectorAll('.subtab').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
    $('#tpRefresh', el).addEventListener('click', () => refresh(true));
    await refresh(false);
  }
  function unmount() { root = null; }

  async function refresh(force) {
    if (!Panel.config?.apiKey) { setStatus('Legg inn API-nøkkel under Innstillinger.', true); return; }
    setStatus('Henter Trading Post…');
    try {
      data = await window.api.invoke('tp:get', !!force);
      if (!root) return;
      setStatus(data.errors?.length ? 'Delvis hentet: ' + data.errors.join(' | ') : `Oppdatert ${new Date(data.fetchedAt).toLocaleTimeString('nb-NO')}`, !!data.errors?.length);
      render();
    } catch (e) { setStatus('Feil: ' + e.message, true); }
  }

  const when = (s) => { const d = new Date(s); return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }); };
  const nameCell = (r) => `<td class="name"><img src="${esc(r.icon)}" alt="" /><a href="#" data-wiki="${esc(r.name)}">${esc(r.name)}</a></td>`;

  function render() {
    if (!root || !data) return;
    const s = data.summary;
    $('#tpBox', root).innerHTML = `
      <div class="tp-stat">Leveringsboks<b>${gold(data.delivery.coins)}${data.delivery.items.length ? ' + ' + data.delivery.items.length + ' items' : ''}</b>${data.delivery.coins || data.delivery.items.length ? '<span class="muted small">Hent hos TP-handleren</span>' : ''}</div>
      <div class="tp-stat">Ute for salg<b>${gold(s.listedValue)}</b><span class="muted small">${data.sells.length} ordrer, netto</span></div>
      <div class="tp-stat">I kjøpsordrer<b>${gold(s.buyOrders)}</b><span class="muted small">${data.buys.length} ordrer</span></div>
      <div class="tp-stat">Solgt 7 / 30 dager<b>${gold(s.sold7)} / ${gold(s.sold30)}</b></div>
      <div class="tp-stat">Kjøpt 7 / 30 dager<b>${gold(s.bought7)} / ${gold(s.bought30)}</b></div>`;
    const thead = $('#tpTable thead', root), tbody = $('#tpTable tbody', root);
    if (view === 'sells') {
      thead.innerHTML = '<tr><th>Item</th><th class="num">Ant.</th><th class="num">Min pris</th><th class="num">Laveste nå</th><th class="num">Netto</th><th>Råd</th><th>Lagt ut</th></tr>';
      tbody.innerHTML = data.sells.map((r) => `<tr>${nameCell(r)}<td class="num">${r.quantity}</td><td class="num">${gold(r.price)}</td><td class="num">${gold(r.lowest)}</td><td class="num">${gold(r.net)}</td><td class="${r.advice.startsWith('Underbudt') ? 'down' : 'muted'}">${esc(r.advice)}</td><td class="muted">${when(r.created)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Ingen salg ute.</td></tr>';
    } else if (view === 'buys') {
      thead.innerHTML = '<tr><th>Item</th><th class="num">Ant.</th><th class="num">Mitt bud</th><th class="num">Høyeste nå</th><th class="num">Laveste salg</th><th>Råd</th><th>Lagt inn</th></tr>';
      tbody.innerHTML = data.buys.map((r) => `<tr>${nameCell(r)}<td class="num">${r.quantity}</td><td class="num">${gold(r.price)}</td><td class="num">${gold(r.highest)}</td><td class="num">${gold(r.lowestSell)}</td><td class="${r.advice.startsWith('Overbudt') ? 'down' : 'muted'}">${esc(r.advice)}</td><td class="muted">${when(r.created)}</td></tr>`).join('') || '<tr><td colspan="7" class="empty">Ingen kjøpsordrer.</td></tr>';
    } else {
      thead.innerHTML = '<tr><th>Item</th><th>Type</th><th class="num">Ant.</th><th class="num">Pris</th><th class="num">Netto</th><th>Tid</th></tr>';
      tbody.innerHTML = data.history.map((r) => `<tr>${nameCell(r)}<td class="${r.kind === 'sell' ? 'up' : 'down'}">${r.kind === 'sell' ? 'Solgt' : 'Kjøpt'}</td><td class="num">${r.quantity}</td><td class="num">${gold(r.price)}</td><td class="num ${r.net >= 0 ? 'up' : 'down'}">${gold(r.net)}</td><td class="muted">${when(r.purchased || r.created)}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">Ingen historikk.</td></tr>';
    }
    tbody.querySelectorAll('a[data-wiki]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:wiki', a.dataset.wiki); }));
  }

  Panel.register({ id: 'tp', title: 'Trading Post', icon: '💰', mount, unmount });
})();
