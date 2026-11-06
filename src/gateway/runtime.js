'use strict';
const crypto = require('node:crypto');
const { canonical, makeGateway } = require('../core/ledger');
const evidence = require('../../fixtures/evidence.json');
const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function authenticator(principals) {
  if (!Array.isArray(principals) || !principals.length) throw new Error('Configure principals');
  const ids = new Set(), tokens = new Set();
  for (const p of principals) {
    if (!p || typeof p.actor_id !== 'string' || !/^[a-zA-Z0-9_-]{1,100}$/.test(p.actor_id) || ids.has(p.actor_id) ||
      !/^[a-f0-9]{64}$/.test(p.token_hash) || tokens.has(p.token_hash) || !Array.isArray(p.permissions) ||
      p.permissions.some(v => !['read', 'write', 'propose', 'verify'].includes(v))) throw new Error('Invalid principal configuration');
    ids.add(p.actor_id); tokens.add(p.token_hash);
  }
  if (principals.filter(p => p.permissions.includes('write')).length !== 1) throw new Error('Pilot requires exactly one writer');
  return token => {
    const candidate = Buffer.from(hash(token), 'hex');
    return principals.find(p => crypto.timingSafeEqual(candidate, Buffer.from(p.token_hash, 'hex')));
  };
}
const verifyEvidence = (ref, task) => evidence.some(e => e.reference === ref && e.expected_title === task.title && e.verdict === 'pass');
function runtime(store, principals) {
  return makeGateway({ store, authenticate: authenticator(principals), hash, uuid: () => crypto.randomUUID(),
    now: () => new Date().toISOString(), verifyEvidence });
}
module.exports = { hash, canonical, authenticator, verifyEvidence, runtime };
