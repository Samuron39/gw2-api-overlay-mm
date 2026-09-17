'use strict';
// Karakter-modul (renderer): utstyr per karakter, mangler og AI-vurdering.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let data = null;
  const reviews = new Map();
  let offProgress = null;
  const jobs = new Map();

  const template = () => `
    <div class="toolbar">
      <span id="chInfo" class="muted"></span>
      <div class="spacer"></div>
      <button id="chRefresh" class="primary">${esc(t('common.refresh'))}</button>
    </div>
    <div class="table-wrap"><div id="chList"></div></div>`;

  async function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    $('#chRefresh', el).addEventListener('click', () => refresh(true));
    offProgress = scope.on('ai:progress', (p) => {
      const name = [...jobs].find(([, job]) => job.id === p.requestId)?.[0];
      if (!name || !root) return;
      const box = root.querySelector(`.ch-card[data-name="${CSS.escape(name)}"] .ch-review`);
      if (box) box.textContent = p.content ? t('common.writing', { n: p.content }) : t('common.thinking', { n: p.reasoning });
    });
    await refresh(false);
  }
  function unmount() { life.clear(); offProgress?.(); offProgress = null; root = null; }

  async function refresh(force) {
    const valid = scope.request('refresh');
    if (!Panel.config?.apiKey) { setStatus(t('common.noApiKey'), true); return; }
    setStatus(t('characters.fetching'));
    try {
      const result = await window.api.invoke('chars:get', !!force);
      if (!valid()) return;
      data = result;
      setStatus(T.tn('characters.fetched', data.characters.length));
      render();
    } catch (e) { if (valid()) setStatus(t('common.error', { message: e.message }), true); }
  }

  const age = (s) => t('characters.hours', { n: Math.floor(s / 3600) });

  function render() {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root || !data) return;
    $('#chInfo', root).textContent = t('characters.hint');
    $('#chList', root).innerHTML = data.characters.map((c) => `
      <div class="ch-card" data-name="${esc(c.name)}">
        <div class="ch-head">
          <h3 class="prof-${esc(c.profession)}">${esc(c.name)}</h3>
          <span class="muted">${esc(c.race)} ${esc(c.profession)} · ${esc(t('inventory.lvl', { n: c.level }))} · ${esc(age(c.age))} · ${esc(t('characters.deaths', { n: c.deaths }))}</span>
          <span class="spacer"></span>
          ${c.issues.length ? `<span class="badge vendor">${esc(t('characters.findings', { n: c.issues.length }))}</span>` : `<span class="badge tp">${esc(t('characters.ok'))}</span>`}
        </div>
        <div class="ch-body">
          ${c.crafting.length ? `<p class="muted small">${esc(t('characters.crafting', { list: c.crafting.map((x) => `${x.discipline} ${x.rating}${x.active ? '' : ' ' + t('characters.inactive')}`).join(', ') }))}</p>` : ''}
          ${c.issues.length ? `<ul class="ch-issues">${c.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          <table class="ch-eq"><thead><tr><th>${esc(t('characters.col.slot'))}</th><th>${esc(t('common.item'))}</th><th>${esc(t('characters.col.stat'))}</th><th>${esc(t('characters.col.upgrades'))}</th><th>${esc(t('characters.col.infusions'))}</th></tr></thead>
          <tbody>${c.equipment.map((e) => `<tr><td class="muted">${esc(e.slot)}</td><td class="name"><img src="${esc(e.icon || '')}" alt="" /><span class="r-${esc(e.rarity)}">${esc(e.name)}</span></td><td title="${esc((e.statAttributes || []).join(' + '))}">${esc(e.stat)}</td><td class="small" title="${esc((e.upgradeInfo || []).map((u) => u.name + (u.effect ? ': ' + u.effect : '')).join(' | '))}">${esc(e.upgrades.join(', '))}</td><td class="small" title="${esc((e.infusionInfo || []).map((u) => u.name + (u.effect ? ': ' + u.effect : '')).join(' | '))}">${esc(e.infusions.join(', '))}</td></tr>`).join('')}</tbody></table>
          <div class="row" style="margin-top:8px"><button class="primary ch-reviewBtn" data-name="${esc(c.name)}" ${jobs.has(c.name) ? 'disabled' : ''}>${esc(t('characters.review'))}</button><button class="ch-cancel" data-name="${esc(c.name)}" ${jobs.has(c.name) ? '' : 'hidden'}>${esc(t('common.cancel'))}</button></div>
          <div class="ch-review" ${reviews.has(c.name) || jobs.has(c.name) ? '' : 'hidden'}>${esc(jobs.has(c.name) ? t('common.sendingToModel') : reviews.get(c.name) || '')}</div>
        </div>
      </div>`).join('') || `<div class="empty">${esc(t('characters.empty'))}</div>`;
    root.querySelectorAll('.ch-head').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
    root.querySelectorAll('.ch-cancel').forEach((b) => b.addEventListener('click', () => { const job = jobs.get(b.dataset.name); if (!job) return; job.cancelled = true; jobs.delete(b.dataset.name); window.api.invoke('ai:cancel', job.id).catch(() => {}); reviews.set(b.dataset.name, t('common.cancelled')); renderReview(b.dataset.name); }));
    root.querySelectorAll('.ch-reviewBtn').forEach((b) => b.addEventListener('click', async () => {
      const name = b.dataset.name;
      if (jobs.has(name)) return;
      const job = { id: Panel.requestId('character') }; jobs.set(name, job); renderReview(name);
      try { const txt = await window.api.invoke('chars:review', name, { requestId: job.id }); if (!job.cancelled && jobs.get(name) === job) reviews.set(name, txt); }
      catch (e) { if (!job.cancelled && jobs.get(name) === job) reviews.set(name, t('common.error', { message: e.message })); }
      finally { if (jobs.get(name) === job) jobs.delete(name); renderReview(name); }
    }));
  }

  function renderReview(name) {
    if (!root) return;
    const card = root.querySelector(`.ch-card[data-name="${CSS.escape(name)}"]`);
    if (!card) return;
    const box = $('.ch-review', card), pending = jobs.has(name);
    box.hidden = false; box.textContent = pending ? t('common.sendingToModel') : reviews.get(name) || '';
    $('.ch-reviewBtn', card).disabled = pending;
    $('.ch-cancel', card).hidden = !pending;
  }

  Panel.register({ id: 'characters', title: () => T.t('module.characters'), icon: '🧙', mount, unmount });
})();
