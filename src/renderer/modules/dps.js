'use strict';
// DPS-modul (renderer): viser resultat fra ArcDPS-logger. Post-fight: ArcDPS skriver loggen når kampen er over.
(() => {
  const { $, esc, setStatus } = Panel;
  const t = (k, v) => T.t(k, v);
  let root = null;
  const life = Panel.lifecycle();
  let scope = null;
  let logs = [];
  let selected = null;
  let offNew = null;
  let offLive = null;
  let liveSnap = null;
  let dir = '';
  let exists = false;

  const template = () => `
    <div class="toolbar">
      <span class="muted" id="dpsDir"></span>
      <div class="spacer"></div>
      <button id="dpsInfoBtn" title="${esc(t('dps.howTitle'))}">${esc(t('dps.how'))}</button>
      <button id="dpsRefresh">${esc(t('dps.refreshList'))}</button>
    </div>
    <div class="dps-live" id="dpsLive"></div>
    <div id="dpsInfo" class="dps-info" hidden>
      <h4>${esc(t('dps.howTitle'))}</h4>
      <p>${t('dps.intro')}</p>
      <ol>
        <li>${t('dps.step1')}</li>
        <li>${t('dps.step2')}</li>
        <li>${t('dps.step3')}</li>
      </ol>
      <div id="arcStatus" class="muted">${esc(t('dps.checking'))}</div>
      <div class="row" style="margin-top:6px">
        <button id="arcInstall" class="primary">${esc(t('dps.install'))}</button>
        <button id="arcCheck">${esc(t('dps.recheck'))}</button>
      </div>
    </div>
    <div class="dps-wrap">
      <div class="dps-logs" id="dpsLogs"></div>
      <div class="dps-detail" id="dpsDetail"><div class="empty">${esc(t('dps.pickLog'))}</div></div>
    </div>`;

  async function mount(el) {
    scope = life.start();
    const mounted = scope;
    const setStatus = (...args) => { if (mounted.valid()) Panel.setStatus(...args); };
    root = el;
    el.innerHTML = template();
    $('#dpsRefresh', el).addEventListener('click', refresh);
    $('#dpsInfoBtn', el).addEventListener('click', () => { const box = $('#dpsInfo', root); box.hidden = !box.hidden; if (!box.hidden) arcStatus(); });
    $('#arcCheck', el).addEventListener('click', arcStatus);
    $('#arcInstall', el).addEventListener('click', async () => {
      const btn = $('#arcInstall', root);
      btn.disabled = true; $('#arcStatus', root).textContent = t('dps.downloading');
      try {
        const r = await window.api.invoke('arc:install');
        if (mounted.valid()) $('#arcStatus', root).textContent = t('dps.installed', { target: r.target, kb: Math.round(r.size / 1024), md5: r.md5.slice(0, 8) });
      } catch (e) { if (mounted.valid()) $('#arcStatus', root).textContent = t('common.error', { message: e.message }); }
      finally { if (mounted.valid()) btn.disabled = false; }
    });
    let receivedLive = false;
    offLive = scope.on('live:state', (s) => { receivedLive = true; liveSnap = s; renderLive(); });
    window.api.invoke('live:get').then((s) => { if (mounted.valid() && !receivedLive) { liveSnap = s; renderLive(); } }).catch(() => {});
    $('#dpsLive', el).addEventListener('click', async (e) => {
      if (e.target.id === 'dpsResetSession') {
        try { await window.api.invoke('live:resetSession'); setStatus(t('dps.live.sessionReset')); } catch (err) { setStatus(err.message, true); }
        return;
      }
      if (e.target.id !== 'dpsLiveWin') return;
      try { await window.api.invoke('overlays:set', 'dps', { enabled: true, locked: false }); setStatus(t('dps.live.opened')); }
      catch (err) { setStatus(t('common.error', { message: err.message }), true); }
    });
    offNew = scope.on('dps:new', (r) => {
      setStatus(t('dps.newFight', { boss: r.boss, dur: fmtDur(r.durationMs) }));
      selected = r;
      refresh();
    });
    await refresh();
  }

  function unmount() { life.clear(); offNew?.(); offNew = null; offLive?.(); offLive = null; root = null; }

  // Live-kortet: pågående kamp fra broen (sanntid), ellers forrige kamp
  const k = (n) => { n = Math.round(n || 0); return n >= 10000 ? (n / 1000).toFixed(1) + 'k' : String(n); };
  function renderLive() {
    if (!root) return;
    const el = $('#dpsLive', root);
    const d = liveSnap?.dps;
    if (!liveSnap?.connected) { el.innerHTML = `<span class="muted">${esc(t('dps.live.noBridge'))}</span>`; return; }
    const f = d?.current || d?.last;
    const head = d?.current ? t('dps.live.now', { dps: k(d.current.dps10) }) : t('dps.live.lastTitle');
    const body = f ? t('dps.live.line', { dur: fmtDur(f.durationMs), avg: k(f.dps), total: k(f.total), taken: k(f.taken), target: f.target || '–' }) : t('dps.live.noFight');
    const skills = f?.skills?.length ? ' · ' + f.skills.slice(0, 3).map((s) => `${esc(s.name || s.skill)} ${s.pct}%`).join(', ') : '';
    // Squad-DPS: «squad: Navn 12.3k (34 %), …» når flere enn deg har gjort skade
    const squad = f?.squad?.length > 1 ? ' · ' + esc(t('dps.live.squad', { list: f.squad.slice(0, 5).map((p) => `${p.name || '?'} ${k(p.dmg)} (${p.pct} %)`).join(', ') })) : '';
    // Mottatt per kilde (minions tilskrevet eieren): «mottatt: Kilde 3.1k (40 %), …»
    const taken = f?.takenBySource?.length ? ` · <span class="tk">${esc(t('dps.live.takenBy', { list: f.takenBySource.slice(0, 3).map((s) => `${s.name || s.id || '?'} ${k(s.dmg)} (${s.pct} %)`).join(', ') }))}</span>` : '';
    // Dødsloggen (frosset kopi av de siste treffene da du gikk ned/døde), som liten liste under kortet
    let death = '';
    if (d?.death) {
      const x = d.death;
      const when = x.at ? new Date(x.at).toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' }) : '';
      const hits = x.hits.slice().reverse().slice(0, 6).map((h) => `${h.name || h.skill} ${k(h.amount)}`).join(', ');
      death = `<ul class="death"><li><b>${esc(t(x.downed ? 'dps.live.downedAt' : 'dps.live.diedAt', { when }))}</b> · ${esc(x.killer || '?')}${hits ? ' · ' + esc(t('dps.live.lastHits', { hits })) : ''}</li></ul>`;
    }
    // Healing (HPS) når broen leverer det og noe er healet: «healing 12.3k (HPS 890)». Nå-verdi i kamp, snitt etterpå.
    const h = f?.healing;
    const healing = h?.available && h.done ? ' · ' + esc(t('dps.live.healing', { total: k(h.done), hps: k(d?.current ? h.hps10 : h.hps) })) : '';
    // Hele økta: alle kamper siden appen startet eller siste nullstilling
    const se = d?.session;
    const session = se?.fights ? `<div class="session muted">${esc(t('dps.live.session', { fights: se.fights, dur: fmtDur(se.combatMs), total: k(se.total), dps: k(se.dps) }))}${se.healing?.done ? ' · ' + esc(t('dps.live.healing', { total: k(se.healing.done), hps: k(se.healing.hps) })) : ''} <button id="dpsResetSession" class="small">${esc(t('dps.live.resetSession'))}</button></div>` : '';
    el.innerHTML = `<b class="${d?.current ? 'up' : ''}">${esc(head)}</b> <span class="muted">${esc(body)}${skills}${healing}${squad}${taken}</span> <button id="dpsLiveWin" class="small">${esc(t('dps.live.window'))}</button>${death}${session}`;
  }

  async function arcStatus() {
    if (!root) return;
    const valid = scope.request('arc');
    const el = $('#arcStatus', root), btn = $('#arcInstall', root);
    el.textContent = t('dps.checking');
    try {
      const s = await window.api.invoke('arc:status');
      if (!valid()) return;
      if (!s.validDir) { el.textContent = t('dps.noGameDir'); btn.disabled = true; return; }
      btn.disabled = false;
      const parts = [t('dps.gameDir', { dir: s.gw2Dir })];
      if (!s.installed) { parts.push(t('dps.notInstalled')); btn.textContent = t('dps.install'); }
      else if (s.updateAvailable) { parts.push(t('dps.updateAvailable')); btn.textContent = t('dps.update'); }
      else if (s.remoteMd5) { parts.push(t('dps.upToDate')); btn.textContent = t('dps.reinstall'); }
      else { parts.push(t('dps.installedPlain')); btn.textContent = t('dps.reinstall'); }
      if (s.running) parts.push(t('dps.gameRunning'));
      if (s.error) parts.push(t('dps.checkFailed', { error: s.error }));
      el.textContent = parts.join(' ');
    } catch (e) { if (valid()) el.textContent = t('common.error', { message: e.message }); }
  }

  function fmtDur(ms) { const s = Math.round(ms / 1000); return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`; }
  function fmtNum(n) { return Math.round(n).toLocaleString(T.locale); }
  function fmtWhen(ms) { const d = new Date(ms); return d.toLocaleDateString(T.locale, { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString(T.locale, { hour: '2-digit', minute: '2-digit' }); }

  async function refresh() {
    const valid = scope.request('refresh');
    try {
      const r = await window.api.invoke('dps:list');
      if (!valid()) return;
      dir = r.dir; exists = r.exists; logs = r.logs;
    } catch (e) { if (valid()) setStatus(t('common.error', { message: e.message }), true); return; }
    if (!valid()) return;
    $('#dpsDir', root).textContent = exists ? t('dps.logDir', { dir }) : t('dps.logDirMissing', { dir });
    renderLogs();
    if (selected) renderDetail(selected);
    else if (logs.length) select(logs[0].file);
  }

  function renderLogs() {
    const list = $('#dpsLogs', root);
    if (!logs.length) { list.innerHTML = `<div class="empty">${esc(t('dps.noLogs'))}</div>`; return; }
    list.innerHTML = logs.map((l) => `<button class="dps-log ${selected?.file === l.file ? 'active' : ''}" data-file="${esc(l.file)}">
      <b>${esc(l.folder)}</b><br><span class="muted">${fmtWhen(l.mtime)} · ${Math.round(l.size / 1024)} kB</span></button>`).join('');
    list.querySelectorAll('.dps-log').forEach((b) => b.addEventListener('click', () => select(b.dataset.file)));
  }

  async function select(file) {
    const valid = scope.request('parse');
    $('#dpsDetail', root).innerHTML = `<div class="empty">${esc(t('dps.reading'))}</div>`;
    try {
      const result = await window.api.invoke('dps:parse', file);
      if (!valid()) return;
      selected = result;
      renderLogs();
      renderDetail(selected);
    } catch (e) { if (valid()) $('#dpsDetail', root).innerHTML = `<div class="empty">${esc(t('dps.readFailed', { message: e.message }))}</div>`; }
  }

  function renderDetail(r) {
    const mounted = scope;
    const setStatus = (...args) => { if (mounted?.valid()) Panel.setStatus(...args); };
    if (!root) return;
    const max = Math.max(1, ...r.players.map((p) => p.dpsTarget || p.dpsAll));
    const useTarget = r.players.some((p) => p.dpsTarget > 0);
    const outcome = r.success ? t('dps.victory') : (r.bossHpEnd != null ? t('dps.wipe', { pct: r.bossHpEnd.toFixed(1) }) : t('dps.unknownOutcome'));
    $('#dpsDetail', root).innerHTML = `
      <div class="dps-head">
        <h3>${esc(r.boss)} <span class="badge ${r.success ? 'tp' : 'vendor'}">${esc(outcome)}</span></h3>
        <div class="muted">${fmtWhen(r.when)} · ${esc(t('dps.duration', { dur: fmtDur(r.durationMs) }))} · ${esc(T.tn('dps.players', r.players.length))} · ${esc(t('dps.total', { n: fmtNum(useTarget ? r.totalDpsTarget : r.totalDpsAll) }))} ${useTarget ? esc(t('dps.vsBoss')) : ''}
          · <button id="dpsUpload" class="small" title="${esc(t('dps.uploadTitle'))}">${esc(t('dps.upload'))}</button></div>
      </div>
      <table class="dps-table">
        <thead><tr><th>#</th><th>${esc(t('dps.col.player'))}</th><th>${esc(t('dps.col.spec'))}</th><th>${esc(t('dps.col.group'))}</th><th class="num">${esc(t(useTarget ? 'dps.col.dpsBoss' : 'dps.col.dps'))}</th><th class="num">${esc(t('dps.col.dpsAll'))}</th><th class="num">${esc(t('dps.col.damage'))}</th><th class="num" title="${esc(t('dps.col.quickTitle'))}">Quick</th><th class="num" title="${esc(t('dps.col.alacTitle'))}">Alac</th><th class="num" title="${esc(t('dps.col.furyTitle'))}">Fury</th><th style="width:25%"></th></tr></thead>
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
      <p class="muted small">${esc(t('dps.footnote'))}</p>`;
    const up = $('#dpsUpload', root);
    if (up) up.addEventListener('click', async () => {
      up.disabled = true; setStatus(t('dps.uploading'));
      try { const res = await window.api.invoke('dps:upload', r.file); setStatus(t('dps.uploaded', { url: res.permalink })); window.api.invoke('open:url', res.permalink); }
      catch (e) { setStatus(t('dps.uploadFailed', { message: e.message }), true); }
      finally { up.disabled = false; }
    });
  }

  Panel.register({ id: 'dps', title: () => T.t('module.dps'), icon: '⚔️', mount, unmount });
})();
