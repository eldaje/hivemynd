# Data model and API

`Tasks` columns, in order: `record_id`, `title`, `description`, `status`, `owner`,
`version`, `created_at_utc`, `updated_at_utc`, `updated_by`, `completion_claimed`,
`completion_evidence`, `completion_claimed_by`, `done_verified_by`,
`done_verified_at_utc`. IDs are trusted-runtime UUIDs. Versions are positive
integers. Timestamps are server-created ISO UTC strings. Booleans/numbers are
typed Sheet values. Text is written as literal `stringValue`, never formulas.

Statuses: `proposed`, `active`, `blocked`, `done`. Create starts proposed.
Only `claim_completion` sets done; it records the original claimant separately
from the latest updater so a subsequent action cannot disguise self-verification.
`get_task` adds computed `completion_state`: `not_claimed`, `claimed_unverified`,
or `verified_synthetic`. Done means claimed workflow completion, never proof.
Any update clears evidence/claim/verification; editing a done task reopens it
as active unless a different permitted non-done status is supplied.

`Activity_Log`: `event_id`, `operation_id`, `record_id`, `actor_id`, `model_claimed`,
`action`, `field_changed`, `previous_value`, `new_value`, `accepted_at_utc`, `result`.
One row per changed field, including server-controlled fields. Values use bounded
JSON scalars or a small structured proposal patch. `result` is always accepted;
rejections are stored in Operations, not misrepresented as accepted events.
For proposal events, record_id is the proposal UUID. For approved proposal task
events it is the task UUID. Both share the review operation ID.

`Proposals`: `proposal_id`, `proposed_by`, `target_record_id`, `expected_version`,
`proposed_change`, `reason`, `status`, `created_at_utc`. Provenance is
`authenticated:<slot>`. Create proposals have an empty target and null version.
Patch JSON is restricted to the same allowed task fields as direct writes.
Submission does not change a task. Only a writer can accept/reject; acceptance
rechecks the proposal's observed task version. A stale proposal stays pending;
reject it and submit a newly based proposal with a new ID. Anonymous submitters
can prepare a request file for manual review but cannot enqueue it unauthenticated.

`Operations`: `operation_id`, `actor_id`, `request_hash`, `outcome` (bounded JSON).
Operation IDs are global within one pilot. Same ID + actor + normalized request
returns the original outcome. A different request or actor returns
`OPERATION_ID_REUSED`. JSON object-key order does not affect normalization.

`_Integrity`: `format`, `digest`; one data row holds format 1 and SHA-256 of the
canonical state including receipts. It is a hidden operational tab, not a secret.

Every mutation requires `action`, `operation_id`, `reason`, `model_claimed` plus:

| Action | Required fields | Permission |
| --- | --- | --- |
| create_task | changes: title plus optional description, owner | write |
| update_task | target_record_id, expected_version, changes | write |
| claim_completion | target_record_id, expected_version, evidence_ref | write |
| verify_completion | target_record_id, expected_version, evidence_ref | verify |
| propose_change | target_record_id (or empty), expected_version (or null), changes | propose |
| review_proposal | proposal_id, decision: accepted/rejected | write |

Read requests need only `action` and their fields: get_task(target_record_id),
get_proposal(proposal_id), list_tasks(), brief(), get_activity(cursor=0, limit=50).
Activity pages allow 1–100 rows and return next_cursor or null. All require read
permission. Listing tasks is bounded by the 200-task pilot ceiling.

Unknown fields and invalid types are rejected. Clients cannot set IDs, timestamps,
versions, actors, completion flags or verifier fields through changes. The
credential is outside the request in `{token, request}`; never put it in URLs.

Accepted outcomes include `ok`, `code`, `operation_id`, `record_id`, `version`,
`accepted_at_utc`, and a ready-to-use `reference` read request. Proposal outcomes
include proposal_id; queue-only outcomes have version null. Rejections include
machine-readable codes and safe IDs when available. Conflicts on direct task
operations include current_version. Node uses HTTP statuses; GAS ContentService
uses an application-level ok/code regardless of HTTP 200.
