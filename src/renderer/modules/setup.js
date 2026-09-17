'use strict';
// Kom i gang-veiviseren (renderer). Åpnes ved første oppstart og ligger som fane ved siden av Innstillinger.
// Ett steg per ting som må være på plass, med status fra setup:check og knapper som ordner det direkte.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let last = null; // siste sjekk
  let busy = false;
  let keyRevision = 0;
  let keyDraft = ''; // Bare i minnet, også ved fanebytte og språkbytte.

  const ICON = { ok: '✅', warn: '⚠️', bad: '❌', wait: '⏳', off: '⚪' };

  const template = () => `
    <div class="settings setup">
      <p class="setup-intro">${t('setup.intro')}</p>
      <label>${t('settings.language')} <select id="suLanguage">${T.languages.map((l) => `<option value="${esc(l.id)}" ${l.id === T.language ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <div class="row setup-tools">
        <button id="suCheck" type="button" class="primary">${t('setup.runCheck')}</button>
        <span id="suSummary" class="muted small"></span>
      </div>
      <ol class="setup-steps" id="suSteps"></ol>
      <label class="inline"><input type="checkbox" id="suDone" /> ${t('setup.dontShow')}</label>
      <p class="muted small">${t('setup.reopen')}</p>
    </div>`;

  // Ett steg: tittel, forklaring, statuslinje og knapper
  function step(id, state, title, body, statusText, actions = '') {
    return `<li class="setup-step ${state}" id="su-${id}">
      <div class="setup-head"><span class="setup-icon">${ICON[state] || ICON.off}</span><b>${esc(title)}</b></div>
      <div class="setup-body">${body}</div>
      <div class="setup-status">${statusText}</div>
      ${actions ? `<div class="row setup-actions">${actions}</div>` : ''}
    </li>`;
  }

  function render() {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root) return;
    const s = last;
    const steps = [];
    const link = (href, label) => `<a href="#" data-url="${esc(href)}">${esc(label)}</a>`;

    // 1. API-nøkkel
    {
      let state = 'wait', status = t('setup.key.notSet');
      if (s) {
        if (!s.key.set) { state = 'bad'; }
        else if (!s.key.valid) { state = 'bad'; status = t('setup.key.invalid', { error: s.key.error }); }
        else if (s.key.missing.required.length) { state = 'bad'; status = t('setup.key.missingRequired', { name: s.key.name, list: s.key.missing.required.join(', ') }); }
        else if (s.key.missing.recommended.length) { state = 'warn'; status = t('setup.key.missingRecommended', { name: s.key.name, list: s.key.missing.recommended.join(', ') }); }
        else { state = 'ok'; status = t('setup.key.ok', { name: s.key.name }); }
      }
      const body = `<ol class="setup-howto">
          <li>${t('setup.key.step1', { link: link('https://account.arena.net/applications', 'account.arena.net/applications') })}</li>
          <li>${t('setup.key.step2')}</li>
          <li>${t('setup.key.step3')}</li>
        </ol>
        <span class="row"><input id="suKey" type="password" placeholder="${esc(t('settings.apiKeyPlaceholder'))}" /><button id="suKeySave" type="button" class="primary">${t('setup.key.save')}</button></span>`;
      steps.push(step('key', state, t('setup.key.title'), body, esc(status), `<button type="button" data-url="https://account.arena.net/applications">${t('settings.apiLink')}</button>`));
    }

    // 2. Spillmappe
    {
      let state = 'wait', status = '';
      if (s) {
        if (s.game.valid) { state = 'ok'; status = t('setup.game.found', { dir: s.game.dir }) + (s.game.saved ? '' : ' ' + t('setup.game.notSaved')); }
        else { state = 'bad'; status = t('setup.game.notFound'); }
      }
      steps.push(step('game', state, t('setup.game.title'), esc(t('setup.game.body')), esc(status),
        `<button id="suGameDetect" type="button">${t('settings.detect')}</button><button id="suGamePick" type="button">${t('settings.pickDir')}</button>`));
    }

    // 3. ArcDPS og broen
    {
      let state = 'wait', status = '', btn = t('setup.arc.install');
      if (s) {
        if (!s.game.valid) { state = 'off'; status = t('setup.arc.needGame'); }
        else {
          const parts = [];
          const b = s.arc.bridge;
          if (!s.arc.installed) parts.push(t('setup.arc.arcMissing'));
          else if (s.arc.updateAvailable) parts.push(t('setup.arc.arcOld'));
          else parts.push(t('setup.arc.arcOk'));
          if (!b.installed) parts.push(t('setup.arc.bridgeMissing'));
          else if (!b.upToDate) parts.push(t('setup.arc.bridgeOld'));
          else parts.push(t('setup.arc.bridgeOk'));
          const allOk = s.arc.installed && !s.arc.updateAvailable && b.installed && b.upToDate;
          state = allOk ? 'ok' : (s.arc.installed && b.installed ? 'warn' : 'bad');
          if (allOk) btn = t('setup.arc.reinstall');
          if (s.game.running) parts.push(t('dps.gameRunning'));
          if (s.arc.error) parts.push(t('setup.arc.checkFailed', { error: s.arc.error }));
          status = parts.join(' ');
        }
      }
      steps.push(step('arc', state, t('setup.arc.title'), esc(t('setup.arc.body')), esc(status),
        `<button id="suArcInstall" type="button" class="primary" ${s && (!s.game.valid || s.game.running) ? 'disabled' : ''}>${esc(btn)}</button>`));
    }

    // 4. Loggmappe
    {
      let state = 'wait', status = '';
      if (s) {
        if (s.logs.exists) { state = 'ok'; status = t('setup.logs.found', { dir: s.logs.dir, n: s.logs.count }); }
        else { state = 'ok'; status = t('setup.logs.missing', { dir: s.logs.dir }); } // valgfritt: trengs bare for DPS-fanen
      }
      steps.push(step('logs', state, t('setup.logs.title'), esc(t('setup.logs.body')), esc(status)));
    }

    // 5. Oppstart sammen med spillet
    {
      let state = 'wait', status = '';
      if (s) {
        const both = s.startup.followGame && s.startup.launchAtStartup;
        state = both ? 'ok' : 'warn';
        status = both ? t('setup.startup.ok') : t('setup.startup.partial');
      }
      const body = `<label class="inline"><input type="checkbox" id="suFollow" ${s?.startup.followGame ? 'checked' : ''} /> ${t('setup.startup.follow')}</label>
        <label class="inline"><input type="checkbox" id="suLaunch" ${s?.startup.launchAtStartup ? 'checked' : ''} /> ${t('settings.launchAtStartup')}</label>`;
      steps.push(step('startup', state, t('setup.startup.title'), body, esc(status)));
    }

    // 6. Hjelperen (MumbleLink)
    {
      let state = 'wait', status = '';
      if (s) {
        if (!s.helper.ok) { state = 'bad'; status = t('setup.helper.error', { error: s.helper.error }); }
        else if (s.helper.gameSeen) { state = 'ok'; status = t('setup.helper.ok'); }
        else { state = 'ok'; status = t('setup.helper.waiting'); }
      }
      steps.push(step('helper', state, t('setup.helper.title'), esc(t('setup.helper.body')), esc(status)));
    }

    // 7. Lokal AI (valgfri)
    {
      let state = 'wait', status = '';
      if (s) {
        const local = s.ai.provider === 'local';
        if (s.ai.error === 'NOKEY') { state = 'warn'; status = t('setup.ai.noKey', { name: s.ai.name }); }
        else if (!s.ai.ok) { state = 'warn'; status = local ? t('setup.ai.down', { url: s.ai.url }) : t('setup.ai.cloudDown', { name: s.ai.name, error: s.ai.error }); }
        else if (local && !s.ai.modelLoaded) { state = 'warn'; status = t('setup.ai.noModel', { n: s.ai.models, model: s.ai.model }); }
        else { state = 'ok'; status = local ? t('setup.ai.ok', { model: s.ai.model }) : t('setup.ai.cloudOk', { name: s.ai.name, model: s.ai.model }); }
      }
      steps.push(step('ai', state, t('setup.ai.title'), t('setup.ai.body', { link: link('https://lmstudio.ai', 'lmstudio.ai') }), esc(status),
        `<button type="button" data-module="settings">${t('setup.openSettings')}</button>`));
    }

    const list = $('#suSteps', root);
    const keyStep = $('#su-key', list);
    if (!keyStep) list.innerHTML = steps.join('');
    else {
      // Behold selve nøkkelfeltet og fokuset mens en langsom statuskontroll fullfører.
      const next = document.createElement('ol'); next.innerHTML = steps.join('');
      for (const li of [...next.children]) {
        const prev = $('#' + li.id, list);
        if (li.id === 'su-key') {
          prev.className = li.className;
          $('.setup-status', prev).textContent = $('.setup-status', li).textContent;
        } else if (prev) prev.replaceWith(li);
        else list.appendChild(li);
      }
    }
    if (s) {
      const states = [...root.querySelectorAll('.setup-step')].map((li) => li.classList.contains('bad') ? 'bad' : li.classList.contains('warn') ? 'warn' : 'ok');
      const bad = states.filter((x) => x === 'bad').length, warn = states.filter((x) => x === 'warn').length;
      $('#suSummary', root).textContent = bad ? t('setup.summary.bad', { n: bad }) : warn ? t('setup.summary.warn', { n: warn }) : t('setup.summary.ok');
    }
    bindSteps();
  }

  function bindSteps() {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root.querySelectorAll('[data-url]').forEach((el) => { el.onclick = (e) => { e.preventDefault(); window.api.invoke('open:url', el.dataset.url); }; });
    root.querySelectorAll('[data-module]').forEach((el) => { el.onclick = () => window.api.invoke('panel:show', el.dataset.module); });
    const keyInput = $('#suKey', root);
    if (keyInput.value !== keyDraft) keyInput.value = keyDraft;
    keyInput.oninput = () => { keyDraft = keyInput.value; keyRevision++; };
    $('#suKeySave', root).onclick = async () => {
      const revision = keyRevision;
      const key = $('#suKey', root).value.trim();
      if (!key) { setStatus(t('setup.key.empty'), true); return; }
      await window.api.invoke('config:set', { apiKey: key });
      if (revision === keyRevision) { keyDraft = ''; if (mounted.valid()) keyInput.value = ''; }
      if (!mounted.valid()) return;
      setStatus(t('setup.key.saved'));
      await runCheck();
    };
    $('#suGameDetect', root)?.addEventListener('click', async () => {
      const d = await window.api.invoke('gw2:detectDir');
      if (!mounted.valid()) return;
      if (d) { await window.api.invoke('config:set', { gw2Dir: d }); if (!mounted.valid()) return; setStatus(t('settings.foundGame', { dir: d })); await runCheck(); }
      else setStatus(t('settings.gameNotFound'), true);
    });
    $('#suGamePick', root)?.addEventListener('click', async () => {
      try { const d = await window.api.invoke('gw2:pickDir'); if (d) { await window.api.invoke('config:set', { gw2Dir: d }); if (mounted.valid()) await runCheck(); } }
      catch (e) { setStatus(e.message, true); }
    });
    $('#suArcInstall', root)?.addEventListener('click', async () => {
      const btn = $('#suArcInstall', root);
      btn.disabled = true; $('#su-arc .setup-status', root).textContent = t('dps.downloading');
      try { await window.api.invoke('setup:installArc'); setStatus(t('setup.arc.done')); }
      catch (e) { setStatus(t('common.error', { message: e.message }), true); }
      if (mounted.valid()) await runCheck();
    });
    const startup = async () => {
      const patch = { followGame: $('#suFollow', root).checked, launchAtStartup: $('#suLaunch', root).checked };
      Panel.config = await window.api.invoke('config:set', patch);
      if (!mounted.valid()) return;
      if (last) { last.startup = patch; render(); }
    };
    $('#suFollow', root)?.addEventListener('change', startup);
    $('#suLaunch', root)?.addEventListener('change', startup);
  }

  async function runCheck() {
    if (!root || busy) return;
    const valid = scope.request('check');
    busy = true;
    const btn = $('#suCheck', root);
    btn.disabled = true; $('#suSummary', root).textContent = t('setup.checking');
    try { const result = await window.api.invoke('setup:check'); if (valid()) last = result; }
    catch (e) { if (valid()) setStatus(t('common.error', { message: e.message }), true); }
    finally { if (valid()) busy = false; }
    if (!valid()) return;
    btn.disabled = false;
    render();
  }

  function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    $('#suDone', el).checked = !!Panel.config?.setupDone;
    $('#suLanguage', el).addEventListener('change', async (e) => { Panel.config = await window.api.invoke('config:set', { language: e.target.value }); });
    $('#suCheck', el).addEventListener('click', runCheck);
    $('#suDone', el).addEventListener('change', async (e) => { await window.api.invoke('setup:done', e.target.checked); setStatus(t(e.target.checked ? 'setup.doneOn' : 'setup.doneOff')); });
    mounted.own(Panel.onConfig((c) => { if (mounted.valid()) $('#suDone', el).checked = !!c.setupDone; }));
    render();
    runCheck();
  }

  function unmount() { life.clear(); root = null; last = null; busy = false; }

  Panel.register({ id: 'setup', title: () => T.t('module.setup'), icon: '🧭', mount, unmount });
})();
