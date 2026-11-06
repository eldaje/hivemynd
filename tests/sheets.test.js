'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const crypto = require('node:crypto');
const { hash } = require('../src/gateway/runtime');
const { copy, makeGateway } = require('../src/core/ledger');
const root = path.join(__dirname, '..');
// Runs the actual portable source and GAS entrypoint, without Google's runtime.
const source = fs.readFileSync(path.join(root, 'dist/apps-script/Code.gs'), 'utf8');
function environment() {
  let book, calls = 0, fail = '', locked = false;
  const api = {
    create(body) { book = copy(body); book.spreadsheetId = 'fake-sheet'; return copy(book); },
    get() { return copy(book); },
    batchUpdate(body) {
      calls++;
      const next = copy(book);
      for (const r of body.requests) {
        const update = r.updateCells || r.appendCells;
        if (!update) throw new Error('unsupported fake request');
        const id = r.updateCells ? update.start.sheetId : update.sheetId;
        const s = next.sheets.find(s => s.properties.sheetId === id);
        if (!s || (r.updateCells && update.start.columnIndex !== 0)) throw new Error('invalid request');
        const rows = s.data[0].rowData;
        if (r.updateCells) update.rows.forEach((row, i) => { rows[update.start.rowIndex + i] = copy(row); });
        else rows.push(...copy(update.rows));
      }
      if (fail === 'before') { fail = ''; throw new Error('rejected batch'); }
      if (fail === 'partial') {
        fail = ''; book.sheets[0] = next.sheets[0]; throw new Error('hypothetical broken storage');
      }
      book = next;
      if (fail === 'after') { fail = ''; throw new Error('response lost'); }
    }
  };
  const properties = new Map();
  properties.set('BLUE_KITE_PRINCIPALS', JSON.stringify([
    { actor_id: 'writer', token_hash: hash('writer-test'), permissions: ['read', 'write', 'propose'] },
    { actor_id: 'verifier', token_hash: hash('verifier-test'), permissions: ['read', 'verify'] }
  ]));
  const context = vm.createContext({
    Utilities: { DigestAlgorithm: { SHA_256: 'sha256' }, Charset: { UTF_8: 'utf8' },
      computeDigest: (_, s) => Array.from(crypto.createHash('sha256').update(s).digest()), getUuid: crypto.randomUUID },
    PropertiesService: { getScriptProperties: () => ({ getProperty: k => properties.get(k), setProperty: (k, v) => properties.set(k, v) }) },
    LockService: { getScriptLock: () => ({ tryLock: () => { if (locked) return false; locked = true; return true; }, releaseLock: () => { locked = false; } }) },
    Sheets: { Spreadsheets: api },
    ContentService: { MimeType: { JSON: 'application/json' }, createTextOutput: text => ({ text, setMimeType() { return this; } }) }
  });
  vm.runInContext(source, context);
  context.initializeBlueKite();
  const call = (request, token = 'writer-test') => {
    const contents = JSON.stringify({ token, request });
    return JSON.parse(context.doPost({ postData: { contents, length: Buffer.byteLength(contents), type: 'application/json' } }).text);
  };
  return { context, api, call, properties, get book() { return book; }, get calls() { return calls; }, fail: value => { fail = value; } };
}
const create = () => ({ ...copy(require('../fixtures/blue-kite.json')), operation_id: crypto.randomUUID() });
test('Sheets API fake: actual GAS entrypoint creates/updates/reads typed tabs with literal strings', () => {
  const e = environment(), req = create(); req.changes.description = '=IMPORTDATA("fictional")';
  const c = e.call(req); assert.equal(c.ok, true); assert.equal(c.version, 1);
  const got = e.call({ action: 'get_task', target_record_id: c.record_id });
  assert.equal(got.task.description, '=IMPORTDATA("fictional")');
  assert.equal(e.book.sheets[0].data[0].rowData[1].values[2].userEnteredValue.stringValue, '=IMPORTDATA("fictional")');
  const u = { action: 'update_task', operation_id: crypto.randomUUID(), target_record_id: c.record_id, expected_version: 1,
    changes: { status: 'active' }, reason: 'Fictional update', model_claimed: 'claimed-label' };
  assert.equal(e.call(u).version, 2);
  assert.equal(e.call({ ...u, operation_id: crypto.randomUUID() }).code, 'VERSION_CONFLICT');
  assert.deepEqual(e.call(req), c);
  const events = e.call({ action: 'get_activity', limit: 100 }).events;
  assert.ok(events.some(v => v.actor_id === 'writer' && v.model_claimed === 'claimed-label'));
  assert.equal(e.book.sheets.find(s => s.properties.title === 'Operations').data[0].rowData.length, 4);
});
test('Sheets fake: rejected atomic batch does not apply task/audit/receipt, same logical retry succeeds', () => {
  const e = environment(), req = create(), before = copy(e.book); e.fail('before');
  assert.equal(e.call(req).code, 'STORE_UNAVAILABLE'); assert.deepEqual(e.book, before);
  assert.equal(e.call(req).ok, true); assert.equal(e.calls, 2);
});
test('Sheets fake: commit with lost reply recovers from durable operation, without a second batch', () => {
  const e = environment(), req = create(); e.fail('after');
  assert.equal(e.call(req).code, 'STORE_UNAVAILABLE');
  const recovered = e.call(req); assert.equal(recovered.ok, true); assert.equal(e.calls, 1);
  assert.deepEqual(e.call(req), recovered);
});
test('Sheets fake: hypothetical partial write and direct edits fail integrity, preserve evidence for operator', () => {
  const e = environment(), req = create(); e.fail('partial');
  assert.equal(e.call(req).ok, false);
  assert.equal(e.call(req).code, 'OUT_OF_BAND_EDIT');
  const f = environment(), c = f.call(create());
  f.book.sheets[0].data[0].rowData[1].values[3].userEnteredValue = { stringValue: 'blocked' };
  assert.equal(f.call({ action: 'get_task', target_record_id: c.record_id }).code, 'OUT_OF_BAND_EDIT');
});
test('Sheets fake: formulas, header edits, and audit edits are detected', () => {
  for (const kind of ['formula', 'header', 'audit']) {
    const e = environment(); e.call(create());
    const task = e.book.sheets[0];
    if (kind === 'formula') task.data[0].rowData[1].values[1].userEnteredValue = { formulaValue: '="fiction"' };
    if (kind === 'header') task.data[0].rowData[0].values[0].userEnteredValue = { stringValue: 'wrong' };
    if (kind === 'audit') e.book.sheets.find(s => s.properties.title === 'Activity_Log').data[0].rowData[1].values[3].userEnteredValue = { stringValue: 'forged' };
    assert.equal(e.call({ action: 'list_tasks' }).code, 'OUT_OF_BAND_EDIT');
  }
});
test('GAS rejects query credentials, malformed/oversized input, wrong credentials; GET gives no data', () => {
  const e = environment(), before = copy(e.book);
  assert.equal(e.call(create(), 'wrong').code, 'UNAUTHORIZED');
  const post = (contents, extra = {}) => JSON.parse(e.context.doPost({ postData: { contents, length: contents.length, type: 'application/json' }, ...extra }).text);
  assert.equal(post('{').code, 'INVALID_JSON');
  assert.equal(post('x'.repeat(8193)).code, 'PAYLOAD_TOO_LARGE');
  assert.equal(post('{}', { queryString: 'token=bad' }).code, 'QUERY_NOT_ALLOWED');
  assert.equal(JSON.parse(e.context.doGet().text).code, 'POST_REQUIRED'); assert.deepEqual(e.book, before);
});
test('Sheets fake: proposal review and independent synthetic verification run through GAS', () => {
  const e = environment();
  const req = create(); req.action = 'propose_change'; req.target_record_id = ''; req.expected_version = null;
  const p = e.call(req); assert.equal(p.ok, true);
  const c = e.call({ action: 'review_proposal', operation_id: crypto.randomUUID(), proposal_id: p.proposal_id,
    decision: 'accepted', reason: 'Fictional review', model_claimed: 'fake-writer' });
  assert.equal(c.ok, true);
  const claim = { action: 'claim_completion', operation_id: crypto.randomUUID(), target_record_id: c.record_id,
    expected_version: 1, evidence_ref: 'synthetic:blue-kite-inspection-v1', reason: 'Fictional claim', model_claimed: 'fake-writer' };
  assert.equal(e.call(claim).ok, true);
  const verified = e.call({ ...claim, action: 'verify_completion', operation_id: crypto.randomUUID(), expected_version: 2 }, 'verifier-test');
  assert.equal(verified.ok, true); assert.equal(verified.version, 3);
  assert.equal(e.call(verified.reference, 'verifier-test').task.done_verified_by, 'verifier');
});
