'use strict';
// Live-modul (panel): status for ArcDPS-broen, oppsett av overlay-vinduene, og rotasjon + "hold oppe" per build.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  let overlays = null;
  let snap = null;
  let bar = null;
  let steps = [];
  let upkeep = [];
  let editTab = null; // build-fane som redigeres (null = den aktive)
  let editSet = null; // våpensett som redigeres (null = det aktive fra broen)
  let offLive = null, offProgress = null;

  const template = () => `
    <div class="table-wrap"><div class="dy-grid">
      <section class="dy-card" id="lvBridge">
        <h3>${esc(t('live.bridge'))}</h3>
        <div id="lvBridgeStatus" class="muted">${esc(t('live.checking'))}</div>
        <div class="row" style="margin-top:6px"><button id="lvInstallBridge" class="primary">${esc(t('live.installBridge'))}</button><button id="lvCheck">${esc(t('live.recheck'))}</button><button id="lvRecord" title="${esc(t('live.recordHelp'))}">${esc(t('live.record'))}</button></div>
        <p class="muted small">${esc(t('live.bridgeHelp'))}</p>
        <p class="muted small">${esc(t('live.healingHelp'))} <a href="#" id="lvHealingLink">${esc(t('live.healingLink'))}</a></p>
      </section>
      <section class="dy-card" id="lvWindows"></section>
      <section class="dy-card" id="lvSkillbar" style="grid-column: 1 / -1"></section>
    </div></div>`;

  const WIN = ['buffs', 'debuffs', 'target', 'skillbar', 'dps'];

  async function mount(el) {
    root = el;
    el.innerHTML = template();
    $('#lvInstallBridge', el).addEventListener('click', async () => {
      const b = $('#lvInstallBridge', root); b.disabled = true;
      try { const r = await window.api.invoke('arc:installBridge'); setStatus(t('live.bridgeInstalled', { target: r.target })); }
      catch (e) { setStatus(t('common.error', { message: e.message }), true); }
      finally { if (root) { b.disabled = false; bridgeStatus(); } }
    });
    $('#lvCheck', el).addEventListener('click', bridgeStatus);
    // Healing stats-utvidelsen (valgfri, gir squad-healing): lenke til GitHub-siden med nedlasting
    $('#lvHealingLink', el).addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:url', 'https://github.com/Krappa322/arcdps_healing_stats'); });
    $('#lvRecord', el).addEventListener('click', async () => {
      try { const r = await window.api.invoke('live:record', 180000); setStatus(t('live.recording', { file: r.file })); }
      catch (e) { setStatus(t('common.error', { message: e.message }), true); }
    });
    offLive = window.api.on('live:state', (s) => { snap = s; liveLine(); });
    offProgress = window.api.on('ai:progress', (p) => { const el2 = root && $('#lvSuggestStatus', root); if (el2) el2.textContent = p.content ? t('common.writing', { n: p.content }) : t('common.thinking', { n: p.reasoning }); });
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
      parts.push(t(s.installed ? 'live.arcInstalled' : 'live.arcMissing'));
      parts.push(t(!b.available ? 'live.bridgeUnavailable' : b.installed ? (b.upToDate ? 'live.bridgeUpToDate' : 'live.bridgeOld') : 'live.bridgeMissing'));
      $('#lvBridgeStatus', root).innerHTML = `<div>${esc(parts.join(' '))}</div><div id="lvLive"></div>`;
      $('#lvInstallBridge', root).textContent = t(b.installed ? (b.upToDate ? 'live.reinstallBridge' : 'live.updateBridge') : 'live.installBridge');
      liveLine();
    } catch (e) { $('#lvBridgeStatus', root).textContent = t('common.error', { message: e.message }); }
  }
  function liveLine() {
    const el = root && $('#lvLive', root);
    if (!el) return;
    if (!snap?.connected) { el.innerHTML = `<span class="down">${esc(t('live.noContact'))}</span> <span class="muted">${esc(t('live.noContactHint'))}</span>`; return; }
    const target = snap.target ? esc(snap.target.name) + ' (' + snap.target.buffs.length + ')' : esc(t('live.noTarget'));
    el.innerHTML = `<span class="up">${esc(t('live.receiving'))}</span> <span class="muted">(ArcDPS ${esc(snap.arcVersion)})</span> · ${snap.self ? esc(snap.self.name) : esc(t('live.unknownChar'))} · ${esc(t(snap.inCombat ? 'live.inCombat' : 'live.outOfCombat'))} · ${esc(t('live.buffs', { n: snap.buffs.length }))} · ${t('live.target', { name: target })}${snap.stats ? ` · <span class="muted" title="${esc(t('live.statsTitle'))}">${esc(t('live.stats', { packets: snap.stats.packets, events: snap.stats.events, drops: snap.stats.dropsDetected }))}${snap.stats.areaLagMs != null ? ' · ' + esc(t('live.lag', { s: (snap.stats.areaLagMs / 1000).toFixed(1) })) : ''}</span>` : ''}${snap.recording ? ` · <span class="down">${esc(t('live.recordingShort', { s: Math.max(0, Math.round((snap.recording.until - Date.now()) / 1000)) }))}</span>` : ''}${healingLine()}`;
  }
  // Healing: om broen sender heal-linjer (egen healing, HPS) og om healing stats-utvidelsen er funnet i spillet (squad-healing)
  function healingLine() {
    const h = snap?.dps?.healing;
    if (!h) return '';
    return ` · <span class="${h.supported ? 'up' : 'down'}">${esc(t(h.supported ? 'live.healingBridgeOk' : 'live.healingBridgeOld'))}</span> · <span class="muted">${esc(t(h.ext ? 'live.healingFound' : 'live.healingMissing'))}</span>`;
  }

  function renderWindows() {
    if (!root || !overlays) return;
    const opt = (k, val, cur, label) => `<option value="${val}" ${cur === val ? 'selected' : ''}>${esc(t(label))}</option>`;
    $('#lvWindows', root).innerHTML = `<h3>${esc(t('live.windows'))}</h3><p class="muted small">${esc(t('live.windowsHelp'))}</p>` + WIN.map((id) => {
      const c = overlays[id];
      const isSb = id === 'skillbar';
      const isDps = id === 'dps';
      return `<div class="lv-win" data-id="${id}">
        <div class="row"><label class="inline"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''} /> <b>${esc(t('live.win.' + id))}</b></label>
          <label class="inline"><input type="checkbox" data-k="locked" ${c.locked ? 'checked' : ''} /> ${esc(t('live.locked'))}</label>
          <button data-reset="${id}" class="small">${esc(t('live.resetPos'))}</button></div>
        <div class="row lv-opts">
          ${isDps ? `<label class="inline">${esc(t('live.fontSize'))} <input type="number" data-k="fontSize" value="${c.fontSize ?? 14}" min="10" max="40" step="1" style="width:64px" /> px</label>
                    <label class="inline">${esc(t('live.showSkills'))} <input type="number" data-k="showSkills" value="${c.showSkills ?? 3}" min="0" max="8" step="1" style="width:56px" /></label>
                    <label class="inline"><input type="checkbox" data-k="showTaken" ${c.showTaken !== false ? 'checked' : ''} /> ${esc(t('live.showTaken'))}</label>
                    <label class="inline">${esc(t('live.takenRows'))} <input type="number" data-k="takenRows" value="${c.takenRows ?? 3}" min="0" max="5" step="1" style="width:56px" /></label>
                    <label class="inline"><input type="checkbox" data-k="showLast" ${c.showLast !== false ? 'checked' : ''} /> ${esc(t('live.showLast'))}</label>
                    <label class="inline"><input type="checkbox" data-k="showSquad" ${c.showSquad !== false ? 'checked' : ''} /> ${esc(t('live.showSquad'))}</label>
                    <label class="inline">${esc(t('live.squadRows'))} <input type="number" data-k="squadRows" value="${c.squadRows ?? 5}" min="1" max="10" step="1" style="width:56px" /></label>
                    <label class="inline"><input type="checkbox" data-k="showHealing" ${c.showHealing !== false ? 'checked' : ''} /> ${esc(t('live.showHealing'))}</label>`
          : `<label class="inline">${esc(t('live.icon'))} <input type="number" data-k="iconSize" value="${c.iconSize}" min="20" max="96" step="2" style="width:64px" /> px</label>
          <label class="inline">${esc(t('live.time'))} <select data-k="mode">${opt('mode', 'number', c.mode, 'live.number')}${opt('mode', 'clock', c.mode, 'live.shade')}${opt('mode', 'both', c.mode, 'live.both')}</select></label>`}
          ${isDps ? '' : isSb ? `<label class="inline"><input type="checkbox" data-k="showNext" ${c.showNext ? 'checked' : ''} /> ${esc(t('live.showNext'))}</label>
                    <label class="inline"><input type="checkbox" data-k="showCooldown" ${c.showCooldown ? 'checked' : ''} /> ${esc(t('live.showCooldown'))}</label>
                    <label class="inline" title="${esc(t('live.delayHelp'))}">${esc(t('live.delay'))} <input type="number" data-k="delayMs" value="${c.delayMs ?? 3000}" min="0" max="10000" step="250" style="width:72px" /> ms</label>`
                 : `<label class="inline">${esc(t('live.layout'))} <select data-k="layout">${opt('layout', 'grid', c.layout, 'live.grid')}${opt('layout', 'list', c.layout, 'live.list')}</select></label>
                    <label class="inline">${esc(t('live.sort'))} <select data-k="sort">${opt('sort', 'timeAsc', c.sort, 'live.timeAsc')}${opt('sort', 'timeDesc', c.sort, 'live.timeDesc')}${opt('sort', 'stacks', c.sort, 'live.stacks')}${opt('sort', 'name', c.sort, 'live.name')}</select></label>
                    <label class="inline">${esc(t('live.content'))} <select data-k="filter">${opt('filter', 'boons', c.filter, 'live.boons')}${opt('filter', 'conditions', c.filter, 'live.conditions')}${opt('filter', 'other', c.filter, 'live.other')}${opt('filter', 'all', c.filter, 'live.all')}</select></label>
                    <label class="inline">${esc(t('live.direction'))} <select data-k="direction">${opt('direction', 'row', c.direction, 'live.row')}${opt('direction', 'col', c.direction, 'live.col')}</select></label>
                    <label class="inline"><input type="checkbox" data-k="showNames" ${c.showNames ? 'checked' : ''} /> ${esc(t('live.showNames'))}</label>
                    <label class="inline"><input type="checkbox" data-k="showIcons" ${c.showIcons !== false ? 'checked' : ''} /> ${esc(t('live.showIcons'))}</label>`}
          <label class="inline">${esc(t('live.opacity'))} <input type="range" data-k="opacity" min="0.3" max="1" step="0.05" value="${c.opacity}" /></label>
        </div></div>`;
    }).join('');
    root.querySelectorAll('.lv-win').forEach((box) => {
      const id = box.dataset.id;
      box.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', async () => {
        const k = inp.dataset.k;
        const v = inp.type === 'checkbox' ? inp.checked : inp.type === 'number' || inp.type === 'range' ? Number(inp.value) : inp.value;
        overlays[id] = await window.api.invoke('overlays:set', id, { [k]: v });
      }));
      box.querySelector('[data-reset]').addEventListener('click', async () => { overlays[id] = await window.api.invoke('overlays:set', id, { x: null, y: null }); setStatus(t('live.posReset')); });
    });
  }

  async function loadBar() {
    if (!root) return;
    const box = $('#lvSkillbar', root);
    box.innerHTML = `<h3>${esc(t('live.skillbarTitle'))}</h3><p class="muted">${esc(t('live.loadingBar'))}</p>`;
    try { bar = await window.api.invoke('skills:get', { ...(editTab != null ? { tab: editTab } : {}), ...(editSet ? { set: editSet } : {}) }); }
    catch (e) { bar = { ok: false, error: e.message }; }
    if (!root) return;
    if (!bar.ok) { box.innerHTML = `<h3>${esc(t('live.skillbarTitle'))}</h3><p class="muted">${esc(bar.error)}</p><button id="lvReload">${esc(t('live.retry'))}</button>`; $('#lvReload', box).addEventListener('click', loadBar); return; }
    steps = bar.rotation.steps.slice();
    upkeep = bar.rotation.upkeep.slice();
    renderBar();
  }

  function renderBar() {
    const box = $('#lvSkillbar', root);
    const skillOpt = (sel) => bar.all.map((s) => `<option value="${s.id}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.recharge ? ' (' + s.recharge + 's)' : ''}</option>`).join('');
    const boonOpt = (sel) => bar.boonNames.map((b) => `<option value="${b}" ${b === sel ? 'selected' : ''}>${b}</option>`).join('');
    const buildOpts = bar.builds.map((b) => `<option value="${b.tab}" ${b.tab === bar.tab ? 'selected' : ''}>${esc(b.name)}${b.active ? ' ' + esc(t('live.activeInGame')) : ''}</option>`).join('');
    box.innerHTML = `<h3>${esc(t('live.skillbarTitle'))}</h3>
      <div class="row"><label class="inline">${esc(t('live.build'))} <select id="lvBuild">${buildOpts}</select></label>
        <label class="inline">${esc(t('live.weaponSet'))} <select id="lvSet"><option value="A" ${bar.weaponSet === 'A' ? 'selected' : ''}>A: ${esc(bar.sets.A.types.join(' + ') || t('live.noWeapon'))}</option>${bar.sets.B ? `<option value="B" ${bar.weaponSet === 'B' ? 'selected' : ''}>B: ${esc(bar.sets.B.types.join(' + '))}</option>` : ''}</select></label>
        <span class="muted small">${esc(bar.character)} · ${esc(bar.professionName)}${bar.specName ? ' (' + esc(bar.specName) + ')' : ''}. ${esc(t('live.barHelp'))}</span></div>
      <div class="lv-icons">${bar.all.map((s) => `<img src="${esc(s.icon)}" title="${esc(s.name)}${s.buffs?.length ? ' · ' + esc(t('live.gives', { buffs: s.buffs.join(', ') })) : ''}" alt="" />`).join('')}</div>
      <h4>${esc(t('live.rotation'))}</h4>
      <ol id="lvRot" class="lv-rot">${steps.map((r, i) => `<li><select data-i="${i}">${skillOpt(r.skill)}</select><input type="text" data-note="${i}" value="${esc(r.note || '')}" placeholder="${esc(t('live.notePlaceholder'))}" /><button data-up="${i}" class="small">▲</button><button data-del="${i}" class="small">✕</button></li>`).join('')}</ol>
      <div class="row"><button id="lvAdd">${esc(t('live.addStep'))}</button><button id="lvSuggest">${esc(t('live.suggestAi'))}</button><span id="lvSuggestStatus" class="muted"></span></div>
      <div id="lvExplain" class="muted small"></div>
      <h4>${esc(t('live.upkeep'))}</h4>
      <p class="muted small">${esc(t('live.upkeepHelp'))}</p>
      <ul id="lvUp" class="lv-rot">${upkeep.map((u, i) => `<li><select data-ui="${i}">${skillOpt(u.skill)}</select><span class="muted">${esc(t('live.keepsUp'))}</span><select data-ub="${i}">${boonOpt(u.boon)}</select><button data-udel="${i}" class="small">✕</button></li>`).join('')}</ul>
      <div class="row"><button id="lvUpAdd">${esc(t('live.add'))}</button><button id="lvUpSuggest">${esc(t('live.suggestFromSkills'))}</button><button id="lvSave" class="primary">${esc(t('live.saveBuild'))}</button><button id="lvReload2">${esc(t('live.reload'))}</button></div>`;
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
      if (!bar.upkeepSuggestions.length) setStatus(t('live.noBoonSkills'));
      renderBar();
    });
    $('#lvReload2', box).addEventListener('click', loadBar);
    $('#lvSave', box).addEventListener('click', async () => { await window.api.invoke('skills:setRotation', bar.key, { steps, upkeep }); setStatus(t('live.saved', { build: bar.buildName })); });
    $('#lvSuggest', box).addEventListener('click', async () => {
      const b = $('#lvSuggest', box); b.disabled = true; $('#lvSuggestStatus', box).textContent = t('common.sendingToModel');
      try { const r = await window.api.invoke('skills:suggest', bar.key); steps = r.rotasjon; renderBar(); $('#lvExplain', $('#lvSkillbar', root)).textContent = r.forklaring || ''; }
      catch (e) { setStatus(t('live.suggestFailed', { message: e.message }), true); }
      finally { if (root) { const b2 = $('#lvSuggest', root); if (b2) b2.disabled = false; const st = $('#lvSuggestStatus', root); if (st) st.textContent = ''; } }
    });
  }

  Panel.register({ id: 'live', title: () => T.t('module.live'), icon: '⚡', mount, unmount });
})();
