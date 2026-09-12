'use strict';
// Karakter-modul (renderer): utstyr per karakter, mangler og AI-vurdering.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  let data = null;
  const reviews = new Map();
  let offProgress = null;
  let busy = null;

  const template = () => `
    <div class="toolbar">
      <span id="chInfo" class="muted"></span>
      <div class="spacer"></div>
      <button id="chRefresh" class="primary">${esc(t('common.refresh'))}</button>
    </div>
    <div class="table-wrap"><div id="chList"></div></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = template();
    $('#chRefresh', el).addEventListener('click', () => refresh(true));
    offProgress = window.api.on('ai:progress', (p) => {
      if (!busy || !root) return;
      const box = root.querySelector(`.ch-card[data-name="${CSS.escape(busy)}"] .ch-review`);
      if (box) box.textContent = p.content ? t('common.writing', { n: p.content }) : t('common.thinking', { n: p.reasoning });
    });
    await refresh(false);
  }
  function unmount() { offProgress?.(); offProgress = null; root = null; }

  async function refresh(force) {
    if (!Panel.config?.apiKey) { setStatus(t('common.noApiKey'), true); return; }
    setStatus(t('characters.fetching'));
    try {
      data = await window.api.invoke('chars:get', !!force);
      if (!root) return;
      setStatus(T.tn('characters.fetched', data.characters.length));
      render();
    } catch (e) { setStatus(t('common.error', { message: e.message }), true); }
  }

  const age = (s) => t('characters.hours', { n: Math.floor(s / 3600) });

  function render() {
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
          <div class="row" style="margin-top:8px"><button class="primary ch-reviewBtn" data-name="${esc(c.name)}">${esc(t('characters.review'))}</button></div>
          <div class="ch-review" ${reviews.has(c.name) ? '' : 'hidden'}>${esc(reviews.get(c.name) || '')}</div>
        </div>
      </div>`).join('') || `<div class="empty">${esc(t('characters.empty'))}</div>`;
    root.querySelectorAll('.ch-head').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
    root.querySelectorAll('.ch-reviewBtn').forEach((b) => b.addEventListener('click', async () => {
      const name = b.dataset.name;
      const box = b.closest('.ch-body').querySelector('.ch-review');
      box.hidden = false; box.textContent = t('common.sendingToModel'); b.disabled = true; busy = name;
      try { const txt = await window.api.invoke('chars:review', name); reviews.set(name, txt); if (root) box.textContent = txt; }
      catch (e) { if (root) box.textContent = t('common.error', { message: e.message }); }
      finally { busy = null; if (root) b.disabled = false; }
    }));
  }

  Panel.register({ id: 'characters', title: () => T.t('module.characters'), icon: '🧙', mount, unmount });
})();
