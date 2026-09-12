'use strict';
// Trading Post-modul (renderer)
(() => {
  const { $, esc, gold, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  let data = null;
  let view = 'sells';

  const template = () => `
    <div class="toolbar">
      <div class="subtabs">
        <button class="subtab ${view === 'sells' ? 'active' : ''}" data-view="sells">${esc(t('tp.sells'))}</button>
        <button class="subtab ${view === 'buys' ? 'active' : ''}" data-view="buys">${esc(t('tp.buys'))}</button>
        <button class="subtab ${view === 'history' ? 'active' : ''}" data-view="history">${esc(t('tp.history'))}</button>
      </div>
      <div class="spacer"></div>
      <button id="tpRefresh" class="primary">${esc(t('common.refresh'))}</button>
    </div>
    <div id="tpBox" class="tp-box"></div>
    <div class="table-wrap"><table id="tpTable"><thead></thead><tbody></tbody></table></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = template();
    el.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => { view = b.dataset.view; el.querySelectorAll('.subtab').forEach((x) => x.classList.toggle('active', x === b)); render(); }));
    $('#tpRefresh', el).addEventListener('click', () => refresh(true));
    await refresh(false);
  }
  function unmount() { root = null; }

  async function refresh(force) {
    if (!Panel.config?.apiKey) { setStatus(t('common.noApiKey'), true); return; }
    setStatus(t('tp.fetching'));
    try {
      data = await window.api.invoke('tp:get', !!force);
      if (!root) return;
      setStatus(data.errors?.length ? t('common.partial', { errors: data.errors.join(' | ') }) : t('common.updatedAt', { time: new Date(data.fetchedAt).toLocaleTimeString(T.locale) }), !!data.errors?.length);
      render();
    } catch (e) { setStatus(t('common.error', { message: e.message }), true); }
  }

  const when = (s) => { const d = new Date(s); return d.toLocaleDateString(T.locale, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' }); };
  const nameCell = (r) => `<td class="name"><img src="${esc(r.icon)}" alt="" /><a href="#" data-wiki="${esc(r.name)}">${esc(r.name)}</a></td>`;

  function render() {
    if (!root || !data) return;
    const s = data.summary;
    $('#tpBox', root).innerHTML = `
      <div class="tp-stat">${esc(t('tp.delivery'))}<b>${gold(data.delivery.coins)}${data.delivery.items.length ? ' ' + esc(t('tp.plusItems', { n: data.delivery.items.length })) : ''}</b>${data.delivery.coins || data.delivery.items.length ? `<span class="muted small">${esc(t('tp.pickup'))}</span>` : ''}</div>
      <div class="tp-stat">${esc(t('tp.listed'))}<b>${gold(s.listedValue)}</b><span class="muted small">${esc(t('tp.ordersNet', { n: data.sells.length }))}</span></div>
      <div class="tp-stat">${esc(t('tp.inBuyOrders'))}<b>${gold(s.buyOrders)}</b><span class="muted small">${esc(t('tp.orders', { n: data.buys.length }))}</span></div>
      <div class="tp-stat">${esc(t('tp.sold'))}<b>${gold(s.sold7)} / ${gold(s.sold30)}</b></div>
      <div class="tp-stat">${esc(t('tp.bought'))}<b>${gold(s.bought7)} / ${gold(s.bought30)}</b></div>`;
    const thead = $('#tpTable thead', root), tbody = $('#tpTable tbody', root);
    const th = (k, cls = '') => `<th${cls ? ` class="${cls}"` : ''}>${esc(t(k))}</th>`;
    if (view === 'sells') {
      thead.innerHTML = `<tr>${th('common.item')}${th('common.count', 'num')}${th('tp.col.minPrice', 'num')}${th('tp.col.lowestNow', 'num')}${th('tp.col.net', 'num')}${th('tp.col.advice')}${th('tp.col.listedAt')}</tr>`;
      tbody.innerHTML = data.sells.map((r) => `<tr>${nameCell(r)}<td class="num">${r.quantity}</td><td class="num">${gold(r.price)}</td><td class="num">${gold(r.lowest)}</td><td class="num">${gold(r.net)}</td><td class="${r.underbid ? 'down' : 'muted'}">${esc(r.advice)}</td><td class="muted">${when(r.created)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">${esc(t('tp.noSells'))}</td></tr>`;
    } else if (view === 'buys') {
      thead.innerHTML = `<tr>${th('common.item')}${th('common.count', 'num')}${th('tp.col.myBid', 'num')}${th('tp.col.highestNow', 'num')}${th('tp.col.lowestSell', 'num')}${th('tp.col.advice')}${th('tp.col.placed')}</tr>`;
      tbody.innerHTML = data.buys.map((r) => `<tr>${nameCell(r)}<td class="num">${r.quantity}</td><td class="num">${gold(r.price)}</td><td class="num">${gold(r.highest)}</td><td class="num">${gold(r.lowestSell)}</td><td class="${r.overbid ? 'down' : 'muted'}">${esc(r.advice)}</td><td class="muted">${when(r.created)}</td></tr>`).join('') || `<tr><td colspan="7" class="empty">${esc(t('tp.noBuys'))}</td></tr>`;
    } else {
      thead.innerHTML = `<tr>${th('common.item')}${th('tp.col.type')}${th('common.count', 'num')}${th('tp.col.price', 'num')}${th('tp.col.net', 'num')}${th('tp.col.time')}</tr>`;
      tbody.innerHTML = data.history.map((r) => `<tr>${nameCell(r)}<td class="${r.kind === 'sell' ? 'up' : 'down'}">${esc(t(r.kind === 'sell' ? 'tp.soldKind' : 'tp.boughtKind'))}</td><td class="num">${r.quantity}</td><td class="num">${gold(r.price)}</td><td class="num ${r.net >= 0 ? 'up' : 'down'}">${gold(r.net)}</td><td class="muted">${when(r.purchased || r.created)}</td></tr>`).join('') || `<tr><td colspan="6" class="empty">${esc(t('tp.noHistory'))}</td></tr>`;
    }
    tbody.querySelectorAll('a[data-wiki]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:wiki', a.dataset.wiki); }));
  }

  Panel.register({ id: 'tp', title: () => T.t('module.tp'), icon: '💰', mount, unmount });
})();
