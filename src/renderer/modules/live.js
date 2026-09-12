'use strict';
// Live-modul (panel): status for ArcDPS-broen, oppsett av overlay-vinduene, og rotasjon + "hold oppe" per build.
(() => {
  const { $, esc, setStatus } = Panel;
  let root = null;
  let overlays = null;
  let snap = null;
  let bar = null;
  let steps = [];
  let upkeep = [];
  let editTab = null; // build-fane som redigeres (null = den aktive)
  let editSet = null; // våpensett som redigeres (null = det aktive fra broen)
  let offLive = null, offProgress = null;

  const TEMPLATE = `
    <div class="table-wrap"><div class="dy-grid">
      <section class="dy-card" id="lvBridge">
        <h3>ArcDPS-bro</h3>
        <div id="lvBridgeStatus" class="muted">Sjekker…</div>
        <div class="row" style="margin-top:6px"><button id="lvInstallBridge" class="primary">Installer broen i ArcDPS</button><button id="lvCheck">Sjekk på nytt</button></div>
        <p class="muted small">Broen er vår egen ArcDPS-utvidelse (gw2overlay_bridge.dll). Den ligger i spillmappa under addons\\arcdps og sender kamphendelser til overlayen. Krever ArcDPS. Start spillet på nytt etter installasjon.</p>
      </section>
      <section class="dy-card" id="lvWindows"></section>
      <section class="dy-card" id="lvSkillbar" style="grid-column: 1 / -1"></section>
    </div></div>`;

  const WIN = [['buffs', 'Buffs på deg'], ['debuffs', 'Conditions på deg'], ['target', 'Målet (boss)'], ['skillbar', 'Skill-bar']];

  async function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
    $('#lvInstallBridge', el).addEventListener('click', async () => {
      const b = $('#lvInstallBridge', root); b.disabled = true;
      try { const r = await window.api.invoke('arc:installBridge'); setStatus(`Broen er installert: ${r.target}. Start spillet på nytt.`); }
      catch (e) { setStatus('Feil: ' + e.message, true); }
      finally { if (root) { b.disabled = false; bridgeStatus(); } }
    });
    $('#lvCheck', el).addEventListener('click', bridgeStatus);
    offLive = window.api.on('live:state', (s) => { snap = s; liveLine(); });
    offProgress = window.api.on('ai:progress', (p) => { const el2 = root && $('#lvSuggestStatus', root); if (el2) el2.textContent = p.content ? `Skriver… (${p.content} tegn)` : `Modellen tenker… (${p.reasoning} tegn)`; });
    snap = await window.api.invoke('live:get').catch(() => null);
    overlays = await window.api.invoke('overlays:get');
    renderWindows();
    bridgeStatus();
    loadBar();
  }
  function unmount() { offLive?.(); offProgress?.(); offLive = offProgress = null; root = null; }

  async function bridgeStatus() {
    if (!root) return;
    try {
      const s = await window.api.invoke('arc:status');
      if (!root) return;
      const b = s.bridge || {};
      const parts = [];
      parts.push(s.installed ? 'ArcDPS: installert.' : 'ArcDPS: ikke installert (installer fra DPS-modulen).');
      parts.push(!b.available ? 'Bro: mangler i denne appen.' : b.installed ? (b.upToDate ? 'Bro: installert og oppdatert.' : 'Bro: installert, men eldre enn appens versjon.') : 'Bro: ikke installert.');
      $('#lvBridgeStatus', root).innerHTML = `<div>${esc(parts.join(' '))}</div><div id="lvLive"></div>`;
      $('#lvInstallBridge', root).textContent = b.installed ? (b.upToDate ? 'Installer broen på nytt' : 'Oppdater broen') : 'Installer broen i ArcDPS';
      liveLine();
    } catch (e) { $('#lvBridgeStatus', root).textContent = 'Feil: ' + e.message; }
  }
  function liveLine() {
    const el = root && $('#lvLive', root);
    if (!el) return;
    if (!snap?.connected) { el.innerHTML = '<span class="down">Ingen kontakt med broen.</span> <span class="muted">Spillet må kjøre med ArcDPS og broen lastet.</span>'; return; }
    el.innerHTML = `<span class="up">Live-data mottas</span> <span class="muted">(ArcDPS ${esc(snap.arcVersion)})</span> · ${snap.self ? esc(snap.self.name) : 'ukjent karakter'} · ${snap.inCombat ? 'i kamp' : 'utenfor kamp'} · ${snap.buffs.length} buffs · mål: ${snap.target ? esc(snap.target.name) + ' (' + snap.target.buffs.length + ')' : 'ingen'}`;
  }

  function renderWindows() {
    if (!root || !overlays) return;
    $('#lvWindows', root).innerHTML = '<h3>Overlay-vinduer</h3><p class="muted small">Ulåst vindu har stiplet ramme: dra for å flytte, strekk i kantene. Lås når det sitter riktig, da går klikk gjennom til spillet.</p>' + WIN.map(([id, label]) => {
      const c = overlays[id];
      const isSb = id === 'skillbar';
      return `<div class="lv-win" data-id="${id}">
        <div class="row"><label class="inline"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''} /> <b>${label}</b></label>
          <label class="inline"><input type="checkbox" data-k="locked" ${c.locked ? 'checked' : ''} /> Låst</label>
          <button data-reset="${id}" class="small">Nullstill posisjon</button></div>
        <div class="row lv-opts">
          <label class="inline">Ikon <input type="number" data-k="iconSize" value="${c.iconSize}" min="20" max="96" step="2" style="width:64px" /> px</label>
          <label class="inline">Tid <select data-k="mode"><option value="number" ${c.mode === 'number' ? 'selected' : ''}>Tall</option><option value="clock" ${c.mode === 'clock' ? 'selected' : ''}>Skygge</option><option value="both" ${c.mode === 'both' ? 'selected' : ''}>Begge</option></select></label>
          ${isSb ? `<label class="inline"><input type="checkbox" data-k="showNext" ${c.showNext ? 'checked' : ''} /> Marker neste i rotasjonen</label>
                    <label class="inline"><input type="checkbox" data-k="showCooldown" ${c.showCooldown ? 'checked' : ''} /> Vis cooldown</label>`
                 : `<label class="inline">Utseende <select data-k="layout"><option value="grid" ${c.layout === 'grid' ? 'selected' : ''}>Rutenett</option><option value="list" ${c.layout === 'list' ? 'selected' : ''}>Liste med navn</option></select></label>
                    <label class="inline">Sortering <select data-k="sort"><option value="timeAsc" ${c.sort === 'timeAsc' ? 'selected' : ''}>Minst tid først</option><option value="timeDesc" ${c.sort === 'timeDesc' ? 'selected' : ''}>Mest tid først</option><option value="stacks" ${c.sort === 'stacks' ? 'selected' : ''}>Flest stacks først</option><option value="name" ${c.sort === 'name' ? 'selected' : ''}>Navn</option></select></label>
                    <label class="inline">Innhold <select data-k="filter"><option value="boons" ${c.filter === 'boons' ? 'selected' : ''}>Boons</option><option value="conditions" ${c.filter === 'conditions' ? 'selected' : ''}>Conditions</option><option value="other" ${c.filter === 'other' ? 'selected' : ''}>Andre effekter</option><option value="all" ${c.filter === 'all' ? 'selected' : ''}>Alt</option></select></label>
                    <label class="inline">Retning <select data-k="direction"><option value="row" ${c.direction === 'row' ? 'selected' : ''}>Rad</option><option value="col" ${c.direction === 'col' ? 'selected' : ''}>Kolonne</option></select></label>
                    <label class="inline"><input type="checkbox" data-k="showNames" ${c.showNames ? 'checked' : ''} /> Navn i rutenett</label>`}
          <label class="inline">Gjennomsiktighet <input type="range" data-k="opacity" min="0.3" max="1" step="0.05" value="${c.opacity}" /></label>
        </div></div>`;
    }).join('');
    root.querySelectorAll('.lv-win').forEach((box) => {
      const id = box.dataset.id;
      box.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', async () => {
        const k = inp.dataset.k;
        const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' || inp.type === 'range' ? Number(inp.value) : inp.value;
        overlays[id] = await window.api.invoke('overlays:set', id, { [k]: v });
      }));
      box.querySelector('[data-reset]').addEventListener('click', async () => { overlays[id] = await window.api.invoke('overlays:set', id, { x: null, y: null }); setStatus('Posisjonen er nullstilt. Slå vinduet av og på for å flytte det til midten.'); });
    });
  }

  async function loadBar() {
    if (!root) return;
    const box = $('#lvSkillbar', root);
    box.innerHTML = '<h3>Skill-bar, rotasjon og hold-oppe</h3><p class="muted">Henter skills og builds for karakteren du spiller…</p>';
    try { bar = await window.api.invoke('skills:get', { ...(editTab != null ? { tab: editTab } : {}), ...(editSet ? { set: editSet } : {}) }); }
    catch (e) { bar = { ok: false, error: e.message }; }
    if (!root) return;
    if (!bar.ok) { box.innerHTML = `<h3>Skill-bar, rotasjon og hold-oppe</h3><p class="muted">${esc(bar.error)}</p><button id="lvReload">Prøv igjen</button>`; $('#lvReload', box).addEventListener('click', loadBar); return; }
    steps = bar.rotation.steps.slice();
    upkeep = bar.rotation.upkeep.slice();
    renderBar();
  }

  function renderBar() {
    const box = $('#lvSkillbar', root);
    const skillOpt = (sel) => bar.all.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.recharge ? ' (' + s.recharge + 's)' : ''}</option>`).join('');
    const boonOpt = (sel) => bar.boonNames.map((b) => `<option value="${b}" ${b === sel ? 'selected' : ''}>${b}</option>`).join('');
    const buildOpts = bar.builds.map((b) => `<option value="${b.tab}" ${b.tab === bar.tab ? 'selected' : ''}>${esc(b.name)}${b.active ? ' (aktiv i spillet)' : ''}</option>`).join('');
    box.innerHTML = `<h3>Skill-bar, rotasjon og hold-oppe</h3>
      <div class="row"><label class="inline">Build <select id="lvBuild">${buildOpts}</select></label>
        <label class="inline">Våpensett <select id="lvSet"><option value="A" ${bar.weaponSet === 'A' ? 'selected' : ''}>A: ${esc(bar.sets.A.types.join(' + ') || 'ingen')}</option>${bar.sets.B ? `<option value="B" ${bar.weaponSet === 'B' ? 'selected' : ''}>B: ${esc(bar.sets.B.types.join(' + '))}</option>` : ''}</select></label>
        <span class="muted small">${esc(bar.character)} · ${esc(bar.professionName)}${bar.specName ? ' (' + esc(bar.specName) + ')' : ''}. Skill-baren følger aktiv build og bytter sett automatisk når du bytter våpen. Rotasjon og hold-oppe lagres per build og våpenkombinasjon.</span></div>
      <div class="lv-icons">${bar.all.map((s) => `<img src="${esc(s.icon)}" title="${esc(s.name)}${s.buffs?.length ? ' · gir ' + esc(s.buffs.join(', ')) : ''}" alt="" />`).join('')}</div>
      <h4>Rotasjon</h4>
      <ol id="lvRot" class="lv-rot">${steps.map((r, i) => `<li><select data-i="${i}">${skillOpt(r.skill)}</select><input type="text" data-note="${i}" value="${esc(r.note || '')}" placeholder="merknad" /><button data-up="${i}" class="small">▲</button><button data-del="${i}" class="small">✕</button></li>`).join('')}</ol>
      <div class="row"><button id="lvAdd">Legg til steg</button><button id="lvSuggest">Foreslå rotasjon med AI</button><span id="lvSuggestStatus" class="muted"></span></div>
      <div id="lvExplain" class="muted small"></div>
      <h4>Hold oppe</h4>
      <p class="muted small">Når boonen mangler på deg og skillet er klart, blinker skillet rødt i skill-baren. «Foreslå» fyller inn ut fra hvilke boons skillene gir ifølge API-et.</p>
      <ul id="lvUp" class="lv-rot">${upkeep.map((u, i) => `<li><select data-ui="${i}">${skillOpt(u.skill)}</select><span class="muted">holder oppe</span><select data-ub="${i}">${boonOpt(u.boon)}</select><button data-udel="${i}" class="small">✕</button></li>`).join('')}</ul>
      <div class="row"><button id="lvUpAdd">Legg til</button><button id="lvUpSuggest">Foreslå fra skillene</button><button id="lvSave" class="primary">Lagre for denne builden</button><button id="lvReload2">Hent på nytt</button></div>`;
    $('#lvBuild', box).addEventListener('change', (e) => { editTab = Number(e.target.value); loadBar(); });
    $('#lvSet', box).addEventListener('change', (e) => { editSet = e.target.value; loadBar(); });
    box.querySelectorAll('select[data-i]').forEach((s) => s.addEventListener('change', () => { steps[Number(s.dataset.i)].skill = Number(s.value); }));
    box.querySelectorAll('input[data-note]').forEach((s) => s.addEventListener('input', () => { steps[Number(s.dataset.note)].note = s.value; }));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { steps.splice(Number(b.dataset.del), 1); renderBar(); }));
    box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.up); if (i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; renderBar(); } }));
    box.querySelectorAll('select[data-ui]').forEach((s) => s.addEventListener('change', () => { upkeep[Number(s.dataset.ui)].skill = Number(s.value); }));
    box.querySelectorAll('select[data-ub]').forEach((s) => s.addEventListener('change', () => { upkeep[Number(s.dataset.ub)].boon = s.value; }));
    box.querySelectorAll('[data-udel]').forEach((b) => b.addEventListener('click', () => { upkeep.splice(Number(b.dataset.udel), 1); renderBar(); }));
    $('#lvAdd', box).addEventListener('click', () => { steps.push({ skill: bar.all[0]?.id, note: '' }); renderBar(); });
    $('#lvUpAdd', box).addEventListener('click', () => { upkeep.push({ skill: bar.all[0]?.id, boon: 'Might' }); renderBar(); });
    $('#lvUpSuggest', box).addEventListener('click', () => {
      const existing = new Set(upkeep.map((u) => u.skill + '|' + u.boon));
      for (const s of bar.upkeepSuggestions) for (const boon of s.boons) if (!existing.has(s.skill + '|' + boon)) upkeep.push({ skill: s.skill, boon });
      if (!bar.upkeepSuggestions.length) setStatus('Ingen av skillene gir boons ifølge API-et.');
      renderBar();
    });
    $('#lvReload2', box).addEventListener('click', loadBar);
    $('#lvSave', box).addEventListener('click', async () => { await window.api.invoke('skills:setRotation', bar.key, { steps, upkeep }); setStatus(`Lagret for «${bar.buildName}» og sendt til skill-baren.`); });
    $('#lvSuggest', box).addEventListener('click', async () => {
      const b = $('#lvSuggest', box); b.disabled = true; $('#lvSuggestStatus', box).textContent = 'Sender til modellen…';
      try { const r = await window.api.invoke('skills:suggest', bar.key); steps = r.rotasjon; renderBar(); $('#lvExplain', $('#lvSkillbar', root)).textContent = r.forklaring || ''; }
      catch (e) { setStatus('AI-forslag feilet: ' + e.message, true); }
      finally { if (root) { const b2 = $('#lvSuggest', root); if (b2) b2.disabled = false; const st = $('#lvSuggestStatus', root); if (st) st.textContent = ''; } }
    });
  }

  Panel.register({ id: 'live', title: 'Live', icon: '⚡', mount, unmount });
})();
