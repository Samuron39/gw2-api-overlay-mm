'use strict';
// Live-modul (panel): status for ArcDPS-broen, oppsett av overlay-vinduene, og rotasjon + "hold oppe" per build.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let overlays = null;
  let snap = null;
  let bar = null;
  let steps = [];
  let upkeep = [];
  let editTab = null; // build-fane som redigeres (null = den aktive)
  let editSet = null; // våpensett som redigeres (null = det aktive fra broen)
  let offLive = null, offProgress = null;
  let arcInfo = null; // siste arc:status, for å skille «spillet kjører ikke» fra «ingen kontakt»
  const drafts = new Map();
  const copy = (rows) => rows.map((r) => ({ ...r }));
  function edited() { const d = drafts.get(bar.key); d.steps = steps; d.upkeep = upkeep; d.revision++; }

  const template = () => `
    <div class="table-wrap"><div class="dy-grid">
      <section class="dy-card" id="lvBridge">
        <h3>${esc(t('live.bridge'))}</h3>
        <div id="lvBridgeStatus" class="muted">${esc(t('live.checking'))}</div>
        <div class="row" style="margin-top:6px"><button id="lvInstallBridge" class="primary">${esc(t('live.installBridge'))}</button><button id="lvCheck">${esc(t('live.recheck'))}</button><button id="lvRecord" title="${esc(t('live.recordHelp'))}">${esc(t('live.record'))}</button></div>
        <div class="act-note" id="lvBridgeNote" role="status"></div>
        <p class="muted small">${esc(t('live.bridgeHelp'))}</p>
        <p class="muted small">${esc(t('live.healingHelp'))} <a href="#" id="lvHealingLink">${esc(t('live.healingLink'))}</a></p>
      </section>
      <section class="dy-card" id="lvWindows"></section>
      <section class="dy-card" id="lvSkillbar" style="grid-column: 1 / -1"></section>
    </div></div>`;

  const WIN = ['buffs', 'debuffs', 'target', 'skillbar', 'dps', 'dps2', 'dps3'];

  async function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    // Kvitteringen står rett under knappen (ikke bare i statuslinja øverst): arbeider, ferdig, allerede oppdatert eller feil
    $('#lvInstallBridge', el).addEventListener('click', async () => {
      const r = await Panel.busy($('#lvInstallBridge', root), () => window.api.invoke('arc:installBridge'), {
        note: $('#lvBridgeNote', root), flash: $('#lvBridge', root), owner: mounted, working: t('live.bridgeInstalling'),
        done: (v) => (v.changed === false ? { kind: 'info', text: t('live.bridgeUnchanged') } : { kind: 'ok', text: t('live.bridgeDone') }),
      });
      if (r.ok) setStatus(t('live.bridgeInstalled', { target: r.value.target }));
      if (mounted.valid()) bridgeStatus();
    });
    $('#lvCheck', el).addEventListener('click', bridgeStatus);
    // Healing stats-utvidelsen (valgfri, gir squad-healing): lenke til GitHub-siden med nedlasting
    $('#lvHealingLink', el).addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:url', 'https://github.com/Krappa322/arcdps_healing_stats'); });
    $('#lvRecord', el).addEventListener('click', () => Panel.busy($('#lvRecord', root), () => window.api.invoke('live:record', 180000), {
      note: $('#lvBridgeNote', root), owner: mounted, working: t('live.recordStarting'), done: (v) => t('live.recording', { file: v.file }),
    }));
    offLive = scope.on('live:state', (s) => { snap = s; liveLine(); });
    // Uten kontakt: se etter med jevne mellomrom om spillet er startet, så «venter på spillet» ikke blir stående feil
    scope.interval(() => { if (!snap?.connected) bridgeStatus(); }, 15000);
    offProgress = scope.on('ai:progress', (p) => { const job = bar && drafts.get(bar.key)?.job; const el2 = job?.id === p.requestId && root && $('#lvSuggestStatus', root); if (el2) el2.textContent = p.content ? t('common.writing', { n: p.content }) : t('common.thinking', { n: p.reasoning }); });
    const initial = await window.api.invoke('live:get').catch(() => null);
    if (!mounted.valid()) return;
    snap = initial;
    const settings = await window.api.invoke('overlays:get');
    if (!mounted.valid()) return;
    overlays = settings;
    renderWindows();
    bridgeStatus();
    loadBar();
  }
  function unmount() { life.clear(); offLive?.(); offProgress?.(); offLive = offProgress = null; root = null; }

  async function bridgeStatus() {
    if (!root) return;
    const valid = scope.request('bridge');
    try {
      const s = await window.api.invoke('arc:status');
      if (!valid()) return;
      arcInfo = s;
      const b = s.bridge || {};
      const parts = [];
      parts.push(t(s.installed ? 'live.arcInstalled' : 'live.arcMissing'));
      parts.push(t(!b.available ? 'live.bridgeUnavailable' : b.installed ? (b.upToDate ? 'live.bridgeUpToDate' : 'live.bridgeOld') : 'live.bridgeMissing'));
      const warn = s.removedExternally ? `<div class="act-warn">${esc(t('arc.removedExternally'))}</div>` : '';
      $('#lvBridgeStatus', root).innerHTML = `<div>${esc(parts.join(' '))}</div>${warn}<div id="lvLive"></div>`;
      $('#lvInstallBridge', root).textContent = t(b.installed ? (b.upToDate ? 'live.reinstallBridge' : 'live.updateBridge') : 'live.installBridge');
      liveLine();
    } catch (e) { if (valid()) $('#lvBridgeStatus', root).textContent = t('common.error', { message: e.message }); }
  }
  function liveLine() {
    const el = root && $('#lvLive', root);
    if (!el) return;
    if (!snap?.connected) {
      // Spillet kjører ikke: det er ingen feil, bare ingenting å motta ennå. Rød tekst fikk det til å se ut som installasjonen feilet.
      if (arcInfo && arcInfo.running === false) el.innerHTML = `<span class="wait">${esc(t('live.waitingGame'))}</span> <span class="muted">${esc(t('live.waitingGameHint'))}</span>`;
      else el.innerHTML = `<span class="down">${esc(t('live.noContact'))}</span> <span class="muted">${esc(t('live.noContactHint'))}</span>`;
      return;
    }
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
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root || !overlays) return;
    const opt = (k, val, cur, label) => `<option value="${esc(val)}" ${cur === val ? 'selected' : ''}>${esc(t(label))}</option>`;
    // Ett felt: etikett over kontrollen, så det er lett å se hva som hører til hva
    const fld = (label, control, title) => `<div class="fld" ${title ? `title="${esc(title)}"` : ''}><span class="fl">${esc(label)}</span>${control}</div>`;
    const sel = (k, cur, opts) => `<select data-k="${k}">${opts.map(([v, l]) => opt(k, v, cur, l)).join('')}</select>`;
    const num = (k, val, min, max, step, unit) => `<span class="num"><input type="number" data-k="${k}" value="${esc(val)}" min="${min}" max="${max}" step="${step}" />${unit ? `<span class="unit">${unit}</span>` : ''}</span>`;
    const chk = (k, on, label, title) => `<label class="chip ${on ? 'on' : ''}" ${title ? `title="${esc(title)}"` : ''}><input type="checkbox" data-k="${k}" ${on ? 'checked' : ''} /> ${esc(label)}</label>`;
    const group = (title, inner) => `<div class="lv-group"><div class="lv-gt">${esc(title)}</div>${inner}</div>`;
    $('#lvWindows', root).innerHTML = `<h3>${esc(t('live.windows'))}</h3><p class="muted small">${esc(t('live.windowsHelp'))}</p>` + WIN.map((id) => {
      const c = overlays[id];
      const isSb = id === 'skillbar';
      const isDps = id.startsWith('dps');
      let body;
      if (isDps) {
        body = group(t('live.group.content'), `<div class="lv-fields">
            ${fld(t('live.view'), sel('view', c.view || 'all', [['all', 'live.view.all'], ['damage', 'live.view.damage'], ['squad', 'live.view.squad'], ['taken', 'live.view.taken'], ['healing', 'live.view.healing']]))}
            ${fld(t('live.period'), sel('period', c.period || 'fight', [['fight', 'live.period.fight'], ['last', 'live.period.last'], ['session', 'live.period.session']]))}
            ${fld(t('live.showSkills'), num('showSkills', c.showSkills ?? 3, 0, 8, 1))}
            ${fld(t('live.takenRows'), num('takenRows', c.takenRows ?? 3, 0, 5, 1))}
            ${fld(t('live.squadRows'), num('squadRows', c.squadRows ?? 5, 1, 10, 1))}
          </div><div class="lv-checks">
            ${chk('showTaken', c.showTaken !== false, t('live.showTaken'))}
            ${chk('showSquad', c.showSquad !== false, t('live.showSquad'))}
            ${chk('showHealing', c.showHealing !== false, t('live.showHealing'))}
            ${chk('showLast', c.showLast !== false, t('live.showLast'))}
          </div>`)
          + group(t('live.group.look'), `<div class="lv-fields">
            ${fld(t('live.fontSize'), num('fontSize', c.fontSize ?? 14, 10, 40, 1, 'px'))}
            ${fld(t('live.opacity'), `<input type="range" data-k="opacity" min="0.3" max="1" step="0.05" value="${c.opacity}" />`)}
          </div>`);
      } else if (isSb) {
        body = group(t('live.group.content'), `<div class="lv-checks">
            ${chk('showNext', c.showNext, t('live.showNext'))}
            ${chk('showCooldown', c.showCooldown, t('live.showCooldown'))}
          </div><div class="lv-fields">
            ${fld(t('live.delay'), num('delayMs', c.delayMs ?? 3000, 0, 10000, 250, 'ms'), t('live.delayHelp'))}
          </div>`)
          + group(t('live.group.look'), `<div class="lv-fields">
            ${fld(t('live.icon'), num('iconSize', c.iconSize, 20, 96, 2, 'px'))}
            ${fld(t('live.time'), sel('mode', c.mode, [['number', 'live.number'], ['clock', 'live.shade'], ['both', 'live.both']]))}
            ${fld(t('live.opacity'), `<input type="range" data-k="opacity" min="0.3" max="1" step="0.05" value="${c.opacity}" />`)}
          </div>`);
      } else {
        body = group(t('live.group.content'), `<div class="lv-fields">
            ${fld(t('live.content'), sel('filter', c.filter, [['boons', 'live.boons'], ['conditions', 'live.conditions'], ['other', 'live.other'], ['all', 'live.all']]))}
            ${fld(t('live.sort'), sel('sort', c.sort, [['timeAsc', 'live.timeAsc'], ['timeDesc', 'live.timeDesc'], ['stacks', 'live.stacks'], ['name', 'live.name']]))}
          </div>`)
          + group(t('live.group.look'), `<div class="lv-fields">
            ${fld(t('live.layout'), sel('layout', c.layout, [['grid', 'live.grid'], ['list', 'live.list']]))}
            ${fld(t('live.direction'), sel('direction', c.direction, [['row', 'live.row'], ['col', 'live.col']]))}
            ${fld(t('live.icon'), num('iconSize', c.iconSize, 20, 96, 2, 'px'))}
            ${fld(t('live.time'), sel('mode', c.mode, [['number', 'live.number'], ['clock', 'live.shade'], ['both', 'live.both']]))}
            ${fld(t('live.opacity'), `<input type="range" data-k="opacity" min="0.3" max="1" step="0.05" value="${c.opacity}" />`)}
          </div><div class="lv-checks">
            ${chk('showIcons', c.showIcons !== false, t('live.showIcons'))}
            ${chk('showNames', !!c.showNames, t('live.showNames'))}
          </div>`);
      }
      return `<details class="lv-win ${c.enabled ? 'on' : ''}" data-id="${id}" ${c.enabled ? 'open' : ''}>
        <summary>
          <label class="lv-title"><input type="checkbox" data-k="enabled" ${c.enabled ? 'checked' : ''} /><b>${esc(t('live.win.' + id))}</b></label>
          <span class="lv-state ${c.enabled ? (c.locked ? 'locked' : 'edit') : 'off'}">${esc(t(c.enabled ? (c.locked ? 'live.state.locked' : 'live.state.edit') : 'live.state.off'))}</span>
          <span class="spacer"></span>
          <label class="chip ${c.locked ? 'on' : ''}"><input type="checkbox" data-k="locked" ${c.locked ? 'checked' : ''} /> ${esc(t('live.locked'))}</label>
          <button data-reset="${id}" class="small">${esc(t('live.resetPos'))}</button>
        </summary>
        <div class="lv-body">${body}</div>
      </details>`;
    }).join('');
    root.querySelectorAll('.lv-win').forEach((box) => {
      const id = box.dataset.id;
      // Klikk på avkryssinger og knapper i overskriften skal ikke folde kortet sammen/ut
      box.querySelectorAll('summary label, summary button, summary input').forEach((el) => el.addEventListener('click', (e) => e.stopPropagation()));
      box.querySelectorAll('[data-k]').forEach((inp) => inp.addEventListener('change', async () => {
        const k = inp.dataset.k;
        const valid = scope.request('window-' + id + '-' + k);
        const numeric = inp.type === 'number' || inp.type === 'range';
        const v = inp.type === 'checkbox' ? inp.checked : numeric ? Panel.number(inp.value, overlays[id][k], Number(inp.min), Number(inp.max)) : inp.value;
        if (numeric) inp.value = String(v);
        const result = await window.api.invoke('overlays:set', id, { [k]: v });
        if (!valid()) return;
        overlays[id] = { ...overlays[id], [k]: result[k] };
        if (inp.type === 'checkbox') renderWindows(); // status og chips i overskriften følger med
      }));
      box.querySelector('[data-reset]').addEventListener('click', async () => { const result = await window.api.invoke('overlays:set', id, { x: null, y: null }); if (!mounted.valid()) return; overlays[id] = { ...overlays[id], x: result.x, y: result.y }; setStatus(t('live.posReset')); });
    });
  }

  async function loadBar(reset = false) {
    if (!root) return;
    const valid = scope.request('bar');
    const box = $('#lvSkillbar', root);
    box.innerHTML = `<h3>${esc(t('live.skillbarTitle'))}</h3><p class="muted">${esc(t('live.loadingBar'))}</p>`;
    let result;
    try { result = await window.api.invoke('skills:get', { ...(editTab != null ? { tab: editTab } : {}), ...(editSet ? { set: editSet } : {}) }); }
    catch (e) { result = { ok: false, error: e.message }; }
    if (!valid()) return;
    bar = result;
    if (!bar.ok) { box.innerHTML = `<h3>${esc(t('live.skillbarTitle'))}</h3><p class="muted">${esc(bar.error)}</p><button id="lvReload">${esc(t('live.retry'))}</button>`; $('#lvReload', box).addEventListener('click', loadBar); return; }
    if (!drafts.has(bar.key)) drafts.set(bar.key, { steps: copy(bar.rotation.steps), upkeep: copy(bar.rotation.upkeep), revision: 0, job: null, suggestion: null, explanation: '' });
    const draft = drafts.get(bar.key);
    if (reset === true) { draft.steps = copy(bar.rotation.steps); draft.upkeep = copy(bar.rotation.upkeep); draft.revision++; }
    steps = draft.steps;
    upkeep = draft.upkeep;
    renderBar();
  }

  function renderBar() {
    if (!root || !bar?.ok) return;
    const draft = drafts.get(bar.key);
    if (!draft) return;
    steps = draft.steps; upkeep = draft.upkeep;
    const box = $('#lvSkillbar', root);
    const skillOpt = (sel) => bar.all.map((s) => `<option value="${esc(s.id)}" ${s.id === sel ? 'selected' : ''}>${esc(s.name)}${s.recharge ? ' (' + s.recharge + 's)' : ''}</option>`).join('');
    const boonOpt = (sel) => bar.boonNames.map((b) => `<option value="${esc(b)}" ${b === sel ? 'selected' : ''}>${esc(b)}</option>`).join('');
    const buildOpts = bar.builds.map((b) => `<option value="${esc(b.tab)}" ${b.tab === bar.tab ? 'selected' : ''}>${esc(b.name)}${b.active ? ' ' + esc(t('live.activeInGame')) : ''}</option>`).join('');
    box.innerHTML = `<h3>${esc(t('live.skillbarTitle'))}</h3>
      <div class="row"><label class="inline">${esc(t('live.build'))} <select id="lvBuild">${buildOpts}</select></label>
        <label class="inline">${esc(t('live.weaponSet'))} <select id="lvSet"><option value="A" ${bar.weaponSet === 'A' ? 'selected' : ''}>A: ${esc(bar.sets.A.types.join(' + ') || t('live.noWeapon'))}</option>${bar.sets.B ? `<option value="B" ${bar.weaponSet === 'B' ? 'selected' : ''}>B: ${esc(bar.sets.B.types.join(' + '))}</option>` : ''}</select></label>
        <span class="muted small">${esc(bar.character)} · ${esc(bar.professionName)}${bar.specName ? ' (' + esc(bar.specName) + ')' : ''}. ${esc(t('live.barHelp'))}</span></div>
      <div class="lv-icons">${bar.all.map((s) => `<img src="${esc(s.icon)}" title="${esc(s.name)}${s.buffs?.length ? ' · ' + esc(t('live.gives', { buffs: s.buffs.join(', ') })) : ''}" alt="" />`).join('')}</div>
      <h4>${esc(t('live.rotation'))}</h4>
      <ol id="lvRot" class="lv-rot">${steps.map((r, i) => `<li><select data-i="${i}">${skillOpt(r.skill)}</select><input type="text" data-note="${i}" value="${esc(r.note || '')}" placeholder="${esc(t('live.notePlaceholder'))}" /><button data-up="${i}" class="small">▲</button><button data-del="${i}" class="small">✕</button></li>`).join('')}</ol>
      <div class="row"><button id="lvAdd">${esc(t('live.addStep'))}</button><button id="lvSuggest" ${draft.job ? 'disabled' : ''}>${esc(t('live.suggestAi'))}</button><button id="lvCancel" ${draft.job ? '' : 'hidden'}>${esc(t('common.cancel'))}</button><span id="lvSuggestStatus" class="muted"></span></div>
      <div id="lvExplain" class="muted small">${esc(draft.explanation || '')}</div>
      ${draft.suggestion ? `<p>${esc(t('live.suggestionSaved'))} <button id="lvApplySuggestion">${esc(t('live.applySuggestion'))}</button></p>` : ''}
      <h4>${esc(t('live.upkeep'))}</h4>
      <p class="muted small">${esc(t('live.upkeepHelp'))}</p>
      <ul id="lvUp" class="lv-rot">${upkeep.map((u, i) => `<li><select data-ui="${i}">${skillOpt(u.skill)}</select><span class="muted">${esc(t('live.keepsUp'))}</span><select data-ub="${i}">${boonOpt(u.boon)}</select><button data-udel="${i}" class="small">✕</button></li>`).join('')}</ul>
      <div class="row"><button id="lvUpAdd">${esc(t('live.add'))}</button><button id="lvUpSuggest">${esc(t('live.suggestFromSkills'))}</button><button id="lvSave" class="primary">${esc(t('live.saveBuild'))}</button><button id="lvReload2">${esc(t('live.reload'))}</button></div>`;
    $('#lvBuild', box).addEventListener('change', (e) => { editTab = Number(e.target.value); loadBar(); });
    $('#lvSet', box).addEventListener('change', (e) => { editSet = e.target.value; loadBar(); });
    box.querySelectorAll('select[data-i]').forEach((s) => s.addEventListener('change', () => { steps[Number(s.dataset.i)].skill = Number(s.value); edited(); }));
    box.querySelectorAll('input[data-note]').forEach((s) => s.addEventListener('input', () => { steps[Number(s.dataset.note)].note = s.value; edited(); }));
    box.querySelectorAll('[data-del]').forEach((b) => b.addEventListener('click', () => { steps.splice(Number(b.dataset.del), 1); edited(); renderBar(); }));
    box.querySelectorAll('[data-up]').forEach((b) => b.addEventListener('click', () => { const i = Number(b.dataset.up); if (i > 0) { [steps[i - 1], steps[i]] = [steps[i], steps[i - 1]]; edited(); renderBar(); } }));
    box.querySelectorAll('select[data-ui]').forEach((s) => s.addEventListener('change', () => { upkeep[Number(s.dataset.ui)].skill = Number(s.value); edited(); }));
    box.querySelectorAll('select[data-ub]').forEach((s) => s.addEventListener('change', () => { upkeep[Number(s.dataset.ub)].boon = s.value; edited(); }));
    box.querySelectorAll('[data-udel]').forEach((b) => b.addEventListener('click', () => { upkeep.splice(Number(b.dataset.udel), 1); edited(); renderBar(); }));
    $('#lvAdd', box).addEventListener('click', () => { steps.push({ skill: bar.all[0]?.id, note: '' }); edited(); renderBar(); });
    $('#lvUpAdd', box).addEventListener('click', () => { upkeep.push({ skill: bar.all[0]?.id, boon: 'Might' }); edited(); renderBar(); });
    $('#lvUpSuggest', box).addEventListener('click', () => {
      const existing = new Set(upkeep.map((u) => u.skill + '|' + u.boon));
      for (const s of bar.upkeepSuggestions) for (const boon of s.boons) if (!existing.has(s.skill + '|' + boon)) upkeep.push({ skill: s.skill, boon });
      edited();
      if (!bar.upkeepSuggestions.length) setStatus(t('live.noBoonSkills'));
      renderBar();
    });
    $('#lvReload2', box).addEventListener('click', () => loadBar(true));
    $('#lvSave', box).addEventListener('click', async () => { const mounted = scope, key = bar.key, build = bar.buildName; await window.api.invoke('skills:setRotation', key, { steps: copy(steps), upkeep: copy(upkeep) }); if (mounted.valid()) setStatus(t('live.saved', { build })); });
    $('#lvApplySuggestion', box)?.addEventListener('click', () => { draft.steps = copy(draft.suggestion.rotasjon); draft.explanation = draft.suggestion.forklaring || ''; draft.suggestion = null; draft.revision++; renderBar(); });
    $('#lvCancel', box).addEventListener('click', () => { const job = draft.job; if (!job) return; job.cancelled = true; draft.job = null; window.api.invoke('ai:cancel', job.id).catch(() => {}); renderBar(); });
    $('#lvSuggest', box).addEventListener('click', async () => {
      if (draft.job) return;
      const job = { id: Panel.requestId('rotation'), key: bar.key, revision: draft.revision };
      draft.job = job; renderBar(); $('#lvSuggestStatus', root).textContent = t('common.sendingToModel');
      try {
        const r = await window.api.invoke('skills:suggest', job.key, { requestId: job.id });
        if (job.cancelled || draft.job !== job) return;
        if (draft.revision === job.revision) { draft.steps = copy(r.rotasjon); draft.explanation = r.forklaring || ''; draft.revision++; }
        else draft.suggestion = r;
      } catch (e) { if (!job.cancelled) draft.explanation = t('live.suggestFailed', { message: e.message }); }
      finally { if (draft.job === job) draft.job = null; if (root && bar?.key === job.key) renderBar(); }
    });
  }

  Panel.register({ id: 'live', title: () => T.t('module.live'), icon: '⚡', mount, unmount });
})();
