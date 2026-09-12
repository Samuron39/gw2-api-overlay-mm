'use strict';
// Innstillinger-modul (renderer).
(() => {
  const { $, esc, setStatus } = Panel;
  let root = null;
  let offUpdate = null;

  const TEMPLATE = `
    <div class="settings">
      <h3>Guild Wars 2</h3>
      <label>API-nøkkel <input id="apiKey" type="password" placeholder="Lim inn nøkkel fra account.arena.net/applications" /></label>
      <p class="muted">Nøkkelen trenger tillatelsene <b>account</b>, <b>inventories</b>, <b>characters</b> og <b>wallet</b>. <a href="#" id="apiLink">Åpne ArenaNet-siden</a>. Når du lagrer en ny nøkkel hentes inventory automatisk. Senere bruker du Oppdater-knappen på Inventory-fanen.</p>

      <h3>Lokal AI (LM Studio)</h3>
      <label>Server-URL <input id="lmUrl" type="text" /></label>
      <label>Modell <span class="row"><select id="lmModel"></select><button id="modelsBtn" type="button">Hent modeller</button></span></label>
      <p class="muted">Last modellen med 16k kontekst, ikke maks, ellers fyller KV-cachen skjermkortet. Gemma 4 12B (6,7 GB) passer ved siden av spillet.</p>

      <h3>Inventory-regler</h3>
      <label>Materiallager-kapasitet per item <input id="materialCap" type="number" min="250" step="250" /></label>
      <label>Minste TP-verdi per stack som er verdt bryet (kobber) <input id="minTp" type="number" min="0" step="10" /></label>
      <label>Behold-liste (ett navn eller delnavn per linje) <textarea id="keepList" rows="8"></textarea></label>

      <h3>Spillet og ArcDPS</h3>
      <label>Spillmappe (der Gw2-64.exe ligger)
        <span class="row"><input id="gw2Dir" type="text" placeholder="C:\\Guild Wars 2" /><button id="gw2Detect" type="button">Søk</button><button id="gw2Pick" type="button">Velg mappe</button></span>
      </label>
      <p class="muted small">Brukes til å installere og oppdatere ArcDPS fra DPS-modulen (knappen «Slik virker det»).</p>
      <label class="inline"><input type="checkbox" id="followGame" /> Vis overlayen bare når spillet kjører. Sammen med «Start med Windows» starter overlayen i praksis sammen med spillet, og ligger ellers i systemstatusfeltet.</label>
      <label>ArcDPS-loggmappe <input id="dpsLogDir" type="text" placeholder="" /></label>
      <p class="muted">Tom = standardmappa <span id="dpsDefault"></span>. ArcDPS må ha logging slått på (Alt+Shift+T, Logging).</p>

      <h3>Moduler på hjulet</h3>
      <div id="modList" class="dy-list"></div>
      <p class="muted small">Innstillinger er alltid med. Endringen slår inn med en gang, både på hjulet og som faner i panelet.</p>

      <h3>Overlay</h3>
      <label>Hjulstørrelse (px, krever omstart) <input id="wheelSize" type="number" min="140" max="320" step="10" /></label>
      <label class="inline"><input type="checkbox" id="autoHide" /> Skjul overlayen når verken spillet eller overlayen har fokus (alt-tab)</label>
      <label class="inline"><input type="checkbox" id="launchAtStartup" /> Start overlayen sammen med Windows</label>
      <p class="muted small">Hjulet slipper klikk gjennom de gjennomsiktige områdene, så det stjeler ikke klikk fra spillet. Ctrl+Shift+G viser eller skjuler panelet.</p>

      <h3>Oppdatering</h3>
      <p class="muted">Installert versjon: <b id="updVersion"></b></p>
      <label class="inline"><input type="checkbox" id="autoUpdate" /> Sjekk automatisk ved oppstart og hver 6. time</label>
      <p class="muted small">Ny versjon lastes ned i bakgrunnen og installeres når du avslutter overlayen, eller med en gang med knappen under.</p>
      <div class="row">
        <button id="updCheck" type="button">Sjekk for oppdatering</button>
        <button id="updInstall" type="button" class="primary" style="display:none">Installer og start på nytt</button>
        <span id="updStatus" class="muted small"></span>
      </div>
      <p class="muted small">Oppdateringer hentes fra GitHub Releases for prosjektet. Innstillingene dine beholdes.</p>

      <div class="row">
        <button id="saveBtn" class="primary">Lagre</button>
        <button id="quitBtn">Avslutt overlay</button>
      </div>
      <p class="muted small">Konfig lagres i <span id="cfgPath"></span>. <span id="cfgErr" class="status error"></span></p>
    </div>`;

  function fillModels(list, selected) {
    const sel = $('#lmModel', root);
    sel.innerHTML = list.length ? list.map((id) => `<option value="${esc(id)}" ${id === selected ? 'selected' : ''}>${esc(id)}</option>`).join('') : '<option value="">(trykk Hent modeller)</option>';
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
    $('#autoHide', root).checked = !!c.autoHide;
    $('#launchAtStartup', root).checked = !!c.launchAtStartup;
    const ALL = [['inventory', '🎒 Inventory'], ['daily', '📅 I dag'], ['timers', '⏱️ Tidsplan'], ['tp', '💰 Trading Post'], ['dps', '⚔️ DPS'], ['live', '⚡ Live'], ['characters', '🧙 Karakterer'], ['guild', '🏰 Guild']];
    const on = c.wheelModules;
    $('#modList', root).innerHTML = ALL.map(([id, label]) => `<label class="dy-item inline"><input type="checkbox" class="modToggle" value="${id}" ${!on || on.includes(id) ? 'checked' : ''} /> ${label}</label>`).join('');
    $('#cfgPath', root).textContent = c.configPath || '';
    $('#cfgErr', root).textContent = c.lastSaveError ? 'Siste lagring feilet: ' + c.lastSaveError : '';
    $('#autoUpdate', root).checked = c.autoUpdate !== false;
    $('#updVersion', root).textContent = c.appVersion || '';
    fillModels([c.lmModel].filter(Boolean), c.lmModel);
  }

  // Oppdateringsstatus fra hovedprosessen (update:status) eller svaret på en manuell sjekk
  function updateText(s) {
    if (!s) return '';
    const v = s.version ? ` (${s.version})` : '';
    switch (s.status) {
      case 'dev': return 'Oppdatering er bare tilgjengelig i den installerte versjonen.';
      case 'checking': return 'Sjekker…';
      case 'available': return `Ny versjon${v} funnet, laster ned…`;
      case 'not-available': return 'Du har nyeste versjon.';
      case 'downloading': return `Laster ned${v}: ${s.percent || 0} %`;
      case 'downloaded': return `Versjon${v} er lastet ned og klar til å installeres.`;
      case 'error': return 'Feil ved oppdatering: ' + (s.error || 'ukjent');
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
    el.innerHTML = TEMPLATE;
    fill(Panel.config);
    $('#apiLink', el).addEventListener('click', (e) => { e.preventDefault(); window.api.invoke('open:url', 'https://account.arena.net/applications'); });
    $('#modelsBtn', el).addEventListener('click', async () => {
      try {
        await window.api.invoke('config:set', { lmUrl: $('#lmUrl', root).value.trim() });
        const models = await window.api.invoke('ai:models');
        fillModels(models, $('#lmModel', root).value || Panel.config.lmModel || models[0]);
        setStatus(`Fant ${models.length} modeller i LM Studio.`);
      } catch (e) { setStatus('Kunne ikke hente modeller: ' + e.message, true); }
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
        autoHide: $('#autoHide', root).checked,
        launchAtStartup: $('#launchAtStartup', root).checked,
        autoUpdate: $('#autoUpdate', root).checked,
        wheelModules: [...root.querySelectorAll('.modToggle')].filter((cb) => cb.checked).map((cb) => cb.value),
      };
      const prevKey = Panel.config?.apiKey || '';
      Panel.config = await window.api.invoke('config:set', patch);
      $('#cfgErr', root).textContent = Panel.config.lastSaveError ? 'Siste lagring feilet: ' + Panel.config.lastSaveError : '';
      if (Panel.config.lastSaveError) { setStatus('Kunne ikke skrive konfigfila: ' + Panel.config.lastSaveError, true); return; }
      if (patch.apiKey && patch.apiKey !== prevKey) {
        setStatus('Innstillinger lagret. Henter inventory…');
        window.api.invoke('panel:show', 'inventory');
      } else if (patch.apiKey) {
        setStatus('Innstillinger lagret. Trykk Oppdater på Inventory-fanen for å hente på nytt.');
      } else {
        setStatus('Innstillinger lagret.');
      }
    });
    $('#quitBtn', el).addEventListener('click', () => window.api.invoke('app:quit'));
    $('#gw2Detect', el).addEventListener('click', async () => {
      const d = await window.api.invoke('gw2:detectDir');
      if (d) { $('#gw2Dir', root).value = d; setStatus(`Fant spillet i ${d}. Trykk Lagre.`); } else setStatus('Fant ikke Gw2-64.exe automatisk. Bruk «Velg mappe».', true);
    });
    $('#gw2Pick', el).addEventListener('click', async () => {
      try { const d = await window.api.invoke('gw2:pickDir'); if (d) { $('#gw2Dir', root).value = d; setStatus('Mappe valgt. Trykk Lagre.'); } }
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
      try { if (!(await window.api.invoke('update:install'))) setStatus('Ingen nedlastet oppdatering å installere.', true); }
      catch (e) { setStatus(e.message, true); }
    });
  }

  function unmount() { offUpdate?.(); offUpdate = null; root = null; }

  Panel.register({ id: 'settings', title: 'Innstillinger', icon: '⚙️', mount, unmount });
})();
