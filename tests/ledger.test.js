'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID } = require('node:crypto');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { MemoryStore } = require('../src/storage/memory');
const { FileStore } = require('../src/storage/file');
const { runtime, hash, authenticator } = require('../src/gateway/runtime');
const { makeGateway, LIMITS, seal, copy } = require('../src/core/ledger');
const fixture = require('../fixtures/blue-kite.json');
const principals = [
  { actor_id: 'writer', token_hash: hash('test-writer'), permissions: ['read', 'write', 'propose', 'verify'] },
  { actor_id: 'verifier', token_hash: hash('test-verifier'), permissions: ['read', 'verify'] },
  { actor_id: 'proposer', token_hash: hash('test-proposer'), permissions: ['read', 'propose'] },
  { actor_id: 'reader', token_hash: hash('test-reader'), permissions: ['read'] }
];
const op = (action, fields = {}) => ({ action, operation_id: randomUUID(), model_claimed: 'Untrusted model label', reason: 'Fictional test', ...fields });
function harness(store = new MemoryStore()) {
  const gateway = runtime(store, principals);
  const call = (r, slot = 'writer') => gateway({ token: 'test-' + slot, request: r });
  const create = () => call(op('create_task', { changes: fixture.changes }));
  const get = id => call({ action: 'get_task', target_record_id: id });
  return { store, call, create, get };
}
test('A/B/E/I: create, update, field audit, authenticated attribution and bounded read', () => {
  const h = harness(), c = h.create(); assert.equal(c.code, 'ACCEPTED'); assert.equal(c.version, 1);
  const first = h.get(c.record_id).task;
  assert.match(first.record_id, /^[a-f0-9-]{36}$/); assert.match(first.created_at_utc, /Z$/);
  assert.equal(first.updated_by, 'writer');
  const u = h.call(op('update_task', { target_record_id: c.record_id, expected_version: 1, changes: { status: 'active' } }));
  assert.equal(u.version, 2); assert.equal(h.get(c.record_id).task.status, 'active');
  const events = h.call({ action: 'get_activity', limit: 100 }).events;
  const e = events.find(e => e.operation_id === u.operation_id && e.field_changed === 'status');
  assert.deepEqual([e.previous_value, e.new_value, e.actor_id, e.model_claimed], ['"proposed"', '"active"', 'writer', 'Untrusted model label']);
  assert.equal(e.accepted_at_utc, u.accepted_at_utc);
});
test('C: two independently prepared updates from same version accept only one', async () => {
  const h = harness(), c = h.create();
  const requests = ['active', 'blocked'].map(status => op('update_task', { target_record_id: c.record_id, expected_version: 1, changes: { status } }));
  const results = await Promise.all(requests.map(r => Promise.resolve().then(() => h.call(r))));
  assert.deepEqual(results.map(r => r.code), ['ACCEPTED', 'VERSION_CONFLICT']);
  assert.equal(results[1].current_version, 2); assert.equal(h.get(c.record_id).task.version, 2);
  assert.deepEqual(h.call(requests[1]), results[1]);
});
test('D: retries return original result with no repeated audit; changed payload/actor rejected', () => {
  const h = harness(), request = op('create_task', { changes: fixture.changes });
  const first = h.call(request), before = h.store.load();
  assert.deepEqual(h.call(request), first); assert.deepEqual(h.store.load(), before);
  assert.deepEqual(h.call(Object.fromEntries(Object.entries(request).reverse())), first);
  assert.equal(h.call({ ...request, changes: { title: 'Different fiction' } }).code, 'OPERATION_ID_REUSED');
  const collision = op('propose_change', { target_record_id: '', expected_version: null, changes: { title: 'Fiction' } });
  h.call(collision); assert.equal(h.call(collision, 'proposer').code, 'OPERATION_ID_REUSED');
});
test('F: claim is unverified; separate authorized actor checks real synthetic fixture; edits invalidate proof', () => {
  const h = harness(), c = h.create();
  const fields = { target_record_id: c.record_id, expected_version: 2, evidence_ref: 'synthetic:blue-kite-inspection-v1' };
  h.call(op('claim_completion', { ...fields, expected_version: 1 }));
  assert.equal(h.get(c.record_id).task.completion_state, 'claimed_unverified');
  assert.equal(h.call(op('verify_completion', fields)).code, 'SELF_VERIFICATION');
  assert.equal(h.call(op('verify_completion', fields), 'reader').code, 'FORBIDDEN');
  assert.equal(h.call(op('verify_completion', { ...fields, evidence_ref: 'invented' }), 'verifier').code, 'EVIDENCE_MISMATCH');
  const verified = h.call(op('verify_completion', fields), 'verifier'); assert.equal(verified.version, 3);
  assert.equal(h.get(c.record_id).task.done_verified_by, 'verifier');
  assert.equal(h.get(c.record_id).task.completion_state, 'verified_synthetic');
  h.call(op('update_task', { target_record_id: c.record_id, expected_version: 3, changes: { owner: 'Fictional reviewer' } }));
  const edited = h.get(c.record_id).task;
  assert.equal(edited.done_verified_by, ''); assert.equal(edited.status, 'active'); assert.equal(edited.completion_claimed, false);
});
test('F: evidence cannot certify a different task title and verification cannot precede claim', () => {
  const h = harness(); const c = h.call(op('create_task', { changes: { title: 'Different imaginary kite' } }));
  const fields = { target_record_id: c.record_id, expected_version: 1, evidence_ref: 'synthetic:blue-kite-inspection-v1' };
  assert.equal(h.call(op('verify_completion', fields), 'verifier').code, 'NOT_CLAIMED');
  h.call(op('claim_completion', fields));
  assert.equal(h.call(op('verify_completion', { ...fields, expected_version: 2 }), 'verifier').code, 'EVIDENCE_MISMATCH');
});
test('H: wrong credentials, forbidden writes, protected fields and forged timestamps never mutate', () => {
  const h = harness(), c = h.create(), before = h.store.load();
  assert.equal(runtime(h.store, principals)({ request: fixture }).code, 'INVALID_REQUEST');
  assert.equal(h.call(op('create_task', { changes: fixture.changes }), 'wrong').code, 'UNAUTHORIZED');
  assert.equal(h.call(op('create_task', { changes: fixture.changes }), 'reader').code, 'FORBIDDEN');
  for (const changes of [{ version: 99 }, { updated_by: 'verifier' }, { done_verified_by: 'forged' }, { status: 'done' }, { owner: 7 }, {}]) {
    assert.equal(h.call(op('update_task', { target_record_id: c.record_id, expected_version: 1, changes })).code, 'INVALID_REQUEST');
  }
  assert.equal(h.call({ ...op('create_task', { changes: fixture.changes }), accepted_at_utc: 'fake' }).code, 'INVALID_REQUEST');
  assert.deepEqual(h.store.load(), before);
  assert.equal(h.call(op('create_task', { changes: { title: 'x'.repeat(LIMITS.payload) } })).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(h.call(op('update_task', { target_record_id: c.record_id, expected_version: '1', changes: { status: 'active' } })).code, 'INVALID_REQUEST');
});
test('H: credential rotation revokes old token without changing actor attribution', () => {
  const store = new MemoryStore(), first = runtime(store, principals);
  const r = op('create_task', { changes: fixture.changes }); const c = first({ token: 'test-writer', request: r });
  const rotated = principals.map(p => p.actor_id === 'writer' ? { ...p, token_hash: hash('rotated-writer') } : p);
  const second = runtime(store, rotated);
  assert.equal(second({ token: 'test-writer', request: r }).code, 'UNAUTHORIZED');
  assert.deepEqual(second({ token: 'rotated-writer', request: r }), c);
  assert.throws(() => authenticator([...principals, { actor_id: 'duplicate', token_hash: hash('test-writer'), permissions: [] }]));
  assert.throws(() => authenticator(principals.filter(p => p.actor_id !== 'writer')));
});
test('L: proposer submits reviewable create/update, writer review applies once; stale proposal stays pending', () => {
  const h = harness();
  const proposal = h.call(op('propose_change', { target_record_id: '', expected_version: null, changes: fixture.changes }), 'proposer');
  assert.equal(h.store.load().state.tasks.length, 0);
  assert.equal(h.call({ action: 'get_proposal', proposal_id: proposal.proposal_id }).proposal.proposed_by, 'authenticated:proposer');
  const review = op('review_proposal', { proposal_id: proposal.proposal_id, decision: 'accepted' });
  assert.equal(h.call(review, 'proposer').code, 'FORBIDDEN');
  const c = h.call(review); assert.equal(c.version, 1); assert.deepEqual(h.call(review), c);
  const pending = h.call(op('propose_change', { target_record_id: c.record_id, expected_version: 1, changes: { status: 'blocked' } }), 'proposer');
  h.call(op('update_task', { target_record_id: c.record_id, expected_version: 1, changes: { status: 'active' } }));
  assert.equal(h.call(op('review_proposal', { proposal_id: pending.proposal_id, decision: 'accepted' })).code, 'VERSION_CONFLICT');
  assert.equal(h.call({ action: 'get_proposal', proposal_id: pending.proposal_id }).proposal.status, 'pending');
  assert.equal(h.call(op('review_proposal', { proposal_id: pending.proposal_id, decision: 'rejected' })).ok, true);
});
test('G: interruption before commit leaves no state; after commit lost reply recovers via original receipt', () => {
  const h = harness(), request = op('create_task', { changes: fixture.changes });
  const commit = h.store.commit.bind(h.store);
  h.store.commit = () => { throw new Error('simulated before commit'); };
  assert.equal(h.call(request).code, 'STORE_UNAVAILABLE'); assert.equal(h.store.load().state.tasks.length, 0);
  h.store.commit = (a, b) => { commit(a, b); throw new Error('simulated lost acknowledgement'); };
  assert.equal(h.call(request).code, 'STORE_UNAVAILABLE');
  h.store.commit = commit;
  const recovered = h.call(request); assert.equal(recovered.ok, true); assert.equal(h.store.load().state.tasks.length, 1);
  assert.equal(h.store.load().state.operations.length, 1);
});
test('G/K: partial write or direct edit invalidates integrity and blocks reads/writes without overwriting evidence', () => {
  const h = harness(), c = h.create();
  h.store.snapshot.state.tasks[0].title = 'Out-of-band imaginary change';
  assert.equal(h.get(c.record_id).code, 'OUT_OF_BAND_EDIT');
  const snapshot = h.store.load(); assert.equal(h.create().code, 'OUT_OF_BAND_EDIT'); assert.deepEqual(h.store.load(), snapshot);
});
test('G/I: read-back failure is not success; replay finds committed operation', () => {
  const h = harness(), request = op('create_task', { changes: fixture.changes });
  const load = h.store.load.bind(h.store); let loads = 0;
  h.store.load = () => { if (++loads === 2) throw new Error('read unavailable'); return load(); };
  assert.equal(h.call(request).code, 'STORE_UNAVAILABLE'); h.store.load = load;
  assert.equal(h.call(request).ok, true); assert.equal(h.store.load().state.tasks.length, 1);
});
test('durable store restart preserves idempotency, server timestamps and audit; lock fails closed', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-kite-test-')); t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = harness(new FileStore(dir)), request = op('create_task', { changes: fixture.changes });
  const first = h.call(request), snapshot = h.store.load();
  const restarted = harness(new FileStore(dir)); assert.deepEqual(restarted.call(request), first); assert.deepEqual(restarted.store.load(), snapshot);
  fs.mkdirSync(h.store.lock); assert.equal(restarted.get(first.record_id).code, 'BUSY'); fs.rmdirSync(h.store.lock);
  assert.equal(fs.statSync(h.store.file).mode & 0o777, 0o600);
});
test('timestamps come from trusted runtime; client metadata cannot replace identity', () => {
  const store = new MemoryStore();
  const gateway = makeGateway({ store, hash, authenticate: () => principals[0], uuid: randomUUID,
    now: () => '2026-11-05T12:00:00.000Z', verifyEvidence: () => false });
  const c = gateway({ token: 'test', request: op('create_task', { changes: fixture.changes, model_claimed: 'verifier' }) });
  assert.equal(c.accepted_at_utc, '2026-11-05T12:00:00.000Z');
  assert.equal(store.load().state.events[0].actor_id, 'writer');
});
test('corrupt local JSON is surfaced without replacing forensic state', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'blue-kite-corrupt-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const h = harness(new FileStore(dir));
  fs.writeFileSync(h.store.file, '{interrupted external edit');
  assert.equal(h.create().code, 'STORE_CORRUPT');
  assert.equal(fs.readFileSync(h.store.file, 'utf8'), '{interrupted external edit');
});
test('bounded retention fails closed at operation capacity rather than expiring receipts', () => {
  const h = harness(), state = h.store.load().state;
  state.operations = Array.from({ length: LIMITS.operations }, (_, i) => ({ operation_id: 'old-' + i }));
  h.store.snapshot = seal(state, hash);
  assert.equal(h.create().code, 'CAPACITY_REACHED');
});
test('brief distinguishes claims from synthetic verification and includes blockers', () => {
  const h = harness(), c = h.create();
  h.call(op('update_task', { target_record_id: c.record_id, expected_version: 1, changes: { status: 'blocked' } }));
  assert.equal(h.call({ action: 'brief' }).blockers.length, 1);
  h.call(op('claim_completion', { target_record_id: c.record_id, expected_version: 2, evidence_ref: 'synthetic:blue-kite-inspection-v1' }));
  const brief = h.call({ action: 'brief' });
  assert.equal(brief.claimed_unverified.length, 1); assert.equal(brief.verified_synthetic.length, 0);
  assert.equal(brief.timezone, 'America/Denver');
});
module.exports = { principals, op, harness };
