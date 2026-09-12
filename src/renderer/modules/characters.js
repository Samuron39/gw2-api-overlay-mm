'use strict';
// Karakter-modul (renderer): utstyr per karakter, mangler og AI-vurdering.
(() => {
  const { $, esc, setStatus } = Panel;
  let root = null;
  let data = null;
  const reviews = new Map();
  let offProgress = null;
  let busy = null;

  const TEMPLATE = `
    <div class="toolbar">
      <span id="chInfo" class="muted"></span>
      <div class="spacer"></div>
      <button id="chRefresh" class="primary">Oppdater</button>
    </div>
    <div class="table-wrap"><div id="chList"></div></div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
    $('#chRefresh', el).addEventListener('click', () => refresh(true));
    offProgress = window.api.on('ai:progress', (p) => {
      if (!busy || !root) return;
      const box = root.querySelector(`.ch-card[data-name="${CSS.escape(busy)}"] .ch-review`);
      if (box) box.textContent = p.content ? `Skriver… (${p.content} tegn)` : `Modellen tenker… (${p.reasoning} tegn)`;
    });
    await refresh(false);
  }
  function unmount() { offProgress?.(); offProgress = null; root = null; }

  async function refresh(force) {
    if (!Panel.config?.apiKey) { setStatus('Legg inn API-nøkkel under Innstillinger.', true); return; }
    setStatus('Henter karakterer…');
    try {
      data = await window.api.invoke('chars:get', !!force);
      if (!root) return;
      setStatus(`${data.characters.length} karakterer hentet.`);
      render();
    } catch (e) { setStatus('Feil: ' + e.message, true); }
  }

  const age = (s) => `${Math.floor(s / 3600)} timer`;

  function render() {
    if (!root || !data) return;
    $('#chInfo', root).textContent = 'Klikk på en karakter for utstyr. Vurdering bruker den lokale AI-modellen og siste ArcDPS-logg hvis den finnes.';
    $('#chList', root).innerHTML = data.characters.map((c) => `
      <div class="ch-card" data-name="${esc(c.name)}">
        <div class="ch-head">
          <h3 class="prof-${esc(c.profession)}">${esc(c.name)}</h3>
          <span class="muted">${esc(c.race)} ${esc(c.profession)} · lvl ${c.level} · ${age(c.age)} · ${c.deaths} dødsfall</span>
          <span class="spacer"></span>
          ${c.issues.length ? `<span class="badge vendor">${c.issues.length} funn</span>` : '<span class="badge tp">ok</span>'}
        </div>
        <div class="ch-body">
          ${c.crafting.length ? `<p class="muted small">Crafting: ${c.crafting.map((x) => `${esc(x.discipline)} ${x.rating}${x.active ? '' : ' (inaktiv)'}`).join(', ')}</p>` : ''}
          ${c.issues.length ? `<ul class="ch-issues">${c.issues.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : ''}
          <table class="ch-eq"><thead><tr><th>Slot</th><th>Item</th><th>Stat</th><th>Oppgraderinger</th><th>Infusions</th></tr></thead>
          <tbody>${c.equipment.map((e) => `<tr><td class="muted">${esc(e.slot)}</td><td class="name"><img src="${esc(e.icon || '')}" alt="" /><span class="r-${esc(e.rarity)}">${esc(e.name)}</span></td><td>${esc(e.stat)}</td><td class="small">${esc(e.upgrades.join(', '))}</td><td class="small">${esc(e.infusions.join(', '))}</td></tr>`).join('')}</tbody></table>
          <div class="row" style="margin-top:8px"><button class="primary ch-reviewBtn" data-name="${esc(c.name)}">Vurder utstyret med AI</button></div>
          <div class="ch-review" ${reviews.has(c.name) ? '' : 'hidden'}>${esc(reviews.get(c.name) || '')}</div>
        </div>
      </div>`).join('') || '<div class="empty">Ingen karakterer.</div>';
    root.querySelectorAll('.ch-head').forEach((h) => h.addEventListener('click', () => h.parentElement.classList.toggle('open')));
    root.querySelectorAll('.ch-reviewBtn').forEach((b) => b.addEventListener('click', async () => {
      const name = b.dataset.name;
      const box = b.closest('.ch-body').querySelector('.ch-review');
      box.hidden = false; box.textContent = 'Sender til modellen…'; b.disabled = true; busy = name;
      try { const txt = await window.api.invoke('chars:review', name); reviews.set(name, txt); if (root) box.textContent = txt; }
      catch (e) { if (root) box.textContent = 'Feil: ' + e.message; }
      finally { busy = null; if (root) b.disabled = false; }
    }));
  }

  Panel.register({ id: 'characters', title: 'Karakterer', icon: '🧙', mount, unmount });
})();
