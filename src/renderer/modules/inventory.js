'use strict';
// Inventory-modul (renderer): tabell med anbefalinger og AI-rådgiver.
(() => {
  const { $, esc, gold, setStatus } = Panel;
  const RARITY_ORDER = ['Junk', 'Basic', 'Fine', 'Masterwork', 'Rare', 'Exotic', 'Ascended', 'Legendary'];
  const state = { data: null, sort: { key: 'totalValue', dir: 'desc' }, chat: [], view: 'table', aiBusy: null };
  let root = null;
  let offProgress = null;

  const TEMPLATE = `
    <div class="toolbar">
      <div class="subtabs">
        <button class="subtab active" data-view="table">Tabell</button>
        <button class="subtab" data-view="ai">AI-rådgiver</button>
      </div>
      <input id="invSearch" type="search" placeholder="Søk item…" />
      <select id="invAction">
        <option value="">Alle anbefalinger</option>
        <option value="tp">Selg på TP</option><option value="vendor">Selg til vendor</option><option value="salvage">Salvage</option>
        <option value="deposit">Deposit</option><option value="open">Åpne</option><option value="use">Bruk</option>
        <option value="keep">Behold</option><option value="stored">I lager</option>
        <option value="f:collection">Mangler i samling</option><option value="f:skinLocked">Skinn ikke låst opp</option>
        <option value="f:unlockNew">Opplåsning du mangler</option><option value="f:unlockDup">Duplikat-opplåsning</option>
      </select>
      <select id="invSource"><option value="">Alle kilder</option></select>
      <label class="inline"><input type="checkbox" id="invHideStored" checked /> Skjul materiallager</label>
      <div class="spacer"></div>
      <button id="invRefresh" class="primary">Oppdater</button>
    </div>
    <div id="invView-table" class="view active">
      <div id="invSummary" class="summary"></div>
      <div class="table-wrap">
        <table id="invTable">
          <thead><tr>
            <th data-sort="name">Item</th><th data-sort="count" class="num">Ant.</th><th data-sort="rarity" class="col-c">Rarity</th>
            <th data-sort="source">Hvor</th><th data-sort="action">Anbefaling</th><th data-sort="unitValue" class="num col-b">Per stk</th>
            <th data-sort="totalValue" class="num">Totalt</th><th data-sort="vendor" class="num col-a">Vendor</th>
            <th data-sort="tpList" class="num col-a">TP</th><th data-sort="salvage" class="num col-a">Salvage est.</th><th class="col-b">Hvorfor</th>
          </tr></thead>
          <tbody></tbody>
        </table>
      </div>
    </div>
    <div id="invView-ai" class="view">
      <div class="toolbar">
        <span id="aiModelInfo" class="muted"></span>
        <div class="spacer"></div>
        <button id="planBtn" class="primary">Lag oppryddingsplan</button>
      </div>
      <div id="plan" class="plan"></div>
      <div class="chat">
        <div id="chatLog" class="chat-log"></div>
        <form id="chatForm" class="chat-form">
          <input id="chatInput" type="text" placeholder="Spør om inventoryet ditt, f.eks. hva gjør jeg med alle Mystic Coins?" autocomplete="off" />
          <button type="submit" class="primary">Send</button>
        </form>
      </div>
    </div>`;

  function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
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
      const txt = p.content ? `Skriver svar… (${p.content} tegn)` : `Modellen tenker… (${p.reasoning} tegn resonnering)`;
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

  function updateModelInfo(c) {
    if (!root || !c) return;
    $('#aiModelInfo', root).textContent = c.lmModel ? `Modell: ${c.lmModel} via ${c.lmUrl}` : 'Ingen modell valgt. Velg under Innstillinger.';
  }

  function setView(v) {
    state.view = v;
    root.querySelectorAll('.subtab').forEach((b) => b.classList.toggle('active', b.dataset.view === v));
    root.querySelectorAll('.view').forEach((p) => p.classList.toggle('active', p.id === 'invView-' + v));
  }

  async function refresh() {
    const btn = $('#invRefresh', root);
    btn.disabled = true;
    setStatus('Henter fra GW2 API…');
    try {
      state.data = await window.api.invoke('inv:refresh');
      if (!root) return; // brukeren byttet modul mens vi hentet
      const d = state.data;
      const coins = d.wallet?.find((w) => w.id === 1)?.value || 0;
      let msg = `${d.account?.name || ''}: ${d.rows.length} ulike items hentet. Gull: ${(coins / 10000).toFixed(2)}g.`;
      const cnt = (f) => d.rows.filter((r) => (r.flags || []).includes(f)).length;
      const facts = [];
      if (cnt('collection')) facts.push(`${cnt('collection')} mangler i samlinger`);
      if (cnt('skinLocked')) facts.push(`${cnt('skinLocked')} skinn ikke låst opp`);
      if (cnt('unlockNew')) facts.push(`${cnt('unlockNew')} opplåsninger du mangler`);
      if (cnt('unlockDup')) facts.push(`${cnt('unlockDup')} duplikater`);
      if (facts.length) msg += ' ' + facts.join(', ') + '.';
      if (d.errors?.length) msg += ' Advarsler: ' + d.errors.join(' | ');
      setStatus(msg, !!d.errors?.length);
      fillSources();
      render();
    } catch (e) { setStatus('Feil: ' + e.message, true); }
    finally { if (root) btn.disabled = false; }
  }

  function fillSources() {
    const sel = $('#invSource', root);
    const cur = sel.value;
    const sources = new Set();
    for (const r of state.data.rows) for (const l of r.locations) sources.add(l.source);
    sel.innerHTML = '<option value="">Alle kilder</option>' + [...sources].sort().map((s) => `<option value="${esc(s)}">${esc(s)}</option>`).join('');
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
    if (!state.data) { tbody.innerHTML = '<tr><td colspan="11" class="empty">Legg inn API-nøkkel under Innstillinger og trykk Oppdater.</td></tr>'; $('#invSummary', root).innerHTML = ''; return; }
    const rows = sortRows(visibleRows());
    renderSummary();
    if (!rows.length) { tbody.innerHTML = '<tr><td colspan="11" class="empty">Ingen items matcher filteret.</td></tr>'; return; }
    tbody.innerHTML = rows.map((r) => {
      const where = r.locations.map((l) => `${esc(l.source)} (${l.count})`).join(', ');
      const bind = r.binding ? `<span class="bind">${r.binding === 'Account' ? 'konto' : 'sjel'}-bundet</span>` : '';
      const FLAG = { collection: ['📘', 'Mangler i samling: ' + (r.collections || []).filter((c) => !c.has).map((c) => c.name).join(', ')], skinLocked: ['🎨', 'Skinnet er ikke låst opp'], unlockNew: ['🔓', 'Opplåsning du mangler'], unlockDup: ['♻️', 'Du har allerede denne opplåsningen'], listed: ['🏷️', 'Du har allerede dette ute for salg på TP'] };
      const flagHtml = (r.flags || []).map((f) => FLAG[f] ? `<span class="flag" title="${esc(FLAG[f][1])}">${FLAG[f][0]}</span>` : '').join('');
      return `<tr>
        <td class="name"><img src="${esc(r.icon)}" alt="" /><a href="#" data-wiki="${esc(r.name)}" class="r-${r.rarity}">${esc(r.name)}</a>${flagHtml}${bind}</td>
        <td class="num">${r.count}</td>
        <td class="r-${r.rarity} col-c">${r.rarity}${r.level ? ` <span class="bind">lvl ${r.level}</span>` : ''}</td>
        <td class="where">${where}</td>
        <td><span class="badge ${r.action}">${esc(r.label)}</span></td>
        <td class="num col-b">${gold(r.unitValue)}</td><td class="num">${gold(r.totalValue)}</td><td class="num col-a">${gold(r.vendor)}</td>
        <td class="num col-a" title="Netto etter 15 % avgift. Instant-salg: ${Math.round(r.tpInstant)}c">${gold(r.tpList)}</td>
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
      const t = totals[a];
      return `<span class="chip ${cur === a ? 'active' : ''}" data-action="${a}"><span class="dot" style="background:var(--${a})"></span>${esc(t.label)}: ${t.n}${t.v ? ' · ' + gold(t.v) : ''}</span>`;
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
    $('#plan', root).innerHTML = '<p class="muted">Sender inventory til modellen…</p>';
    try {
      const plan = await window.api.invoke('ai:prioritize');
      const steps = (plan.steg || []).sort((a, b) => a.prioritet - b.prioritet);
      if (!root) return;
      $('#plan', root).innerHTML = `
        <h4>Oppryddingsplan</h4>
        <p>${esc(plan.oppsummering)}</p>
        <ol>${steps.map((s) => `<li><b>${esc(s.hva)}</b> — ${esc(s.handling)}<br><span class="muted">${esc(s.hvorfor)}</span></li>`).join('')}</ol>
        ${(plan.advarsler || []).length ? '<p class="warn">' + plan.advarsler.map(esc).join('<br>') + '</p>' : ''}`;
    } catch (e) { if (root) $('#plan', root).innerHTML = `<p class="status error">Feil: ${esc(e.message)}</p>`; }
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
    catch (err) { state.chat.push({ role: 'assistant', content: 'Feil: ' + err.message }); }
    state.aiBusy = null;
    renderChat(false);
  }

  function renderChat(pending) {
    if (!root) return;
    const log = $('#chatLog', root);
    log.innerHTML = state.chat.map((m) => `<div class="msg ${m.role}">${esc(m.content)}</div>`).join('') + (pending ? '<div class="msg assistant pending">Tenker…</div>' : '');
    log.scrollTop = log.scrollHeight;
  }

  Panel.register({ id: 'inventory', title: 'Inventory', icon: '🎒', mount, unmount });
})();
