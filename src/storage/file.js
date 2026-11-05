'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { fault, emptyState, seal } = require('../core/ledger');
const { hash } = require('../gateway/runtime');
// One snapshot contains state + audit + processed operations. Rename is the commit point.
class FileStore {
  constructor(directory) {
    this.directory = path.resolve(directory);
    fs.mkdirSync(this.directory, { recursive: true, mode: 0o700 });
    this.file = path.join(this.directory, 'ledger.json');
    this.lock = path.join(this.directory, 'writer.lock');
    this.withLock(() => {
      if (!fs.existsSync(this.file)) this.write(seal(emptyState(), hash));
    });
  }
  withLock(fn) {
    try { fs.mkdirSync(this.lock, { mode: 0o700 }); }
    catch (e) { if (e.code === 'EEXIST') fault('BUSY'); throw e; }
    try { return fn(); } finally { fs.rmdirSync(this.lock); }
  }
  load() {
    const contents = fs.readFileSync(this.file, 'utf8');
    try { return JSON.parse(contents); } catch { fault('STORE_CORRUPT'); }
  }
  commit(previous, next) {
    if (this.load().digest !== previous.digest) fault('OUT_OF_BAND_EDIT');
    this.write(next);
  }
  write(snapshot) {
    const temp = this.file + '.' + randomUUID() + '.tmp';
    try {
      const fd = fs.openSync(temp, 'wx', 0o600);
      try { fs.writeFileSync(fd, JSON.stringify(snapshot)); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      fs.renameSync(temp, this.file);
      const dir = fs.openSync(this.directory, 'r');
      try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); }
    } finally { if (fs.existsSync(temp)) fs.unlinkSync(temp); }
  }
}
module.exports = { FileStore };
