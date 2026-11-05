# Architecture

The runtime-independent core validates requests and authorization, enters the
storage lock, reads and checks integrity, looks up durable operation receipts,
checks the expected version, computes a new state and per-field events, then
commits the state and receipt together. A fresh destination read must match the
committed digest before the core reports acceptance. Replays return the original
receipt, which is historical; clients must separately reread the current record.

```
Assistant -> authenticated slot -> validate -> storage lock
  -> integrity + receipt lookup -> version check -> transition
  -> atomic commit(task/proposal, audit, receipt, digest) -> fresh read
```

`src/core/ledger.js` is shared between Node and Apps Script without transpilation.
`src/gateway/runtime.js` supplies Node clock, UUIDs, SHA-256, authentication and
synthetic evidence checks. `apps-script/Code.gs` supplies Google equivalents.
`scripts/build-gas.js` bundles the exact source and evidence fixture into one GAS file.

Local storage is one owner-readable JSON snapshot. A filesystem lock directory
serializes cooperating processes. Writing a separate file, fsync, atomic rename,
and directory fsync commits the snapshot. A crash before rename leaves the old
snapshot; after rename the operation receipt is in the new snapshot. Stale lock
directories require operator recovery, never automatic deletion.

Google storage uses typed columns in five tabs. Only changed task/proposal rows
are updated; audit and operation rows are appended. A single advanced Sheets
`spreadsheets.batchUpdate` commits all changes, including the integrity digest.
Google documents request-level atomicity, including rejecting the entire batch
if any request is invalid. ScriptLock serializes this one script's reads/writes;
it does not lock human editors or a second script project. Only one script
project may be configured as writer for a given Sheet.

This deliberately avoids separate `setValues` / `appendRow` calls, which can leave
a task changed without its audit or receipt. Tests also inject a hypothetical
partial write: the unchanged digest detects it and blocks further operations.
An ambiguous timeout may mean the batch committed. The client must reuse its ID;
a receipt lookup resolves the ambiguity without a second mutation.

The integrity digest covers ordered canonical task/proposal/event/operation data.
Schema headers and formulas are checked separately. Reads are bounded to defined
columns and pilot capacities, plus an overflow row/columns. Cells outside these
bounds are not Ledger data and are not inspected. No complete Sheet tamper-proofing
is claimed. A direct editor racing a gateway read/commit can still cause a lost
update; restrict Ledger access to viewers before live testing.

Operation receipts persist for the lifetime of the pilot (no TTL). The hard limit
is 1,000 receipts, 200 tasks, 200 proposals, 20,000 field events. New mutations stop
at capacity; existing reads and known-ID replays remain available. Never delete
receipts to make room; start a separately identified pilot or design an approved
retention/migration policy. Requests are limited to 8 KiB at transport boundaries,
strings to 100/160/240/500 characters depending on field, and patches are small.

Rejected authorized, schema-valid domain operations (for example stale versions)
are stored as receipts so their retries are deterministic. They do not append
accepted Activity_Log events. Authentication/schema/permission/integrity/capacity
failures are not retained. There are no unattended retries or background jobs.

The user-initiated `brief` returns up to three open tasks in insertion order,
blockers, pending proposal count, recent events, claimed/unverified tasks and
synthetically verified tasks. No priority ranking is inferred. Timestamps are UTC;
the reporting timezone is America/Denver. Raw personal context is out of scope.

Official reference checked 2026-11-05:
https://developers.google.com/workspace/sheets/api/reference/rest/v4/spreadsheets/batchUpdate

The documentation explicitly warns that collaborators may alter changes even
though each request batch is applied atomically. Local API fakes cannot validate
Google's actual behavior, identity handling, quotas or deployment configuration.
