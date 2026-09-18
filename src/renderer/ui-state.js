'use strict';
// Ren tilstand for renderer og Node-tester. En montering eier alle sine abonnementer og timere.
(function (target) {
  let nextRequest = 0;
  function lifecycle() {
    let current = null;
    const clear = () => { current?.dispose(); current = null; };
    function start() {
      clear();
      let active = true;
      const cleanup = new Set(), requests = new Map();
      const scope = {
        valid: () => active && current === scope,
        own(off) { if (!active) off?.(); else if (off) cleanup.add(off); return off; },
        request(key) { const id = Symbol(key); requests.set(key, id); return () => scope.valid() && requests.get(key) === id; },
        on(channel, callback) { return scope.own(window.api.on(channel, (...args) => { if (scope.valid()) callback(...args); })); },
        interval(callback, ms) { const id = setInterval(() => { if (scope.valid()) callback(); }, ms); scope.own(() => clearInterval(id)); return id; },
        dispose() { if (!active) return; active = false; for (const off of cleanup) off(); cleanup.clear(); requests.clear(); },
      };
      current = scope;
      return scope;
    }
    return { start, clear, get current() { return current; } };
  }
  function number(value, fallback, min = -Infinity, max = Infinity) {
    const n = value == null || String(value).trim() === '' ? NaN : Number(value);
    return Number.isFinite(n) ? Math.max(min, Math.min(max, n)) : fallback;
  }
  const requestId = (kind) => `${kind}-${Date.now()}-${++nextRequest}`;
  async function saveConfig(patch, owner) {
    try { return await window.api.invoke('config:set', patch); }
    catch (e) {
      if (!owner || owner.valid()) Panel.setStatus(T.t('settings.saveFailed', { error: e.message }), true);
      return null;
    }
  }
  // ---------- Synlig kvittering ved knappen ----------
  // Eieren trykket «Installer broen» og så ingen endring: resultatet sto bare i den grå statuslinja øverst i panelet.
  // note() skriver i et eget felt (.act-note) rett ved knappen: work = spinner (+ fremdriftslinje når pct er et tall),
  // ok = grønn hake, info = nøytral (ingenting å gjøre), err = rød. Tom kind tømmer feltet.
  const escNote = (s) => String(s ?? '').replace(/[&<>"]/g, (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[ch]));
  const NOTE_ICON = { ok: '✓', info: 'ℹ', err: '✕' };
  function note(el, kind, text, pct) {
    if (!el) return;
    el.className = 'act-note' + (kind ? ' ' + kind : '');
    if (!kind) { el.innerHTML = ''; return; }
    const lead = kind === 'work' ? '<span class="act-spin"></span>' : `<span class="act-icon">${NOTE_ICON[kind] || ''}</span>`;
    const bar = kind === 'work' && Number.isFinite(pct) ? `<span class="act-bar"><i style="width:${Math.max(0, Math.min(100, Math.round(pct)))}%"></i></span>` : '';
    el.innerHTML = `${lead}<span class="act-text">${escNote(text)}</span>${bar}`;
  }
  // Kjører run() med knappen låst og kvittering i opts.note. done: tekst, eller funksjon av resultatet som gir tekst eller
  // { kind, text }. owner (lifecycle-scope): er fanen byttet i mellomtida, røres ikke DOM-en. flash: element som får et
  // kort grønt blink når det gikk bra. Returnerer { ok, value, error } og kaster aldri.
  async function busy(btn, run, opts = {}) {
    const alive = () => !opts.owner || opts.owner.valid();
    if (btn) { btn.disabled = true; btn.classList.add('is-busy'); }
    opts.flash?.classList.remove('flash-ok');
    note(opts.note, 'work', opts.working || '');
    let out;
    try { out = { ok: true, value: await run() }; }
    catch (error) { out = { ok: false, error }; }
    if (!alive()) return out;
    if (btn) { btn.disabled = false; btn.classList.remove('is-busy'); }
    if (out.ok) {
      const d = typeof opts.done === 'function' ? opts.done(out.value) : opts.done;
      const res = d && typeof d === 'object' ? d : { kind: 'ok', text: d || '' };
      note(opts.note, res.kind || 'ok', res.text);
      if ((res.kind || 'ok') === 'ok') opts.flash?.classList.add('flash-ok');
    } else note(opts.note, 'err', T.t('common.error', { message: out.error?.message || String(out.error) }));
    return out;
  }
  // arc:progress fra hovedprosessen -> tekst og fremdriftslinje i kvitteringsfeltet
  function arcProgress(el, p) {
    if (!el || !p) return;
    const kb = (n) => Math.round((n || 0) / 1024);
    if (p.phase === 'download') {
      if (p.total > 0) note(el, 'work', T.t('arc.progress.download', { pct: Math.round(p.received / p.total * 100), kb: kb(p.received), total: kb(p.total) }), p.received / p.total * 100);
      else note(el, 'work', T.t('arc.progress.downloadUnknown', { kb: kb(p.received) }));
    } else if (p.phase === 'verify') note(el, 'work', T.t('arc.progress.verify', { s: Math.ceil((p.left || 0) / 1000) }), p.ms > 0 ? (1 - p.left / p.ms) * 100 : undefined);
    else if (p.phase === 'bridge') note(el, 'work', T.t('arc.progress.bridge'));
  }
  const api = { lifecycle, number, requestId, saveConfig, note, busy, arcProgress };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else target.UiState = api;
})(globalThis);
