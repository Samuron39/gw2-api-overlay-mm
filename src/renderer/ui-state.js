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
  const api = { lifecycle, number, requestId };
  if (typeof module === 'object' && module.exports) module.exports = api;
  else target.UiState = api;
})(globalThis);
