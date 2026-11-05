'use strict';
const { emptyState, seal, copy, fault } = require('../core/ledger');
const { hash } = require('../gateway/runtime');
class MemoryStore {
  constructor() { this.snapshot = seal(emptyState(), hash); this.locked = false; }
  withLock(fn) {
    if (this.locked) fault('BUSY');
    this.locked = true;
    try { return fn(); } finally { this.locked = false; }
  }
  load() { return copy(this.snapshot); }
  commit(previous, next) {
    if (previous.digest !== this.snapshot.digest) fault('OUT_OF_BAND_EDIT');
    this.snapshot = copy(next);
  }
}
module.exports = { MemoryStore };
