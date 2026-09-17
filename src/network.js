'use strict';
// Én avgrenset nettoperasjon, inkludert lesing av svaret. Retry avgjøres av kalleren.
const { t } = require('./i18n');
const LIMITS = Object.freeze({ apiMs: 20000, transferMs: 120000, aiFirstByteMs: 120000, aiIdleMs: 60000, aiTotalMs: 900000, gw2TotalMs: 90000 });

function failure(code) {
  const e = new Error(t(code === 'ABORT_ERR' ? 'network.cancelled' : 'network.timeout'));
  e.name = code === 'ABORT_ERR' ? 'AbortError' : 'TimeoutError'; e.code = code;
  return e;
}

function scope({ signal, timeoutMs = LIMITS.apiMs, firstByteMs = 0, idleMs = 0 } = {}) {
  const controller = new AbortController();
  let totalTimer, activityTimer, rejectAbort;
  const interrupted = new Promise((_, reject) => { rejectAbort = reject; });
  // Avbrytelse kan skje før første wait(). Unngå en ubehandlet rejection i mellomtiden.
  interrupted.catch(() => {});
  const abort = (code) => { if (!controller.signal.aborted) { const e = failure(code); controller.abort(e); rejectAbort(e); } };
  const cancel = () => abort('ABORT_ERR');
  if (signal?.aborted) cancel(); else signal?.addEventListener('abort', cancel, { once: true });
  if (timeoutMs > 0) totalTimer = setTimeout(() => abort('TIMEOUT'), timeoutMs);
  if (firstByteMs > 0) activityTimer = setTimeout(() => abort('TIMEOUT'), firstByteMs);
  const wait = (promise) => Promise.race([promise, interrupted]);
  const touch = () => { clearTimeout(activityTimer); if (idleMs > 0) activityTimer = setTimeout(() => abort('TIMEOUT'), idleMs); };
  async function* chunks(body) {
    if (!body) return;
    const reader = typeof body.getReader === 'function' ? body.getReader() : null;
    const iterator = reader ? null : body[Symbol.asyncIterator]();
    let ended = false;
    try {
      while (true) {
        const part = await wait(reader ? reader.read() : iterator.next());
        if (part.done) { ended = true; break; }
        if (part.value?.byteLength || part.value?.length) touch();
        yield part.value;
      }
    } finally {
      if (!ended) {
        // Ikke vent på en ekstern leser som selv har hengt seg. Feil konsumeres.
        try { Promise.resolve(reader ? reader.cancel() : iterator.return?.()).catch(() => {}); } catch { /* allerede lukket */ }
      }
      try { reader?.releaseLock(); } catch { /* lesing avbrutt */ }
    }
  }
  return { signal: controller.signal, wait, chunks, touch, dispose() { clearTimeout(totalTimer); clearTimeout(activityTimer); signal?.removeEventListener('abort', cancel); } };
}

async function request(url, init = {}, options = {}, consume = (res) => res.json()) {
  const task = scope({ ...options, signal: options.signal || init.signal });
  let res;
  try {
    task.signal.throwIfAborted();
    const fetchImpl = options.fetchImpl || globalThis.fetch;
    res = await task.wait(Promise.resolve().then(() => fetchImpl(url, { ...init, signal: task.signal })).then((response) => {
      // En egendefinert fetch kan ignorere signalet og levere etter tidsgrensen.
      if (task.signal.aborted) { discard(response); throw task.signal.reason; }
      return response;
    }));
    return await task.wait(Promise.resolve().then(() => consume(res, task)));
  } catch (e) {
    if (task.signal.aborted) throw task.signal.reason;
    throw e;
  } finally {
    task.dispose();
    discard(res);
  }
}

function discard(res) {
  if (res?.body && !res.body.locked) { try { Promise.resolve(res.body.cancel()).catch(() => {}); } catch { /* lest/lukket */ } }
}

function delay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(failure('ABORT_ERR'));
    const cancel = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); reject(failure('ABORT_ERR')); };
    const timer = setTimeout(() => { signal?.removeEventListener('abort', cancel); resolve(); }, ms);
    signal?.addEventListener('abort', cancel, { once: true });
  });
}

module.exports = { request, delay, failure, LIMITS };
