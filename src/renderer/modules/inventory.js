'use strict';
// Inventory-modul (renderer): tabell med anbefalinger og AI-rådgiver.
(() => {
  const { $, esc, gold, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  const RARITY_ORDER = ['Junk', 'Basic', 'Fine', 'Masterwork', 'Rare', 'Exotic', 'Ascended', 'Legendary'];
  const state = { data: null, sort: { key: 'totalValue', dir: 'desc' }, chat: [], view: 'table', aiBusy: null };
  let root = null;
  let offProgress = null;

  const template = () => `
    <div class="toolbar">
      <div class="subtabs">
        <button class="subtab active" data-view="table">${t('inventory.table')}</button>
        <button class="subtab" data-view="ai">${t('inventory.ai')}</button>
      </div>
      <input id="invSearch" type="search" placeholder="${esc(t('inventory.search'))}" />
      <select id="invAction">
        <option value="">${t('inventory.allActions')}</option>
        <option value="tp">${t('rules.action.tp')}</option><option value="vendor">${t('rules.action.vendor')}</option><option value="salvage">${t('rules.action.salvage')}</option>
        <option value="deposit">${t('rules.action.deposit')}</option><option value="open">${t('rules.action.open')}</option><option value="use">${t('rules.action.use')}</option>
        <option value="keep">${t('rules.action.keep')}</option><option value="stored">${t('rules.action.stored')}</option>
        <option value="f:collection">${t('inventory.filter.collection')}</option><option value="f:skinLocked">${t('inventory.filter.skinLocked')}</option>
        <option value="f:unlockNew">${t('inventory.filter.unlockNew')}</option><option value="f:unlockDup">${t('inventory.filter.unlockDup')}</option>
      </select>
      <select id="invSource"><option value="">${t('inventory.allSources')}</option></select>
      <label class="inline"><input type="checkbox" id="invHideStored" checked /> ${t('inventory.hideStored')}</label>
      <div class="spacer"></div>
      <button id="invRefresh" class="primary">${t('common.refresh')}</button>
    </div>
    <div id="invView-table" class="view active">
      <div id="invSummary" class="summary"></div>
      <div class="table-wrap">
        <table id="invTable">
          <thead><tr>
            <th data-sort="name">${t('common.item')}</th><th data-sort="count" class="num">${t('common.count')}</th><th data-sort="rarity" class="col-c">${t('inventory.col.rarity')}</th>
            <th data-sort="source">${t('inventory.col.where')}</th><th data-sort="action">${t('inventory.col.action')}</th><th data-sort="unitValue" class="num col-b">${t('inventory.col.unit')}</th>
            <th data-sort="totalValue" class="num">${t('inventory.col.total')}</th><th data-sort="vendor" class="num col-a">${t('inventory.col.vendor')}</th>
            <th data-sort="tpList" class="num col-a">${t('inventory.col.tp')}</th><th data-sort="salvage" class="num col-a">${t('inventory.col.salvage')}</th><th class="col-b">${t('inventory.col.why')}</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div id="invView-ai" class="view">
      <div class="toolbar">
        <span id="aiModelInfo" class="muted"></span>
        <div class="spacer"></div>
        <button id="planBtn" class="primary">${t('inventory.makePlan')}</button>
      </div>
      <div id="plan" class="plan"></div>
      <div class="chat">
        <div id="chatLog" class="chat-log"></div>
        <form id="chatForm" class="chat-form">
          <input id="chatInput" type="text" placeholder="${esc(t('inventory.chatPlaceholder'))}" autocomplete="off" />
          <button type="submit" class="primary">${t('inventory.send')}</button>
        </form>
      </div>
    </div>`;

  function mount(el) {
    root = el;
    el.innerHTML = template();
    el.querySelectorAll('.subtab').forEach((b) => b.addEventListener('click', () => setView(b.dataset.view)));
    ['#invSearch', '#invAction', '#invSource', '#invHideStored'].forEach((s) => $(s, el).addEventListener('input', render));
    el.querySelectorAll('th[data-sort]').forEach((th) => th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (state.sort.key === key) state.sort.dir = state.sort.dir === 'asc' ? 'desc' : 'asc';
      else state.sort = { key, dir: ['name', 'rarity', 'action', 'source'].includes(key) ? 'asc' : 'desc' };
      render();
    }));
    $('#invRefresh', el).addEventListener('click', refresh);
    $('#planBtn', el).addEventListener('click', makePlan);
    $('#chatForm', el).addEventListener('submit', sendChat);
    offProgress = window.api.on('ai:progress', (p) => {
      const txt = p.content ? t('inventory.writing', { n: p.content }) : t('inventory.thinking', { n: p.reasoning });
      if (state.aiBusy === 'plan') $('#plan', root).innerHTML = `<p class="muted">${esc(txt)}</p>`;
      else if (state.aiBusy === 'chat') { const pe = $('#chatLog .pending', root); if (pe) pe.textContent = txt; }
    });
    updateModelInfo(Panel.config);
    Panel.onConfig(updateModelInfo);
    setView(state.view);
    render();
    renderChat(false);
    if (state.data) { fillSources(); }
    else if (Panel.config?.apiKey || Panel.config?.demo) refresh();
  }

  function unmount() { offProgress?.(); offProgress = null; root = null; }

  async function updateModelInfo(c) {
    if (!root || !c) return;
    let cur = null;
    try { cur = (await window.api.invoke('ai:providers')).current; } catch { /* faller tilbake til lokal */ }
    if (!root) return;
    if (!cur || cur.provider === 'local') $('#aiModelInfo', root).textContent = c.lmModel ? t('inventory.modelInfo', { model: c.lmModel, url: c.lmUrl }) : t('inventory.noModel');
    else $('#aiModelInfo', root).textContent = cur.hasKey ? t('inventory.modelInfoCloud', { model: cur.model, name: cur.name }) : t('inventory.noKey', { name: cur.name });
  }

  function setView(v) {
    state.view = v;
    root.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    root.querySelectorAll('.view').forEach((p) => p.classList.toggle('active', p.id === 'invView-' + v));
  }

  async function refresh() {
    const btn = $('#invRefresh', root);
    btn.disabled = true;
    setStatus(t('inventory.fetching'));
    try {
      state.data = await window.api.invoke('inv:refresh');
      if (!root) return; // brukeren byttet modul mens vi hentet
      const d = state.data;
      const coins = d.wallet?.find((w) => w.id === 1)?.value || 0;
      let msg = t('inventory.fetched', { account: d.account?.name || '', n: d.rows.length, gold: (coins / 10000).toFixed(2) });
      const cnt = (f) => d.rows.filter((r) => (r.flags || []).includes(f)).length;
      const facts = [];
      if (cnt('collection')) facts.push(t('inventory.factCollection', { n: cnt('collection') }));
      if (cnt('skinLocked')) facts.push(t('inventory.factSkin', { n: cnt('skinLocked') }));
      if (cnt('unlockNew')) facts.push(t('inventory.factUnlockNew', { n: cnt('unlockNew') }));
      if (cnt('unlockDup')) facts.push(t('inventory.factDup', { n: cnt('unlockDup') }));
      if (facts.length) msg += ' ' + facts.join(', ') + '.';
      if (d.errors?.length) msg += ' ' + t('inventory.warnings', { errors: d.errors.join(' | ') });
      setStatus(msg, !!d.errors?.length);
      fillSources();
      render();
    } catch (e) { setStatus(t('common.error', { message: e.message }), true); }
    finally { if (root) btn.disabled = false; }
  }

  function fillSources() {
    const sel = $('#invSource', root);
    const cur = sel.value;
    const sources = new Set();
    for (const r of state.data.rows) for (const l of r.locations) sources.add(l.source);
    sel.innerHTML = `<option value="">${esc(t('inventory.allSources'))}</option>` + [...sources].sort().map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
    sel.value = cur;
  }

  function visibleRows() {
    if (!state.data) return [];
    const q = $('#invSearch', root).value.trim().toLowerCase();
    const action = $('#invAction', root).value;
    const source = $('#invSource', root).value;
    const hideStored = $('#invHideStored', root).checked;
    return state.data.rows.filter((r) => {
      if (hideStored && r.action === 'stored') return false;
      if (action.startsWith('f:')) { if (!(r.flags || []).includes(action.slice(2))) return false; }
      else if (action && r.action !== action) return false;
      if (source && !r.locations.some((l) => l.source === source)) return false;
      if (q && !r.name.toLowerCase().includes(q)) return false;
      return true;
    });
  }

  function sortRows(rows) {
    const { key, dir } = state.sort;
    const mul = dir === 'asc' ? 1 : -1;
    const val = (r) => key === 'rarity' ? RARITY_ORDER.indexOf(r.rarity) : key === 'source' ? (r.locations[0]?.source || '') : r[key];
    return rows.sort((a, b) => { const x = val(a), y = val(b); return typeof x === 'string' ? x.localeCompare(y) * mul : ((x || 0) - (y || 0)) * mul; });
  }

  function render() {
    if (!root) return;
    const tbody = $('#invTable tbody', root);
    root.querySelectorAll('th[data-sort]').forEach((th) => {
      th.classList.toggle('sorted', th.dataset.sort === state.sort.key);
      th.classList.toggle('asc', th.dataset.sort === state.sort.key && state.sort.dir === 'asc');
    });
    if (!state.data) { tbody.innerHTML = `<tr><td colspan="11" class="empty">${esc(t('inventory.empty'))}</td></tr>`; $('#invSummary', root).innerHTML = ''; return; }
    const rows = sortRows(visibleRows());
    renderSummary();
    if (!rows.length) { tbody.innerHTML = `<tr><td colspan="11" class="empty">${esc(t('inventory.noMatch'))}</td></tr>`; return; }
    tbody.innerHTML = rows.map((r) => {
      const where = r.locations.map((l) => `${esc(l.source)} (${l.count})`).join(', ');
      const bind = r.binding ? `<span class="bind">${esc(t(r.binding === 'Account' ? 'inventory.boundAccount' : 'inventory.boundSoul'))}</span>` : '';
      const FLAG = { collection: ['📘', t('inventory.flag.collection', { names: (r.collections || []).filter((c) => !c.has).map((c) => c.name).join(', ') })], skinLocked: ['🎨', t('inventory.flag.skinLocked')], unlockNew: ['🔓', t('inventory.flag.unlockNew')], unlockDup: ['♻️', t('inventory.flag.unlockDup')], listed: ['🏷️', t('inventory.flag.listed')] };
      const flagHtml = (r.flags || []).map((f) => FLAG[f] ? `<span class="flag" title="${esc(FLAG[f][1])}">${FLAG[f][0]}</span>` : '').join('');
      return `<tr>
        <td class="name"><img src="${esc(r.icon)}" alt="" /><a href="#" data-wiki="${esc(r.name)}" class="r-${r.rarity}">${esc(r.name)}</a>${flagHtml}${bind}</td>
        <td class="num">${r.count}</td>
        <td class="r-${r.rarity} col-c">${r.rarity}${r.level ? ` <span class="bind">${esc(t('inventory.lvl', { n: r.level }))}</span>` : ''}</td>
        <td class="where">${where}</td>
        <td><span class="badge ${r.action}">${esc(r.label)}</span></td>
        <td class="num col-b">${gold(r.unitValue)}</td><td class="num">${gold(r.totalValue)}</td><td class="num col-a">${gold(r.vendor)}</td>
        <td class="num col-a" title="${esc(t('inventory.tpTitle', { c: Math.round(r.tpInstant) }))}">${gold(r.tpList)}</td>
        <td class="num col-a">${gold(r.salvage)}</td>
        <td class="why col-b" title="${esc(r.reason)}">${esc(r.reason)}</td>
      </tr>`;
    }).join('');
    tbody.querySelectorAll('a[data-wiki]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:wiki', a.dataset.wiki); }));
  }

  function renderSummary() {
    const totals = {};
    for (const r of state.data.rows) {
      if (r.action === 'stored') continue;
      totals[r.action] = totals[r.action] || { label: r.label, n: 0, v: 0 };
      totals[r.action].n += 1; totals[r.action].v += r.totalValue;
    }
    const cur = $('#invAction', root).value;
    const sum = $('#invSummary', root);
    sum.innerHTML = ['tp', 'vendor', 'salvage', 'deposit', 'open', 'use', 'keep'].filter((a) => totals[a]).map((a) => {
      const tot = totals[a];
      return `<span class="chip ${cur === a ? 'active' : ''}" data-action="${a}"><span class="dot" style="background:var(--${a})"></span>${esc(tot.label)}: ${tot.n}${tot.v ? ' · ' + gold(tot.v) : ''}</span>`;
    }).join('');
    sum.querySelectorAll('.chip').forEach((chip) => chip.addEventListener('click', () => {
      const a = chip.dataset.action;
      $('#invAction', root).value = $('#invAction', root).value === a ? '' : a;
      render();
    }));
  }

  async function makePlan() {
    const btn = $('#planBtn', root);
    btn.disabled = true; state.aiBusy = 'plan';
    $('#plan', root).innerHTML = `<p class="muted">${esc(t('inventory.sending'))}</p>`;
    try {
      const plan = await window.api.invoke('ai:prioritize');
      const steps = (plan.steg || []).sort((a, b) => a.prioritet - b.prioritet);
      if (!root) return;
      $('#plan', root).innerHTML = `
        <h4>${esc(t('inventory.planTitle'))}</h4>
        <p>${esc(plan.oppsummering)}</p>
        <ol>${steps.map((s) => `<li><b>${esc(s.hva)}</b> — ${esc(s.handling)}<br><span class="muted">${esc(s.hvorfor)}</span></li>`).join('')}</ol>
        ${(plan.advarsler || []).length ? '<p class="warn">' + plan.advarsler.map(esc).join('<br>') + '</p>' : ''}`;
    } catch (e) { if (root) $('#plan', root).innerHTML = `<p class="status error">${esc(t('common.error', { message: e.message }))}</p>`; }
    finally { state.aiBusy = null; if (root) btn.disabled = false; }
  }

  async function sendChat(e) {
    e.preventDefault();
    const input = $('#chatInput', root);
    const text = input.value.trim();
    if (!text) return;
    input.value = '';
    state.chat.push({ role: 'user', content: text });
    state.aiBusy = 'chat';
    renderChat(true);
    try { state.chat.push({ role: 'assistant', content: await window.api.invoke('ai:chat', state.chat) }); }
    catch (err) { state.chat.push({ role: 'assistant', content: t('common.error', { message: err.message }) }); }
    state.aiBusy = null;
    renderChat(false);
  }

  function renderChat(pending) {
    if (!root) return;
    const log = $('#chatLog', root);
    log.innerHTML = state.chat.map((m) => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('') + (pending ? `<div class="msg assistant pending">${esc(t('inventory.pending'))}</div>` : '');
    log.scrollTop = log.scrollHeight;
  }

  Panel.register({ id: 'inventory', title: () => T.t('module.inventory'), icon: '🎒', mount, unmount });
})();
