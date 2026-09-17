'use strict';
// Cache er valgfri, men en avbrutt skriving skal ikke ødelegge siste gyldige fil.
const fs = require('fs');
class CacheWriter {
  constructor(file, snapshot, { debounceMs = 400, io = fs.promises } = {}) {
    Object.assign(this, { file, snapshot, debounceMs, io, dirty: false, writing: null, timer: null });
  }
  schedule() {
    this.dirty = true;
    clearTimeout(this.timer);
    this.timer = setTimeout(() => { this.timer = null; this.flush().catch(() => {}); }, this.debounceMs);
    this.timer.unref?.();
  }
  async flush() {
    clearTimeout(this.timer); this.timer = null;
    if (this.writing) { await this.writing; if (this.dirty) return this.flush(); return; }
    if (!this.dirty) return;
    this.writing = (async () => {
      while (this.dirty) {
        this.dirty = false;
        const data = this.snapshot();
        try {
          await this.io.writeFile(this.file + '.tmp', data);
          await this.io.rename(this.file + '.tmp', this.file);
        } catch (e) { this.dirty = true; throw e; }
      }
    })();
    try { await this.writing; } finally { this.writing = null; }
  }
}
module.exports = { CacheWriter };
