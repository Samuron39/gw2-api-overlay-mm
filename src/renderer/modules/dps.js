'use strict';
// DPS-modul (renderer): viser resultat fra ArcDPS-logger. Post-fight: ArcDPS skriver loggen når kampen er over.
(() => {
  const { $, esc, setStatus } = Panel;
  let root = null;
  let logs = [];
  let selected = null;
  let offNew = null;
  let dir = '';
  let exists = false;

  const TEMPLATE = `
    <div class="toolbar">
      <span class="muted" id="dpsDir"></span>
      <div class="spacer"></div>
      <button id="dpsInfoBtn" title="Slik virker DPS-modulen">Slik virker det</button>
      <button id="dpsRefresh">Oppdater liste</button>
    </div>
    <div id="dpsInfo" class="dps-info" hidden>
      <h4>Slik virker DPS-modulen</h4>
      <p>Guild Wars 2 har ingen kamp-API. Det eneste verktøyet ArenaNet tolererer for å lese kampdata er <b>ArcDPS</b>, som viser live DPS i sitt eget vindu inne i spillet og skriver en logg når kampen er over. Denne modulen leser de loggene og gir deg skade per spiller, boon-uptime, sammenligning og opplasting til dps.report. Tallene kommer noen sekunder etter at kampen er ferdig, ikke underveis.</p>
      <ol>
        <li>Installer ArcDPS med knappen under. Appen laster ned fila fra utgiverens offisielle adresse, sjekker sjekksummen og legger den i spillmappa. ArcDPS kan ikke pakkes med appen, utgiveren tillater ikke det, og fila må oppdateres ved hver spillpatch.</li>
        <li>Start spillet. Trykk <b>Alt+Shift+T</b> for ArcDPS-menyen, gå til fanen <b>Logging</b> og huk av for logging. Det gjøres én gang.</li>
        <li>Slåss. Loggen havner i <code>Dokumenter\\Guild Wars 2\\addons\\arcdps\\arcdps.cbtlogs</code>, og dukker opp her automatisk.</li>
      </ol>
      <div id="arcStatus" class="muted">Sjekker ArcDPS…</div>
      <div class="row" style="margin-top:6px">
        <button id="arcInstall" class="primary">Installer ArcDPS</button>
        <button id="arcCheck">Sjekk på nytt</button>
      </div>
    </div>
    <div class="dps-wrap">
      <div class="dps-logs" id="dpsLogs"></div>
      <div class="dps-detail" id="dpsDetail"><div class="empty">Velg en logg, eller vent på neste kamp.</div></div>
    </div>`;

  async function mount(el) {
    root = el;
    el.innerHTML = TEMPLATE;
    $('#dpsRefresh', el).addEventListener('click', refresh);
    $('#dpsInfoBtn', el).addEventListener('click', () => { const box = $('#dpsInfo', root); box.hidden = !box.hidden; if (!box.hidden) arcStatus(); });
    $('#arcCheck', el).addEventListener('click', arcStatus);
    $('#arcInstall', el).addEventListener('click', async () => {
      const btn = $('#arcInstall', root);
      btn.disabled = true; $('#arcStatus', root).textContent = 'Laster ned og verifiserer…';
      try {
        const r = await window.api.invoke('arc:install');
        if (root) $('#arcStatus', root).textContent = `Installert: ${r.target} (${Math.round(r.size / 1024)} kB, md5 ${r.md5.slice(0, 8)}…). Start spillet og slå på logging med Alt+Shift+T.`;
      } catch (e) { if (root) $('#arcStatus', root).textContent = 'Feil: ' + e.message; }
      finally { if (root) btn.disabled = false; }
    });
    offNew = window.api.on('dps:new', (r) => {
      setStatus(`Ny kamp logget: ${r.boss} (${fmtDur(r.durationMs)})`);
      selected = r;
      refresh();
    });
    await refresh();
  }

  function unmount() { offNew?.(); offNew = null; root = null; }

  async function arcStatus() {
    if (!root) return;
    const el = $('#arcStatus', root), btn = $('#arcInstall', root);
    el.textContent = 'Sjekker ArcDPS…';
    try {
      const s = await window.api.invoke('arc:status');
      if (!root) return;
      if (!s.validDir) { el.textContent = 'Fant ikke spillmappa. Velg mappa med Gw2-64.exe under Innstillinger.'; btn.disabled = true; return; }
      btn.disabled = false;
      const parts = [`Spillmappe: ${s.gw2Dir}.`];
      if (!s.installed) { parts.push('ArcDPS er ikke installert.'); btn.textContent = 'Installer ArcDPS'; }
      else if (s.updateAvailable) { parts.push('ArcDPS er installert, men en nyere versjon finnes.'); btn.textContent = 'Oppdater ArcDPS'; }
      else if (s.remoteMd5) { parts.push('ArcDPS er installert og oppdatert.'); btn.textContent = 'Installer på nytt'; }
      else { parts.push('ArcDPS er installert.'); btn.textContent = 'Installer på nytt'; }
      if (s.running) parts.push('Spillet kjører, avslutt det før du installerer.');
      if (s.error) parts.push('Kunne ikke sjekke ny versjon: ' + s.error);
      el.textContent = parts.join(' ');
    } catch (e) { el.textContent = 'Feil: ' + e.message; }
  }

  function fmtDur(ms) { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; }
  function fmtNum(n) { return Math.round(n).toLocaleString('nb-NO'); }
  function fmtWhen(ms) { const d = new Date(ms); return d.toLocaleDateString('nb-NO', { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString('nb-NO', { hour: '2-digit', minute: '2-digit' }); }

  async function refresh() {
    try {
      const r = await window.api.invoke('dps:list');
      dir = r.dir; exists = r.exists; logs = r.logs;
    } catch (e) { setStatus('Feil: ' + e.message, true); return; }
    if (!root) return;
    $('#dpsDir', root).textContent = exists ? `Loggmappe: ${dir}` : `Fant ikke loggmappa ${dir}. Installer ArcDPS og slå på logging, eller sett mappa under Innstillinger.`;
    renderLogs();
    if (selected) renderDetail(selected);
    else if (logs.length) select(logs[0].file);
  }

  function renderLogs() {
    const list = $('#dpsLogs', root);
    if (!logs.length) { list.innerHTML = '<div class="empty">Ingen logger ennå.</div>'; return; }
    list.innerHTML = logs.map((l) => `<button class="dps-log ${selected?.file === l.file ? 'active' : ''}" data-file="${esc(l.file)}">
      <b>${esc(l.folder)}</b><br><span class="muted">${fmtWhen(l.mtime)} · ${Math.round(l.size / 1024)} kB</span></button>`).join('');
    list.querySelectorAll('.dps-log').forEach((b) => b.addEventListener('click', () => select(b.dataset.file)));
  }

  async function select(file) {
    $('#dpsDetail', root).innerHTML = '<div class="empty">Leser logg…</div>';
    try {
      selected = await window.api.invoke('dps:parse', file);
      renderLogs();
      renderDetail(selected);
    } catch (e) { $('#dpsDetail', root).innerHTML = `<div class="empty">Kunne ikke lese loggen: ${esc(e.message)}</div>`; }
  }

  function renderDetail(r) {
    if (!root) return;
    const max = Math.max(1, ...r.players.map((p) => p.dpsTarget || p.dpsAll));
    const useTarget = r.players.some((p) => p.dpsTarget > 0);
    $('#dpsDetail', root).innerHTML = `
      <div class="dps-head">
        <h3>${esc(r.boss)} <span class="badge ${r.success ? 'tp' : 'vendor'}">${r.success ? 'Seier' : (r.bossHpEnd != null ? 'Wipe ved ' + r.bossHpEnd.toFixed(1) + ' %' : 'Ukjent utfall')}</span></h3>
        <div class="muted">${fmtWhen(r.when)} · varighet ${fmtDur(r.durationMs)} · ${r.players.length} spillere · total ${fmtNum(useTarget ? r.totalDpsTarget : r.totalDpsAll)} DPS ${useTarget ? 'mot boss' : ''}
          · <button id="dpsUpload" class="small" title="Laster opp loggen til dps.report og åpner rapporten. Sender fila til en ekstern tjeneste.">Last opp til dps.report</button></div>
      </div>
      <table class="dps-table">
        <thead><tr><th>#</th><th>Spiller</th><th>Spec</th><th>Gr.</th><th class="num">DPS ${useTarget ? 'boss' : ''}</th><th class="num">DPS alt</th><th class="num">Skade</th><th class="num" title="Quickness-uptime">Quick</th><th class="num" title="Alacrity-uptime">Alac</th><th class="num" title="Fury-uptime">Fury</th><th style="width:25%"></th></tr></thead>
        <tbody>${r.players.map((p, i) => {
          const v = useTarget ? p.dpsTarget : p.dpsAll;
          const pct = (x) => x == null ? '' : Math.round(x * 100) + '%';
          return `<tr>
            <td>${i + 1}</td><td><b>${esc(p.name)}</b><br><span class="muted">${esc(p.account)}</span></td>
            <td class="prof-${esc(p.profession)}">${esc(p.spec)}</td><td>${esc(p.subgroup)}</td>
            <td class="num"><b>${fmtNum(v)}</b></td><td class="num">${fmtNum(p.dpsAll)}</td><td class="num">${fmtNum(useTarget ? p.dmgTarget : p.dmgAll)}</td>
            <td class="num muted">${pct(p.boons?.quickness)}</td><td class="num muted">${pct(p.boons?.alacrity)}</td><td class="num muted">${pct(p.boons?.fury)}</td>
            <td><div class="dps-bar prof-bg-${esc(p.profession)}" style="width:${Math.round(v / max * 100)}%"></div></td>
          </tr>`;
        }).join('')}</tbody>
      </table>
      <p class="muted small">Skade er direkte pluss condition mot fiender, kjæledyr og minions regnet til eieren. Boon-uptime er forenklet (uten stack-grense). Healing krever ArcDPS Healing Stats-addon og er ikke med ennå.</p>`;
    const up = $('#dpsUpload', root);
    if (up) up.addEventListener('click', async () => {
      up.disabled = true; setStatus('Laster opp til dps.report…');
      try { const res = await window.api.invoke('dps:upload', r.file); setStatus(`Lastet opp: ${res.permalink}`); window.api.invoke('open:url', res.permalink); }
      catch (e) { setStatus('Opplasting feilet: ' + e.message, true); }
      finally { up.disabled = false; }
    });
  }

  Panel.register({ id: 'dps', title: 'DPS', icon: '⚔️', mount, unmount });
})();
