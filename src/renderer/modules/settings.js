'use strict';
// Innstillinger-modul (renderer). Språkvalget øverst lagres med en gang og bytter språk uten omstart.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let offUpdate = null;
  let updateRevision = -1;
  const draft = new Map();
  let draftRevision = 0;
  function restoreDraft() {
    for (const [id, value] of draft) {
      const field = $('#' + id, root); if (!field) continue;
      if (field.type === 'checkbox') field.checked = value;
      else {
        if (field.tagName === 'SELECT' && ![...field.options].some((o) => o.value === value)) field.add(new Option(value, value));
        field.value = value;
      }
    }
  }

  const template = () => `
    <div class="settings">
      <label>${t('settings.language')} <select id="language">${T.languages.map((l) => `<option value="${esc(l.id)}" ${l.id === T.language ? 'selected' : ''}>${esc(l.name)}</option>`).join('')}</select></label>
      <section class="card" id="updCard">
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

      </section>

      <section class="card">
      <h3>${t('settings.gw2')}</h3>
      <label>${t('settings.apiKey')} <input id="apiKey" type="password" placeholder="${esc(t('settings.apiKeyPlaceholder'))}" /></label>
      <p class="muted">${t('settings.apiKeyHelp', { link: `<a href="#" id="apiLink">${esc(t('settings.apiLink'))}</a>` })}</p>
      </section>
      <section class="card">
      <h3>${t('settings.ai')}</h3>
      <label>${t('settings.aiProvider')} <select id="aiProvider"></select></label>
      <p class="muted small" id="aiProviderHelp"></p>
      <div id="aiLocalBox">
        <label>${t('settings.lmUrl')} <input id="lmUrl" type="text" /></label>
      </div>
      <div id="aiCloudBox" hidden>
        <label id="aiUrlWrap" hidden>${t('settings.aiUrl')} <input id="aiUrl" type="text" placeholder="https://…/v1" /></label>
        <label>${t('settings.aiKey')} <span class="row"><input id="aiKey" type="password" autocomplete="off" /><button id="aiKeyLink" type="button">${t('settings.aiGetKey')}</button></span></label>
      </div>
      <label>${t('settings.lmModel')} <span class="row"><select id="lmModel"></select><button id="modelsBtn" type="button">${t('settings.fetchModels')}</button></span></label>
      <p class="muted" id="aiHelp">${t('settings.aiHelp')}</p>
      </section>
      <section class="card">
      <h3>${t('settings.rules')}</h3>
      <label>${t('settings.materialCap')} <input id="materialCap" type="number" min="250" step="250" /></label>
      <label>${t('settings.minTp')} <input id="minTp" type="number" min="0" step="10" /></label>
      <label>${t('settings.keepList')} <textarea id="keepList" rows="8"></textarea></label>
      </section>
      <section class="card">
      <h3>${t('settings.game')}</h3>
      <label>${t('settings.gw2Dir')}
        <span class="row"><input id="gw2Dir" type="text" placeholder="C:\\Guild Wars 2" /><button id="gw2Detect" type="button">${t('settings.detect')}</button><button id="gw2Pick" type="button">${t('settings.pickDir')}</button></span>
      </label>
      <p class="muted small">${t('settings.gw2DirHelp')}</p>
      <label class="inline"><input type="checkbox" id="followGame" /> ${t('settings.followGame')}</label>
      <label>${t('settings.dpsLogDir')} <input id="dpsLogDir" type="text" placeholder="" /></label>
      <p class="muted">${t('settings.dpsLogDirHelp1')} <span id="dpsDefault"></span>. ${t('settings.dpsLogDirHelp2')}</p>
      </section>
      <section class="card">
      <h3>${t('settings.modules')}</h3>
      <div id="modList" class="dy-list"></div>
      <p class="muted small">${t('settings.modulesHelp')}</p>
      </section>
      <section class="card">
      <h3>${t('settings.overlay')}</h3>
      <label>${t('settings.uiScale')} <span class="row"><input id="uiScale" type="range" min="0.6" max="2.2" step="0.1" style="width:60%" /><span id="uiScaleVal" class="muted"></span></span></label>
      <label>${t('settings.wheelSize')} <input id="wheelSize" type="number" min="140" max="320" step="10" /></label>
      <label class="inline"><input type="checkbox" id="autoHide" /> ${t('settings.autoHide')}</label>
      <label class="inline"><input type="checkbox" id="launchAtStartup" /> ${t('settings.launchAtStartup')}</label>
      <p class="muted small">${t('settings.overlayHelp')}</p>
      </section>
      <div class="row">
        <button id="saveBtn" class="primary">${t('settings.save')}</button>
        <button id="quitBtn">${t('settings.quit')}</button>
      </div>
      <div class="act-note" id="saveNote" role="status"></div>
      <p class="muted small">${t('settings.configStored')} <span id="cfgPath"></span>. <span id="cfgErr" class="status error"></span></p>

      <section class="card">
      <h3>${t('settings.debug')}</h3>
      <div class="row">
        <button id="logOpenBtn" type="button">${t('settings.openLog')}</button>
        <button id="logReportBtn" type="button">${t('settings.copyReport')}</button>
      </div>
      <div class="act-note" id="debugNote" role="status"></div>
      <p class="muted small">${t('settings.debugHelp')}</p>
      </section>
    </div>`;

  function fillModels(list, selected) {
    const sel = $('#lmModel', root);
    sel.innerHTML = list.length ? list.map((id) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}</option>`).join('') : `<option value="">${esc(t('settings.modelsPlaceholder'))}</option>`;
  }

  function fill(c) {
    if (!root || !c) return;
    $('#apiKey', root).value = c.apiKey || '';
    $('#lmUrl', root).value = c.lmUrl || '';
    fillProvider(c, c.aiProvider || 'local');
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
    const ALL = [['inventory', '🎒'], ['daily', '📅'], ['timers', '⏱️'], ['tp', '💰'], ['dps', '⚔️'], ['live', '⚡'], ['characters', '🧙'], ['guild', '🏰'], ['guides', '📖']];
    const on = c.wheelModules;
    $('#modList', root).innerHTML = ALL.map(([id, icon]) => `<label class="dy-item inline"><input type="checkbox" class="modToggle" value="${id}" ${!on || on.includes(id) ? 'checked' : ''} /> ${icon} ${esc(t('module.' + id))}</label>`).join('');
    $('#cfgPath', root).textContent = c.configPath || '';
    $('#cfgErr', root).textContent = c.lastSaveError ? t('settings.lastSaveFailed', { error: c.lastSaveError }) : '';
    $('#autoUpdate', root).checked = c.autoUpdate !== false;
    $('#updVersion', root).textContent = c.appVersion || '';
  }

  // Leverandørvalget: viser feltene som gjelder (LM Studio-adresse, eller nøkkel og eventuelt adresse for skyleverandører)
  let providers = [];
  function fillProvider(c, id) {
    const sel = $('#aiProvider', root);
    sel.innerHTML = providers.map((p) => `<option value="${esc(p.id)}" ${p.id === id ? 'selected' : ''}>${esc(p.name)}</option>`).join('');
    const p = providers.find((x) => x.id === id) || providers[0] || { id: 'local', needsKey: false };
    const saved = (c.aiProviders || {})[p.id] || {};
    const local = p.id === 'local';
    $('#aiLocalBox', root).hidden = !local;
    $('#aiCloudBox', root).hidden = local;
    $('#aiUrlWrap', root).hidden = p.id !== 'custom';
    $('#aiUrl', root).value = saved.url || '';
    $('#aiKey', root).value = saved.apiKey || '';
    $('#aiKeyLink', root).hidden = !p.keyUrl;
    $('#aiKeyLink', root).dataset.url = p.keyUrl || '';
    const help = local ? t('settings.aiLocalNote') : p.id === 'custom' ? t('settings.aiCustomHelp') : (p.free ? t('settings.aiFree', { name: p.name }) : t('settings.aiPaid', { name: p.name }));
    $('#aiProviderHelp', root).textContent = help;
    $('#aiHelp', root).textContent = local ? t('settings.aiHelp') : t('settings.aiCloudModelHelp');
    const model = local ? c.lmModel : (saved.model || p.defaultModel || '');
    fillModels([model].filter(Boolean), model);
  }
  // Det som skal lagres for valgt leverandør
  function providerPatch() {
    const id = $('#aiProvider', root).value || 'local';
    const patch = { aiProvider: id, lmUrl: $('#lmUrl', root).value.trim() };
    if (id === 'local') patch.lmModel = $('#lmModel', root).value;
    else patch.aiProviders = { [id]: { apiKey: $('#aiKey', root).value.trim(), model: $('#lmModel', root).value, ...(id === 'custom' ? { url: $('#aiUrl', root).value.trim() } : {}) } };
    return patch;
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
    if (Number.isFinite(s.revision)) {
      if (s.revision < updateRevision) return;
      updateRevision = s.revision;
    }
    if (s.appVersion) $('#updVersion', root).textContent = s.appVersion;
    const el = $('#updStatus', root);
    el.textContent = updateText(s);
    el.classList.toggle('error', s.status === 'error');
    $('#updInstall', root).style.display = s.status === 'downloaded' ? '' : 'none';
    $('#updCheck', root).disabled = s.status === 'checking' || s.status === 'downloading';
    $('#updCard', root)?.classList.toggle('highlight', ['available', 'downloading', 'downloaded'].includes(s.status));
  }

  async function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    updateRevision = -1;
    offUpdate = mounted.on('update:status', showUpdate);
    window.api.invoke('update:get').then((s) => { if (mounted.valid()) showUpdate(s); }).catch(() => {});
    const remember = (e) => {
      const f = e.target;
      if (!f.id || !['INPUT', 'TEXTAREA', 'SELECT'].includes(f.tagName)) return;
      draft.set(f.id, f.type === 'checkbox' ? f.checked : f.value); draftRevision++;
    };
    el.addEventListener('input', remember); el.addEventListener('change', remember);
    try { providers = (await window.api.invoke('ai:providers')).providers; } catch { providers = [{ id: 'local', name: 'LM Studio', needsKey: false, free: true }]; }
    if (!mounted.valid()) return;
    fill(Panel.config);
    if (draft.has('aiProvider')) fillProvider(Panel.config, draft.get('aiProvider'));
    restoreDraft();
    $('#aiProvider', el).addEventListener('change', (e) => { fillProvider(Panel.config, e.target.value); for (const id of ['aiKey', 'aiUrl', 'lmModel']) draft.delete(id); });
    $('#aiKeyLink', el).addEventListener('click', (e) => { const u = e.currentTarget.dataset.url; if (u) window.api.invoke('open:url', u); });
    // Språk: lagres med en gang; hovedprosessen sender config:changed, og panelet monterer modulen på nytt
    $('#language', el).addEventListener('change', (e) => Panel.saveConfig({ language: e.target.value }, mounted));
    $('#apiLink', el).addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:url', 'https://account.arena.net/applications'); });
    $('#modelsBtn', el).addEventListener('click', async () => {
      const valid = mounted.request('models');
      const provider = $('#aiProvider', el).value;
      try {
        const saved = await Panel.saveConfig(providerPatch(), mounted);
        if (!saved) return;
        if (!valid()) return;
        const models = await window.api.invoke('ai:models');
        if (!valid() || $('#aiProvider', el).value !== provider) return;
        const want = $('#lmModel', root).value;
        fillModels(models.includes(want) || !want ? models : [want, ...models], want || models[0]);
        setStatus(t('settings.modelsFound', { n: models.length }));
      } catch (e) { if (valid()) setStatus(t('settings.modelsFailed', { message: e.message }), true); }
    });
    // Lagring med kvittering ved knappen: «Lagrer …», så grønn hake med hva som skjedde, eller rød feil
    $('#saveBtn', el).addEventListener('click', () => Panel.busy($('#saveBtn', root), save, { note: $('#saveNote', root), owner: mounted, working: t('settings.saving'), done: (r) => r }));
    async function save() {
      const fail = (text) => ({ kind: 'err', text });
      const savedRevision = draftRevision;
      const patch = {
        apiKey: $('#apiKey', root).value.trim(),
        ...providerPatch(),
        materialCap: Panel.number($('#materialCap', root).value, 250, 250),
        minTp: Panel.number($('#minTp', root).value, 0, 0),
        keepList: $('#keepList', root).value.split('\n').map((s) => s.trim()).filter(Boolean),
        dpsLogDir: $('#dpsLogDir', root).value.trim(),
        gw2Dir: $('#gw2Dir', root).value.trim(),
        followGame: $('#followGame', root).checked,
        wheel: { size: Panel.number($('#wheelSize', root).value, 200, 140, 320) },
        uiScale: Number($('#uiScale', root).value) || 1,
        autoHide: $('#autoHide', root).checked,
        launchAtStartup: $('#launchAtStartup', root).checked,
        autoUpdate: $('#autoUpdate', root).checked,
        language: $('#language', root).value,
        wheelModules: [...root.querySelectorAll('.modToggle')].filter((cb) => cb.checked).map((cb) => cb.value),
      };
      const prevKey = Panel.config?.apiKey || '';
      const saved = await Panel.saveConfig(patch, mounted);
      if (!saved) return fail(t('settings.saveRejected'));
      if (!saved.lastSaveError && savedRevision === draftRevision) draft.clear();
      if (!mounted.valid()) return null;
      $('#cfgErr', root).textContent = saved.lastSaveError ? t('settings.lastSaveFailed', { error: saved.lastSaveError }) : '';
      if (saved.lastSaveError) { const msg = t('settings.saveFailed', { error: saved.lastSaveError }); setStatus(msg, true); return fail(msg); }
      let msg;
      if (patch.apiKey && patch.apiKey !== prevKey) {
        msg = t('settings.savedFetching');
        window.api.invoke('panel:show', 'inventory');
      } else if (patch.apiKey) {
        msg = t('settings.savedRefresh');
      } else {
        msg = t('settings.saved');
      }
      setStatus(msg);
      return { kind: 'ok', text: msg };
    }
    $('#quitBtn', el).addEventListener('click', () => window.api.invoke('app:quit'));
    $('#uiScale', el).addEventListener('input', (e) => { $('#uiScaleVal', root).textContent = Math.round(Number(e.target.value) * 100) + ' %'; });
    $('#uiScale', el).addEventListener('change', (e) => Panel.saveConfig({ uiScale: Panel.number(e.target.value, 1, 0.6, 2.2) }, mounted));
    $('#logOpenBtn', el).addEventListener('click', () => Panel.busy($('#logOpenBtn', root), () => window.api.invoke('log:open'), {
      note: $('#debugNote', root), owner: mounted, working: t('settings.working'), done: (p) => t('settings.opened', { path: p }),
    }));
    $('#logReportBtn', el).addEventListener('click', () => Panel.busy($('#logReportBtn', root), () => window.api.invoke('log:report'), {
      note: $('#debugNote', root), owner: mounted, working: t('settings.working'), done: t('settings.reportCopied'),
    }));
    $('#gw2Detect', el).addEventListener('click', async () => {
      const d = await window.api.invoke('gw2:detectDir');
      if (!mounted.valid()) return;
      if (d) { $('#gw2Dir', root).value = d; setStatus(t('settings.foundGame', { dir: d })); } else setStatus(t('settings.gameNotFound'), true);
    });
    $('#gw2Pick', el).addEventListener('click', async () => {
      try { const d = await window.api.invoke('gw2:pickDir'); if (d && mounted.valid()) { $('#gw2Dir', root).value = d; draft.set('gw2Dir', d); draftRevision++; setStatus(t('settings.dirPicked')); } }
      catch (e) { if (mounted.valid()) setStatus(e.message, true); }
    });
    // Oppdatering: manuell sjekk, fremdrift fra hovedprosessen, og installer når nedlastingen er ferdig
    $('#updCheck', el).addEventListener('click', async () => {
      showUpdate({ status: 'checking' });
      try { const s = await window.api.invoke('update:check'); if (mounted.valid()) showUpdate(s); }
      catch (e) { if (mounted.valid()) showUpdate({ status: 'error', error: e.message }); }
    });
    $('#updInstall', el).addEventListener('click', async () => {
      try { if (!(await window.api.invoke('update:install'))) setStatus(t('settings.noDownload'), true); }
      catch (e) { setStatus(e.message, true); }
    });
  }

  function unmount() { life.clear(); offUpdate?.(); offUpdate = null; root = null; }

  Panel.register({ id: 'settings', title: () => T.t('module.settings'), icon: '⚙️', mount, unmount });
})();
