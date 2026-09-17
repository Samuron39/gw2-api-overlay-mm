'use strict';
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const { createRequire } = require('node:module');
module.exports = function load(file, mocks = {}, globals = {}) {
  const filename = path.resolve(__dirname, '../..', file), module = { exports: {} };
  const realRequire = createRequire(filename);
  const context = { module, exports: module.exports, __dirname: path.dirname(filename), __filename: filename,
    require: (id) => Object.hasOwn(mocks, id) ? mocks[id] : realRequire(id), console, process,
    Buffer, URL, AbortController, setTimeout, clearTimeout, setInterval, clearInterval, setImmediate, structuredClone, ...globals };
  vm.runInNewContext(fs.readFileSync(filename, 'utf8'), context, { filename });
  return module.exports;
};
