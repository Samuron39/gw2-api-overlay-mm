'use strict';
// Asynkron loggindeks og begrenset worker-kø. Ingen EVTC-dekomprimering skjer i Electron-hovedtråden.
const fs = require('fs');
const path = require('path');
const { Worker } = require('worker_threads');
const LOG_RE = /\.z?evtc$/i;
const abortError = () => Object.assign(new Error('Operasjonen ble avbrutt'), { name: 'AbortError', code: 'ABORT_ERR' });
const checkAbort = signal => { if (signal?.aborted) throw abortError(); };
const fingerprint = st => `${st.mtimeMs}:${st.size}`;

function withSignal(promise, signal) {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const abort = () => reject(abortError());
    signal.addEventListener('abort', abort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener('abort', abort));
  });
}

class LogArchive {
  constructor(options = {}) {
    this.io = options.io || fs.promises;
    this.createWatcher = options.createWatcher || fs.watch;
    this.createWorker = options.createWorker || (() => new Worker(path.join(__dirname, 'evtc-worker.js'), { resourceLimits: { maxOldGenerationSizeMb: 256 } }));
    this.warn = options.warn || (() => {});
    this.ioConcurrency = options.ioConcurrency || 8;
    this.workerConcurrency = options.workerConcurrency || 2;
    this.queueLimit = options.queueLimit || 32;
    this.workerTimeoutMs = options.workerTimeoutMs || 30000;
    this.stableMs = options.stableMs ?? 2500;
    this.retryMs = options.retryMs ?? 1000;
    this.indexTtlMs = options.indexTtlMs ?? 5000;
    this.indexLimit = 2000;
    this.indexes = new Map();
    this.parsed = new Map();
    this.jobs = new Map();
    this.queue = [];
    this.active = 0;
    this.watching = null;
    this.closed = false;
  }

  async scan(dir, signal) {
    const dirs = [dir];
    let logs = [];
    const sort = () => logs.sort((a, b) => b.mtime - a.mtime || a.file.localeCompare(b.file));
    while (dirs.length) {
      checkAbort(signal);
      const groups = await Promise.all(dirs.splice(0, this.ioConcurrency).map(async d => {
        try { return [d, await this.io.readdir(d, { withFileTypes: true })]; }
        catch (e) { if (d === dir && !['ENOENT', 'ENOTDIR'].includes(e.code)) throw e; return [d, []]; }
      }));
      const files = [];
      for (const [d, entries] of groups) for (const e of entries) {
        const file = path.join(d, e.name);
        if (e.isSymbolicLink()) continue; // ikke følg junction/sløyfer ut av loggtreet
        if (e.isDirectory()) dirs.push(file);
        else if (e.isFile() && LOG_RE.test(e.name)) files.push({ file, name: e.name, folder: path.basename(d) });
      }
      for (let i = 0; i < files.length; i += this.ioConcurrency) {
        checkAbort(signal);
        await Promise.all(files.slice(i, i + this.ioConcurrency).map(async entry => {
          try { const st = await this.io.stat(entry.file); logs.push({ ...entry, mtime: st.mtimeMs, size: st.size }); } catch { /* slettet under skanning */ }
        }));
        if (logs.length > this.indexLimit * 2) { sort(); logs = logs.slice(0, this.indexLimit); }
      }
    }
    checkAbort(signal); sort();
    return logs.slice(0, this.indexLimit);
  }

  async listLogs(dir, limit = 40, { signal, force = false } = {}) {
    checkAbort(signal);
    if (this.closed) throw abortError();
    dir = path.resolve(dir);
    let entry = this.indexes.get(dir);
    if (entry?.controller?.signal.aborted) { this.indexes.delete(dir); entry = null; }
    if (!entry) {
      entry = { at: 0, logs: null, pending: null, revision: 0, clients: 0 };
      this.indexes.set(dir, entry);
      if (this.indexes.size > 4) {
        const oldest = this.indexes.keys().next().value;
        this.indexes.get(oldest).controller?.abort(); this.indexes.delete(oldest);
      }
    }
    if (!entry.pending && (force || !entry.logs || Date.now() - entry.at >= this.indexTtlMs)) {
      const revision = entry.revision;
      entry.controller = new AbortController();
      entry.pending = this.scan(dir, entry.controller.signal).then(logs => {
        if (revision === entry.revision) { entry.logs = logs; entry.at = Date.now(); }
        return logs;
      }).finally(() => { entry.pending = null; entry.controller = null; });
    }
    entry.clients++;
    try {
      const logs = await withSignal(entry.pending || Promise.resolve(entry.logs), signal);
      return logs.slice(0, Math.max(0, Math.min(this.indexLimit, Number(limit) || 0)));
    } finally {
      entry.clients--;
      if (!entry.clients && entry.pending) entry.controller?.abort();
    }
  }

  invalidate(dir) {
    const entry = this.indexes.get(path.resolve(dir));
    if (entry) { entry.logs = null; entry.at = 0; entry.revision++; }
  }

  async parseLog(file, { signal } = {}) {
    checkAbort(signal);
    if (this.closed) throw abortError();
    file = path.resolve(file);
    const st = await this.io.stat(file);
    checkAbort(signal);
    if (this.closed) throw abortError();
    const key = `${file}:${fingerprint(st)}`;
    if (this.parsed.has(key)) return this.parsed.get(key);
    let job = this.jobs.get(key);
    if (!job) {
      if (this.jobs.size >= this.queueLimit) throw new Error('For mange logger venter på analyse. Prøv igjen om litt.');
      job = { file, key, fingerprint: fingerprint(st), clients: 0, settled: false, worker: null, timer: null };
      job.promise = new Promise((resolve, reject) => { job.resolve = resolve; job.reject = reject; });
      job.promise.catch(() => {}); // alle abonnenter kan avbryte før worker svarer
      this.jobs.set(key, job); this.queue.push(job);
    }
    job.clients++;
    try { this.drain(); return await withSignal(job.promise, signal); }
    finally {
      job.clients--;
      if (!job.clients && !job.settled) this.finish(job, abortError());
    }
  }

  drain() {
    while (!this.closed && this.active < this.workerConcurrency && this.queue.length) {
      const job = this.queue.shift();
      if (job.settled) continue;
      this.active++; job.started = true;
      try {
        const worker = job.worker = this.createWorker();
        worker.once('message', message => {
          if (message.error) this.finish(job, Object.assign(new Error(message.error.message), { code: message.error.code }));
          else this.finish(job, null, message.result);
        });
        worker.once('error', error => this.finish(job, error));
        worker.once('exit', code => { if (!job.settled) this.finish(job, new Error(`Logganalysen avsluttet uten svar (${code})`)); });
        job.timer = setTimeout(() => this.finish(job, new Error('Logganalysen tok for lang tid')), this.workerTimeoutMs);
        worker.postMessage({ file: job.file, fingerprint: job.fingerprint });
      } catch (e) { this.finish(job, e); }
    }
  }

  finish(job, error, result) {
    if (job.settled) return;
    job.settled = true; clearTimeout(job.timer);
    if (job.started) this.active--;
    this.jobs.delete(job.key);
    if (!job.started) this.queue = this.queue.filter(queued => queued !== job);
    if (job.worker) job.termination = job.worker.terminate().catch(() => {});
    if (error) job.reject(error);
    else {
      // En nyere versjon av samme fil skal ikke dele cacheplass med alle tidligere versjoner.
      for (const [key, value] of this.parsed) if (value.file === job.file) this.parsed.delete(key);
      this.parsed.set(job.key, result);
      while (this.parsed.size > 60) this.parsed.delete(this.parsed.keys().next().value);
      job.resolve(result);
    }
    this.drain();
  }

  watch(dir, callback) {
    this.stopWatching();
    if (this.closed) return false;
    const state = { dir: path.resolve(dir), callback, controller: new AbortController(), pending: new Map(), retryTimer: null, retries: 0, watcher: null };
    state.checkTimer = setInterval(async () => {
      if (!state.watcher || !this.isCurrent(state)) return;
      try { await this.io.stat(state.dir); } catch (e) { this.retryWatcher(state, e); }
    }, 30000);
    state.checkTimer.unref?.();
    this.watching = state; this.invalidate(state.dir); this.connectWatcher(state);
    return true; // oppstarten er asynkron; en manglende mappe prøves igjen senere
  }

  isCurrent(state) { return this.watching === state && !state.controller.signal.aborted; }

  async connectWatcher(state) {
    try {
      await this.io.stat(state.dir);
      if (!this.isCurrent(state)) return;
      const watcher = state.watcher = this.createWatcher(state.dir, { recursive: true }, (_event, filename) => {
        if (!this.isCurrent(state)) return;
        state.retries = 0;
        this.invalidate(state.dir);
        if (!filename) return;
        const file = path.resolve(state.dir, String(filename));
        const relative = path.relative(state.dir, file);
        if (relative.startsWith('..') || path.isAbsolute(relative) || !LOG_RE.test(file)) return;
        this.scheduleLog(state, file, 0);
      });
      watcher.on('error', error => { if (state.watcher === watcher) this.retryWatcher(state, error); });
      watcher.on('close', () => { if (state.watcher === watcher && this.isCurrent(state)) this.retryWatcher(state); });
    } catch (e) { this.retryWatcher(state, e); }
  }

  retryWatcher(state, error) {
    if (!this.isCurrent(state) || state.retryTimer) return;
    const watcher = state.watcher; state.watcher = null;
    const delay = Math.min(30000, this.retryMs * 2 ** Math.min(state.retries++, 5));
    state.retryTimer = setTimeout(() => { state.retryTimer = null; this.connectWatcher(state); }, delay);
    state.retryTimer.unref?.();
    watcher?.close();
    if (error && state.retries === 1) this.warn('Loggovervåking venter på mappa', error.message);
    this.invalidate(state.dir);
  }

  scheduleLog(state, file, attempt) {
    const old = state.pending.get(file);
    if (old) { clearTimeout(old.timer); old.controller.abort(); }
    const task = { controller: new AbortController(), timer: null };
    state.pending.set(file, task);
    task.timer = setTimeout(async () => {
      try {
        const before = await this.io.stat(file);
        await new Promise((resolve, reject) => {
          const abort = () => { clearTimeout(timer); reject(abortError()); };
          const timer = setTimeout(() => { task.controller.signal.removeEventListener('abort', abort); resolve(); }, this.stableMs);
          task.controller.signal.addEventListener('abort', abort, { once: true });
          if (task.controller.signal.aborted) abort();
        });
        const after = await this.io.stat(file);
        if (fingerprint(before) !== fingerprint(after)) throw Object.assign(new Error('Loggen skrives fortsatt'), { code: 'FILE_CHANGED' });
        const result = await this.parseLog(file, { signal: task.controller.signal });
        if (this.isCurrent(state) && state.pending.get(file) === task) state.callback(result);
      } catch (e) {
        if (this.isCurrent(state) && !task.controller.signal.aborted && e.code !== 'ENOENT') {
          if (attempt < 3) this.scheduleLog(state, file, attempt + 1);
          else this.warn('Kunne ikke analysere ny logg', e.message);
        }
      } finally { if (state.pending.get(file) === task) state.pending.delete(file); }
    }, this.stableMs);
    task.timer.unref?.();
  }

  stopWatching() {
    const state = this.watching;
    this.watching = null;
    if (!state) return;
    state.controller.abort(); clearTimeout(state.retryTimer); clearInterval(state.checkTimer); state.watcher?.close();
    for (const task of state.pending.values()) { clearTimeout(task.timer); task.controller.abort(); }
    state.pending.clear();
  }

  async dispose() {
    this.closed = true; this.stopWatching();
    for (const entry of this.indexes.values()) entry.controller?.abort();
    const jobs = [...this.jobs.values()];
    for (const job of jobs) this.finish(job, abortError());
    this.queue = []; this.indexes.clear(); this.parsed.clear();
    await Promise.all(jobs.map(job => job.termination));
  }

  get currentDir() { return this.watching?.dir || null; }
}

module.exports = { LogArchive, LOG_RE };
