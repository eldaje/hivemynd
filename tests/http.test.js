'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { createServer } = require('../src/gateway/server');
const { MemoryStore } = require('../src/storage/memory');
const { runtime, hash } = require('../src/gateway/runtime');
test('HTTP gateway: real loopback create/read, competing writes, auth, invalid JSON and body bounds', async t => {
  const token = crypto.randomBytes(32).toString('hex');
  const handle = runtime(new MemoryStore(), [{ actor_id: 'writer', token_hash: hash(token), permissions: ['read', 'write'] }]);
  const server = createServer(handle);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const url = 'http://127.0.0.1:' + server.address().port + '/gateway';
  const post = (request, credential = token) => fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ token: credential, request }) });
  const req = require('../fixtures/blue-kite.json');
  const response = await post(req), c = await response.json(); assert.equal(response.status, 200); assert.equal(c.ok, true);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  const updates = ['active', 'blocked'].map(status => post({ action: 'update_task', operation_id: crypto.randomUUID(),
    target_record_id: c.record_id, expected_version: 1, changes: { status }, reason: 'Fictional competing request', model_claimed: 'loopback' }));
  const results = await Promise.all(updates); assert.deepEqual(results.map(r => r.status).sort(), [200, 409]);
  const got = await (await post({ action: 'get_task', target_record_id: c.record_id })).json(); assert.equal(got.task.version, 2);
  assert.equal((await post(req, 'wrong')).status, 401);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' })).status, 400);
  assert.equal((await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: 'x'.repeat(8193) })).status, 413);
  assert.equal((await fetch(url + '?token=wrong', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })).status, 404);
});
