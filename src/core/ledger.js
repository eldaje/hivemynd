'use strict';

// Runtime-independent: all authority (clock, UUID, digest, lock, storage) is injected.
const LIMITS = { tasks: 200, proposals: 200, operations: 1000, events: 20000, payload: 8192 };
const TASK_FIELDS = ['record_id', 'title', 'description', 'status', 'owner', 'version',
  'created_at_utc', 'updated_at_utc', 'updated_by', 'completion_claimed',
  'completion_evidence', 'completion_claimed_by', 'done_verified_by', 'done_verified_at_utc'];
const PROPOSAL_FIELDS = ['proposal_id', 'proposed_by', 'target_record_id', 'expected_version',
  'proposed_change', 'reason', 'status', 'created_at_utc'];
const EVENT_FIELDS = ['event_id', 'operation_id', 'record_id', 'actor_id', 'model_claimed',
  'action', 'field_changed', 'previous_value', 'new_value', 'accepted_at_utc', 'result'];
const OP_FIELDS = ['operation_id', 'actor_id', 'request_hash', 'outcome'];
const MUTATIONS = {
  create_task: 'write', update_task: 'write', claim_completion: 'write',
  verify_completion: 'verify', propose_change: 'propose', review_proposal: 'write'
};
const READS = ['get_task', 'list_tasks', 'get_proposal', 'get_activity', 'brief'];
const copy = value => JSON.parse(JSON.stringify(value));
const canonical = value => {
  if (Array.isArray(value)) return '[' + value.map(canonical).join(',') + ']';
  if (value && typeof value === 'object') return '{' + Object.keys(value).sort()
    .map(k => JSON.stringify(k) + ':' + canonical(value[k])).join(',') + '}';
  return JSON.stringify(value);
};
function fault(code) { const e = new Error(code); e.code = code; throw e; }
function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fault('INVALID_REQUEST');
}
function keys(value, allowed, required = []) {
  object(value);
  if (Object.keys(value).some(k => !allowed.includes(k)) || required.some(k => !Object.hasOwn(value, k))) {
    fault('INVALID_REQUEST');
  }
}
function string(value, max = 500, empty = false) {
  if (typeof value !== 'string' || value.length > max || (!empty && !value.trim()) || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(value)) fault('INVALID_REQUEST');
}
function id(value) { string(value, 100); if (!/^[a-zA-Z0-9_-]{1,100}$/.test(value)) fault('INVALID_REQUEST'); }
function version(value) { if (!Number.isSafeInteger(value) || value < 1) fault('INVALID_REQUEST'); }
function patch(value, create = false) {
  keys(value, create ? ['title', 'description', 'owner'] : ['title', 'description', 'owner', 'status'], create ? ['title'] : []);
  if (!Object.keys(value).length) fault('INVALID_REQUEST');
  for (const [k, v] of Object.entries(value)) string(v, k === 'title' ? 160 : 500, k === 'description');
  if (Object.hasOwn(value, 'status') && !['proposed', 'active', 'blocked'].includes(value.status)) fault('INVALID_REQUEST');
}
function validate(r) {
  object(r); string(r.action, 40);
  if (READS.includes(r.action)) {
    const fields = { get_task: ['target_record_id'], list_tasks: [], get_proposal: ['proposal_id'], get_activity: ['cursor', 'limit'], brief: [] }[r.action];
    keys(r, ['action', ...fields], ['action', ...fields.filter(f => !['cursor', 'limit'].includes(f))]);
    if (r.target_record_id !== undefined) id(r.target_record_id);
    if (r.proposal_id !== undefined) id(r.proposal_id);
    if (r.cursor !== undefined && (!Number.isSafeInteger(r.cursor) || r.cursor < 0)) fault('INVALID_REQUEST');
    if (r.limit !== undefined && (!Number.isSafeInteger(r.limit) || r.limit < 1 || r.limit > 100)) fault('INVALID_REQUEST');
    return;
  }
  if (!Object.hasOwn(MUTATIONS, r.action)) fault('INVALID_REQUEST');
  const fields = {
    create_task: ['changes'], update_task: ['target_record_id', 'expected_version', 'changes'],
    claim_completion: ['target_record_id', 'expected_version', 'evidence_ref'],
    verify_completion: ['target_record_id', 'expected_version', 'evidence_ref'],
    propose_change: ['target_record_id', 'expected_version', 'changes'],
    review_proposal: ['proposal_id', 'decision']
  }[r.action];
  const base = ['action', 'operation_id', 'reason', 'model_claimed'];
  keys(r, [...base, ...fields], [...base, ...fields]);
  id(r.operation_id); string(r.reason); string(r.model_claimed, 100);
  if (r.action === 'propose_change' && r.target_record_id === '') {
    if (r.expected_version !== null) fault('INVALID_REQUEST');
  } else {
    if (r.target_record_id !== undefined) id(r.target_record_id);
    if (r.expected_version !== undefined) version(r.expected_version);
  }
  if (r.proposal_id !== undefined) id(r.proposal_id);
  if (r.changes !== undefined) patch(r.changes, r.action === 'create_task' || (r.action === 'propose_change' && !r.target_record_id));
  if (r.evidence_ref !== undefined) string(r.evidence_ref, 240);
  if (r.action === 'review_proposal' && !['accepted', 'rejected'].includes(r.decision)) fault('INVALID_REQUEST');
}
function emptyState() { return { format: 1, tasks: [], proposals: [], events: [], operations: [] }; }
function stateDigest(state, hash) { return hash(canonical(state)); }
function seal(state, hash) { return { state, digest: stateDigest(state, hash) }; }
function checkSnapshot(snapshot, hash) {
  if (!snapshot || !snapshot.state || snapshot.state.format !== 1 || snapshot.digest !== stateDigest(snapshot.state, hash)) fault('OUT_OF_BAND_EDIT');
  for (const name of ['tasks', 'proposals', 'events', 'operations']) {
    if (!Array.isArray(snapshot.state[name]) || snapshot.state[name].length > LIMITS[name]) fault('STORE_CORRUPT');
  }
}
function transition(s, r, actor, deps, at) {
  const target = recordId => {
    const t = s.tasks.find(t => t.record_id === recordId);
    if (!t) fault('NOT_FOUND');
    return t;
  };
  const checked = (recordId, expected) => {
    const t = target(recordId);
    if (t.version !== expected) fault('VERSION_CONFLICT');
    return t;
  };
  const event = (recordId, before, after) => {
    for (const k of Object.keys(after)) {
      if (canonical(before[k] === undefined ? null : before[k]) === canonical(after[k])) continue;
      s.events.push({ event_id: deps.uuid(), operation_id: r.operation_id, record_id: recordId,
        actor_id: actor.actor_id, model_claimed: r.model_claimed, action: r.action,
        field_changed: k, previous_value: JSON.stringify(before[k] === undefined ? null : before[k]),
        new_value: JSON.stringify(after[k]), accepted_at_utc: at, result: 'accepted' });
    }
  };
  const create = changes => {
    const t = { record_id: deps.uuid(), title: changes.title, description: changes.description || '',
      status: 'proposed', owner: changes.owner || 'unassigned', version: 1, created_at_utc: at,
      updated_at_utc: at, updated_by: actor.actor_id, completion_claimed: false,
      completion_evidence: '', completion_claimed_by: '', done_verified_by: '', done_verified_at_utc: '' };
    s.tasks.push(t); event(t.record_id, {}, t); return t;
  };
  const update = (t, changes) => {
    const before = copy(t);
    Object.assign(t, { status: t.status === 'done' ? 'active' : t.status }, changes,
      { completion_claimed: false, completion_evidence: '', completion_claimed_by: '', done_verified_by: '', done_verified_at_utc: '',
        version: t.version + 1, updated_at_utc: at, updated_by: actor.actor_id });
    event(t.record_id, before, t); return t;
  };
  let t, proposal;
  switch (r.action) {
    case 'create_task': t = create(r.changes); break;
    case 'update_task': t = update(checked(r.target_record_id, r.expected_version), r.changes); break;
    case 'claim_completion': {
      t = checked(r.target_record_id, r.expected_version); const before = copy(t);
      Object.assign(t, { status: 'done', completion_claimed: true, completion_evidence: r.evidence_ref,
        completion_claimed_by: actor.actor_id, done_verified_by: '', done_verified_at_utc: '',
        version: t.version + 1, updated_at_utc: at, updated_by: actor.actor_id });
      event(t.record_id, before, t); break;
    }
    case 'verify_completion': {
      t = checked(r.target_record_id, r.expected_version);
      if (!t.completion_claimed || t.status !== 'done') fault('NOT_CLAIMED');
      if (t.completion_claimed_by === actor.actor_id) fault('SELF_VERIFICATION');
      if (r.evidence_ref !== t.completion_evidence || !deps.verifyEvidence(r.evidence_ref, copy(t))) fault('EVIDENCE_MISMATCH');
      const before = copy(t);
      Object.assign(t, { done_verified_by: actor.actor_id, done_verified_at_utc: at,
        version: t.version + 1, updated_at_utc: at, updated_by: actor.actor_id });
      event(t.record_id, before, t); break;
    }
    case 'propose_change': {
      if (r.target_record_id) checked(r.target_record_id, r.expected_version);
      proposal = { proposal_id: deps.uuid(), proposed_by: 'authenticated:' + actor.actor_id,
        target_record_id: r.target_record_id, expected_version: r.expected_version,
        proposed_change: copy(r.changes), reason: r.reason, status: 'pending', created_at_utc: at };
      s.proposals.push(proposal); event(proposal.proposal_id, {}, proposal); break;
    }
    case 'review_proposal': {
      proposal = s.proposals.find(p => p.proposal_id === r.proposal_id);
      if (!proposal) fault('NOT_FOUND');
      if (proposal.status !== 'pending') fault('PROPOSAL_RESOLVED');
      const before = copy(proposal);
      if (r.decision === 'accepted') {
        t = proposal.target_record_id ? update(checked(proposal.target_record_id, proposal.expected_version), proposal.proposed_change) : create(proposal.proposed_change);
      }
      proposal.status = r.decision; event(proposal.proposal_id, before, proposal); break;
    }
  }
  const recordId = t ? t.record_id : proposal.proposal_id;
  return { ok: true, code: 'ACCEPTED', operation_id: r.operation_id, record_id: recordId,
    version: t ? t.version : null, accepted_at_utc: at,
    reference: { action: t ? 'get_task' : 'get_proposal', [t ? 'target_record_id' : 'proposal_id']: recordId },
    ...(proposal ? { proposal_id: proposal.proposal_id } : {}) };
}
function read(s, r) {
  const taskView = t => ({ ...copy(t), completion_state: t.done_verified_by ? 'verified_synthetic' : t.completion_claimed ? 'claimed_unverified' : 'not_claimed' });
  switch (r.action) {
    case 'get_task': {
      const t = s.tasks.find(t => t.record_id === r.target_record_id); if (!t) fault('NOT_FOUND');
      return { task: taskView(t) };
    }
    case 'get_proposal': {
      const p = s.proposals.find(p => p.proposal_id === r.proposal_id); if (!p) fault('NOT_FOUND'); return { proposal: copy(p) };
    }
    case 'list_tasks': return { tasks: s.tasks.map(taskView) };
    case 'get_activity': {
      const cursor = r.cursor || 0, limit = r.limit || 50;
      return { events: copy(s.events.slice(cursor, cursor + limit)), next_cursor: cursor + limit < s.events.length ? cursor + limit : null };
    }
    case 'brief': return { project: 'BLUE KITE', timezone: 'America/Denver',
      priorities: s.tasks.filter(t => t.status !== 'done').slice(0, 3).map(taskView),
      blockers: s.tasks.filter(t => t.status === 'blocked').map(taskView),
      claimed_unverified: s.tasks.filter(t => t.completion_claimed && !t.done_verified_by).map(taskView),
      verified_synthetic: s.tasks.filter(t => t.done_verified_by).map(taskView),
      pending_proposals: s.proposals.filter(p => p.status === 'pending').length,
      recent_changes: copy(s.events.slice(-10)) };
  }
}
function makeGateway(deps) {
  return function handle(envelope) {
    let r;
    try {
      keys(envelope, ['token', 'request'], ['token', 'request']);
      if (canonical(envelope).length > LIMITS.payload) fault('PAYLOAD_TOO_LARGE');
      string(envelope.token, 512); r = envelope.request;
      const actor = deps.authenticate(envelope.token);
      if (!actor) fault('UNAUTHORIZED');
      validate(r);
      const permission = READS.includes(r.action) ? 'read' : MUTATIONS[r.action];
      if (!actor.permissions.includes(permission)) fault('FORBIDDEN');
      return deps.store.withLock(() => {
        const snap = deps.store.load(); checkSnapshot(snap, deps.hash);
        const s = snap.state;
        if (READS.includes(r.action)) return { ok: true, code: 'READ', ...read(s, r) };
        const requestHash = deps.hash(canonical(r));
        const prior = s.operations.find(o => o.operation_id === r.operation_id);
        if (prior) {
          if (prior.actor_id !== actor.actor_id || prior.request_hash !== requestHash) fault('OPERATION_ID_REUSED');
          return copy(prior.outcome);
        }
        if (s.operations.length >= LIMITS.operations) fault('CAPACITY_REACHED');
        const at = deps.now();
        let next = copy(s), outcome;
        try { outcome = transition(next, r, actor, deps, at); }
        catch (e) {
          if (!e.code) throw e;
          next = copy(s);
          outcome = { ok: false, code: e.code, operation_id: r.operation_id, record_id: r.target_record_id || r.proposal_id || null, accepted_at_utc: at };
          const current = s.tasks.find(t => t.record_id === r.target_record_id);
          if (e.code === 'VERSION_CONFLICT' && current) outcome.current_version = current.version;
        }
        if (next.tasks.length > LIMITS.tasks || next.proposals.length > LIMITS.proposals || next.events.length > LIMITS.events) fault('CAPACITY_REACHED');
        next.operations.push({ operation_id: r.operation_id, actor_id: actor.actor_id, request_hash: requestHash, outcome });
        deps.store.commit(snap, seal(next, deps.hash));
        // A destination read is mandatory before reporting acceptance. Failure is ambiguous, never success.
        const fresh = deps.store.load(); checkSnapshot(fresh, deps.hash);
        if (fresh.digest !== stateDigest(next, deps.hash)) fault('READ_BACK_FAILED');
        return outcome;
      });
    } catch (e) {
      return { ok: false, code: e.code || 'STORE_UNAVAILABLE',
        ...(r && typeof r.operation_id === 'string' && /^[a-zA-Z0-9_-]{1,100}$/.test(r.operation_id) ? { operation_id: r.operation_id } : {}) };
    }
  };
}
if (typeof module !== 'undefined') module.exports = { LIMITS, TASK_FIELDS, PROPOSAL_FIELDS, EVENT_FIELDS, OP_FIELDS,
  MUTATIONS, READS, copy, canonical, fault, emptyState, seal, checkSnapshot, makeGateway, validate };
