'use strict';
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const { FileStore } = require('../src/storage/file');
const { runtime, hash } = require('../src/gateway/runtime');
const { createServer } = require('../src/gateway/server');
async function main() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-kite-demo-'));
  const tokens = Object.fromEntries(['writer', 'reader', 'verifier'].map(a => [a, crypto.randomBytes(32).toString('hex')]));
  const principals = Object.entries(tokens).map(([actor_id, token]) => ({ actor_id, token_hash: hash(token),
    permissions: actor_id === 'writer' ? ['read', 'write', 'propose'] : actor_id === 'verifier' ? ['read', 'verify'] : ['read', 'propose'] }));
  const server = createServer(runtime(new FileStore(dir), principals));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const url = 'http://127.0.0.1:' + server.address().port + '/gateway';
  const call = async (request, actor = 'writer') => (await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: tokens[actor], request }) })).json();
  const op = (action, fields) => ({ action, operation_id: crypto.randomUUID(), model_claimed: 'local-demo', reason: 'Fictional demonstration', ...fields });
  const report = (label, result) => console.log(label + ': ' + JSON.stringify(result));
  try {
    const createRequest = { ...require('../fixtures/blue-kite.json'), operation_id: crypto.randomUUID() };
    const c = await call(createRequest); assert.equal(c.ok, true); report('CREATE', c);
    const u = await call(op('update_task', { target_record_id: c.record_id, expected_version: 1, changes: { status: 'active' } })); assert.equal(u.version, 2); report('UPDATE', u);
    const conflict = await call(op('update_task', { target_record_id: c.record_id, expected_version: 1, changes: { status: 'blocked' } })); assert.equal(conflict.code, 'VERSION_CONFLICT'); report('STALE', conflict);
    const replay = await call(createRequest); assert.deepEqual(replay, c); report('REPLAY_ORIGINAL', replay);
    const proposal = await call(op('propose_change', { target_record_id: c.record_id, expected_version: 2, changes: { owner: 'Fictional Tuesday reviewer' } }), 'reader'); assert.equal(proposal.ok, true); report('PROPOSAL', proposal);
    const review = await call(op('review_proposal', { proposal_id: proposal.proposal_id, decision: 'accepted' })); assert.equal(review.version, 3); report('REVIEW', review);
    const fields = { target_record_id: c.record_id, expected_version: 3, evidence_ref: 'synthetic:blue-kite-inspection-v1' };
    const claim = await call(op('claim_completion', fields)); assert.equal(claim.version, 4);
    const unverified = await call(c.reference, 'reader'); assert.equal(unverified.task.completion_state, 'claimed_unverified'); report('CLAIMED', unverified);
    const verified = await call(op('verify_completion', { ...fields, expected_version: 4 }), 'verifier'); assert.equal(verified.version, 5); report('VERIFY_SYNTHETIC', verified);
    const read = await call(c.reference, 'reader'); assert.equal(read.task.completion_state, 'verified_synthetic'); report('READ_AFTER_WRITE', read);
    const restarted = runtime(new FileStore(dir), principals);
    assert.deepEqual(restarted({ token: tokens.writer, request: createRequest }), c);
    const audit = await call({ action: 'get_activity', limit: 100 }, 'reader'); assert.ok(audit.events.length); console.log('AUDIT: ' + audit.events.length + ' accepted field events');
    console.log('PASS: local HTTP + durable file store only; no live Google or cross-model test.');
  } finally {
    await new Promise(resolve => server.close(resolve));
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
main().catch(e => { console.error(e.message); process.exitCode = 1; });
