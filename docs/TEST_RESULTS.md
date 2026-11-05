# Validation evidence

Executed 2026-11-05 using Node v24.22.1, npm 11.9.0 on Linux.
No packages installed and no paid/cloud service provisioned.

Commands:

```bash
npm run check
npm run build:gas
npm test
npm run demo
```

Actual test output is in [test-output.txt](test-output.txt); the real local HTTP
demo output is in [demo-output.txt](demo-output.txt). The demo includes a task
moving from version 1 to 5, a rejected stale update, a duplicate returning the
original version 1 receipt, proposal review, an unverified claim, separate
synthetic verification, canonical read-after-write, durable restart replay, and
40 accepted field events. Generated UUIDs/timestamps refer only to local fiction.

Final full suite: **24 tests passed, 0 failures, 0 skipped**. npm test rebuilds
the GAS bundle before executing it against the API fake. A separate core-only
run is retained in [core-final-output.txt](core-final-output.txt).

The initial sandbox denied loopback bind (EPERM), so the full suite/demo were
executed successfully with sandboxed network permission enabled. That permission
did not deploy an external service. Source/JSON checks require no network.

| Brief test | Result and scope |
| --- | --- |
| A Create | PASS: local and GAS bundle with API fake |
| B Valid update | PASS: version increment, typed values, per-field audit |
| C Stale conflict | PASS: independently prepared changes and concurrent loopback requests |
| D Idempotency | PASS: unchanged receipt/audit, normalized request order, actor/payload collision, durable restart |
| E Attribution | PASS: authenticated slots separate from model label |
| F Claim vs verification | PASS: separate verifier, matching synthetic artifact, proof invalidation |
| G Failure recovery | PASS: before commit, after commit/response loss, read-back loss, hypothetical partial state, invalid local JSON |
| H Unauthorized access | PASS: wrong/missing credentials, permission limits, protected fields, credential rotation |
| I Read-after-write | PASS: loopback/file store and simulated Sheets canonical read |
| J Cross-model | NOT RUN: no second provider read the same live Google record |
| K External edit | PASS for simulated canonical edits, formulas and audit/header changes; direct-editor race remains unprotected |
| L Portability | PASS for proposal queue/review/rebase rules; manual request-file fallback documented |

Google evidence scope: **simulated only**. Tests execute the built Apps Script
bundle, including doPost, using a Node VM and an intentionally limited Sheets
API fake. Fake batch atomicity is an assumption tested against our adapter;
Google's atomicity is documented separately in ARCHITECTURE.md. No live Sheet,
OAuth, Google deployment, actual ScriptLock or API quota behavior has been tested.
CI is configured; local evidence above does not claim a GitHub Actions result.
The original repository spelling was inaccessible. The owner subsequently supplied
the corrected eldaje/hivemynd URL, which was verified for reads and configured as
the remote. Actual writes still return 403; no PR or GitHub CI run exists.
