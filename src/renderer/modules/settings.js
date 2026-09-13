'use strict';
// Innstillinger-modul (renderer). Språkvalget øverst lagres med en gang og bytter språk uten omstart.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  let offUpdate = null;

  const template = () => `
    <div class="settings">
      <label>${t('settings.language')} <select id="language">${T.languages.map((l) => `<option value="${esc(l.id)}" ${l.id === T.language ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>

      <h3>${t('settings.gw2')}</h3>
      <label>${t('settings.apiKey')} <input id="apiKey" type="password" placeholder="${esc(t('settings.apiKeyPlaceholder'))}" /></label>
      <p class="muted">${t('settings.apiKeyHelp', { link: `<a href="#" id="apiLink">${esc(t('settings.apiLink'))}</a>` })}</p>

      <h3>${t('settings.ai')}</h3>
      <label>${t('settings.lmUrl')} <input id="lmUrl" type="text" /></label>
      <label>${t('settings.lmModel')} <span class="row"><select id="lmModel"></select><button id="modelsBtn" type="button">${t('settings.fetchModels')}</button></span></label>
      <p class="muted">${t('settings.aiHelp')}</p>

      <h3>${t('settings.rules')}</h3>
      <label>${t('settings.materialCap')} <input id="materialCap" type="number" min="250" step="250" /></label>
      <label>${t('settings.minTp')} <input id="minTp" type="number" min="0" step="10" /></label>
      <label>${t('settings.keepList')} <textarea id="keepList" rows="8"></textarea></label>

      <h3>${t('settings.game')}</h3>
      <label>${t('settings.gw2Dir')}
        <span class="row"><input id="gw2Dir" type="text" placeholder="C:\\Guild Wars 2" /><button id="gw2Detect" type="button">${t('settings.detect')}</button><button id="gw2Pick" type="button">${t('settings.pickDir')}</button></span>
      </label>
      <p class="muted small">${t('settings.gw2DirHelp')}</p>
      <label class="inline"><input type="checkbox" id="followGame" /> ${t('settings.followGame')}</label>
      <label>${t('settings.dpsLogDir')} <input id="dpsLogDir" type="text" placeholder="" /></label>
      <p class="muted">${t('settings.dpsLogDirHelp1')} <span id="dpsDefault"></span>. ${t('settings.dpsLogDirHelp2')}</p>

      <h3>${t('settings.modules')}</h3>
      <div id="modList" class="dy-list"></div>
      <p class="muted small">${t('settings.modulesHelp')}</p>

      <h3>${t('settings.overlay')}</h3>
      <label>${t('settings.uiScale')} <span class="row"><input id="uiScale" type="range" min="0.6" max="2.2" step="0.1" style="width:60%" /><span id="uiScaleVal" class="muted"></span></span></label>
      <label>${t('settings.wheelSize')} <input id="wheelSize" type="number" min="140" max="320" step="10" /></label>
      <label class="inline"><input type="checkbox" id="autoHide" /> ${t('settings.autoHide')}</label>
      <label class="inline"><input type="checkbox" id="launchAtStartup" /> ${t('settings.launchAtStartup')}</label>
      <p class="muted small">${t('settings.overlayHelp')}</p>

      <h3>${t('settings.update')}</h3>
      <p class="muted">${t('settings.installedVersion')} <b id="updVersion"></b></p>
      <label class="inline"><input type="checkbox" id="autoUpdate" /> ${t('settings.autoUpdate')}</label>
      <p class="muted small">${t('settings.updateHelp')}</p>
      <div class="row">
        <button id="updCheck" type="button">${t('settings.updCheck')}</button>
        <button id="updInstall" type="button" class="primary" style="display:none">${t('settings.updInstall')}</button>
        <span id="updStatus" class="muted small"></span>
      </div>
      <p class="muted small">${t('settings.updateSource')}</p>

      <div class="row">
        <button id="saveBtn" class="primary">${t('settings.save')}</button>
        <button id="quitBtn">${t('settings.quit')}</button>
      </div>
      <p class="muted small">${t('settings.configStored')} <span id="cfgPath"></span>. <span id="cfgErr" class="status error"></span></p>

      <h3>${t('settings.debug')}</h3>
      <div class="row">
        <button id="logOpenBtn" type="button">${t('settings.openLog')}</button>
        <button id="logReportBtn" type="button">${t('settings.copyReport')}</button>
      </div>
      <p class="muted small">${t('settings.debugHelp')}</p>
    </div>`;

  function fillModels(list, selected) {
    const sel = $('#lmModel', root);
    sel.innerHTML = list.length ? list.map((id) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}</option>`).join('') : `<option value="">${esc(t('settings.modelsPlaceholder'))}</option>`;
  }

  function fill(c) {
    if (!root || !c) return;
    $('#apiKey', root).value = c.apiKey || '';
    $('#lmUrl', root).value = c.lmUrl || '';
    $('#materialCap', root).value = c.materialCap;
    $('#minTp', root).value = c.minTp;
    $('#keepList', root).value = (c.keepList || []).join('\n');
    $('#dpsLogDir', root).value = c.dpsLogDir || '';
    $('#gw2Dir', root).value = c.gw2Dir || '';
    $('#followGame', root).checked = !!c.followGame;
    $('#dpsDefault', root).textContent = c.dpsDefaultDir || '';
    $('#wheelSize', root).value = c.wheel?.size || 200;
    $('#uiScale', root).value = c.uiScale || 1;
    $('#uiScaleVal', root).textContent = Math.round((c.uiScale || 1) * 100) + ' %';
    $('#autoHide', root).checked = !!c.autoHide;
    $('#launchAtStartup', root).checked = !!c.launchAtStartup;
    const ALL = [['inventory', '🎒'], ['daily', '📅'], ['timers', '⏱️'], ['tp', '💰'], ['dps', '⚔️'], ['live', '⚡'], ['characters', '🧙'], ['guild', '🏰']];
    const on = c.wheelModules;
    $('#modList', root).innerHTML = ALL.map(([id, icon]) => `<label class="dy-item inline"><input type="checkbox" class="modToggle" value="${id}" ${!on || on.includes(id) ? 'checked' : ''} /> ${icon} ${esc(t('module.' + id))}</label>`).join('');
    $('#cfgPath', root).textContent = c.configPath || '';
    $('#cfgErr', root).textContent = c.lastSaveError ? t('settings.lastSaveFailed', { error: c.lastSaveError }) : '';
    $('#autoUpdate', root).checked = c.autoUpdate !== false;
    $('#updVersion', root).textContent = c.appVersion || '';
    fillModels([c.lmModel].filter(Boolean), c.lmModel);
  }

  // Oppdateringsstatus fra hovedprosessen (update:status) eller svaret på en manuell sjekk
  function updateText(s) {
    if (!s) return '';
    const v = s.version ? ` (${s.version})` : '';
    switch (s.status) {
      case 'dev': return t('settings.upd.dev');
      case 'checking': return t('settings.upd.checking');
      case 'available': return t('settings.upd.available', { v });
      case 'downloading': return t('settings.upd.downloading', { v, percent: s.percent || 0 });
      case 'downloaded': return t('settings.upd.downloaded', { v });
      case 'error': return t('settings.upd.error', { error: s.error || t('settings.upd.unknown') });
      case 'not-available': return s.note === 'noReleases' ? t('settings.upd.noReleases') : t('settings.upd.notAvailable');
      default: return '';
    }
  }

  function showUpdate(s) {
    if (!root || !s) return;
    if (s.appVersion) $('#updVersion', root).textContent = s.appVersion;
    const el = $('#updStatus', root);
    el.textContent = updateText(s);
    el.classList.toggle('error', s.status === 'error');
    $('#updInstall', root).style.display = s.status === 'downloaded' ? '' : 'none';
    $('#updCheck', root).disabled = s.status === 'checking' || s.status === 'downloading';
  }

  function mount(el) {
    root = el;
    el.innerHTML = template();
    fill(Panel.config);
    // Språk: lagres med en gang; hovedprosessen sender config:changed, og panelet monterer modulen på nytt
    $('#language', el).addEventListener('change', async (e) => { Panel.config = await window.api.invoke('config:set', { language: e.target.value }); });
    $('#apiLink', el).addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:url', 'https://account.arena.net/applications'); });
    $('#modelsBtn', el).addEventListener('click', async () => {
      try {
        await window.api.invoke('config:set', { lmUrl: $('#lmUrl', root).value.trim() });
        const models = await window.api.invoke('ai:models');
        fillModels(models, $('#lmModel', root).value || Panel.config.lmModel || models[0]);
        setStatus(t('settings.modelsFound', { n: models.length }));
      } catch (e) { setStatus(t('settings.modelsFailed', { message: e.message }), true); }
    });
    $('#saveBtn', el).addEventListener('click', async () => {
      const patch = {
        apiKey: $('#apiKey', root).value.trim(),
        lmUrl: $('#lmUrl', root).value.trim(),
        lmModel: $('#lmModel', root).value,
        materialCap: Number($('#materialCap', root).value) || 250,
        minTp: Number($('#minTp', root).value) || 0,
        keepList: $('#keepList', root).value.split('\n').map((s) => s.trim()).filter(Boolean),
        dpsLogDir: $('#dpsLogDir', root).value.trim(),
        gw2Dir: $('#gw2Dir', root).value.trim(),
        followGame: $('#followGame', root).checked,
        wheel: { size: Number($('#wheelSize', root).value) || 200 },
        uiScale: Number($('#uiScale', root).value) || 1,
        autoHide: $('#autoHide', root).checked,
        launchAtStartup: $('#launchAtStartup', root).checked,
        autoUpdate: $('#autoUpdate', root).checked,
        language: $('#language', root).value,
        wheelModules: [...root.querySelectorAll('.modToggle')].filter((cb) => cb.checked).map((cb) => cb.value),
      };
      const prevKey = Panel.config?.apiKey || '';
      Panel.config = await window.api.invoke('config:set', patch);
      if (!root) return; // språkbytte monterte modulen på nytt
      $('#cfgErr', root).textContent = Panel.config.lastSaveError ? t('settings.lastSaveFailed', { error: Panel.config.lastSaveError }) : '';
      if (Panel.config.lastSaveError) { setStatus(t('settings.saveFailed', { error: Panel.config.lastSaveError }), true); return; }
      if (patch.apiKey && patch.apiKey !== prevKey) {
        setStatus(t('settings.savedFetching'));
        window.api.invoke('panel:show', 'inventory');
      } else if (patch.apiKey) {
        setStatus(t('settings.savedRefresh'));
      } else {
        setStatus(t('settings.saved'));
      }
    });
    $('#quitBtn', el).addEventListener('click', () => window.api.invoke('app:quit'));
    $('#uiScale', el).addEventListener('input', (e) => { $('#uiScaleVal', root).textContent = Math.round(Number(e.target.value) * 100) + ' %'; });
    $('#uiScale', el).addEventListener('change', async (e) => { Panel.config = await window.api.invoke('config:set', { uiScale: Number(e.target.value) || 1 }); });
    $('#logOpenBtn', el).addEventListener('click', async () => {
      try { const p = await window.api.invoke('log:open'); setStatus(t('settings.opened', { path: p })); }
      catch (e) { setStatus(t('settings.openLogFailed', { message: e.message }), true); }
    });
    $('#logReportBtn', el).addEventListener('click', async () => {
      try { await window.api.invoke('log:report'); setStatus(t('settings.reportCopied')); }
      catch (e) { setStatus(t('settings.reportFailed', { message: e.message }), true); }
    });
    $('#gw2Detect', el).addEventListener('click', async () => {
      const d = await window.api.invoke('gw2:detectDir');
      if (d) { $('#gw2Dir', root).value = d; setStatus(t('settings.foundGame', { dir: d })); } else setStatus(t('settings.gameNotFound'), true);
    });
    $('#gw2Pick', el).addEventListener('click', async () => {
      try { const d = await window.api.invoke('gw2:pickDir'); if (d) { $('#gw2Dir', root).value = d; setStatus(t('settings.dirPicked')); } }
      catch (e) { setStatus(e.message, true); }
    });
    // Oppdatering: manuell sjekk, fremdrift fra hovedprosessen, og installer når nedlastingen er ferdig
    offUpdate = window.api.on('update:status', showUpdate);
    $('#updCheck', el).addEventListener('click', async () => {
      showUpdate({ status: 'checking' });
      try { showUpdate(await window.api.invoke('update:check')); }
      catch (e) { showUpdate({ status: 'error', error: e.message }); }
    });
    $('#updInstall', el).addEventListener('click', async () => {
      try { if (!(await window.api.invoke('update:install'))) setStatus(t('settings.noDownload'), true); }
      catch (e) { setStatus(e.message, true); }
    });
  }

  function unmount() { offUpdate?.(); offUpdate = null; root = null; }

  Panel.register({ id: 'settings', title: () => T.t('module.settings'), icon: '⚙️', mount, unmount });
})();
