# Hivemind — BLUE KITE v0.1

Working fictional-data prototype: a controlled task Ledger, field-level audit trail,
proposals queue, independent synthetic verification, and shared read protocol.
No personal records, vendor subscription, database, or runtime dependencies.

Implementation plan: keep the core runtime-independent; use one writer and separate
reader/proposer/verifier slots; test local durable storage and a Google Sheets
adapter; review before deploying. This implements sections 1–14 of the supplied
Hivemind Master Engineering Brief v1.0 (2026-11-05); its appendix is historical.

## Run

Requires Node.js 24 (CI version; Node 22.8+ supports the test runner setting).

```bash
npm run check
npm run build:gas
npm test
npm run demo
```

No `npm install` is needed. The demo opens a temporary loopback HTTP gateway,
creates and updates fiction, rejects a stale update, replays a duplicate,
reviews a proposal, claims and independently verifies synthetic evidence, reads
the destination, checks audit events and reopens the durable store. It cleans up
its temporary files and never prints tokens.

For a persistent local server:

```bash
node scripts/configure-local.js
HIVEMIND_PRINCIPALS_FILE=.runtime/principals.json npm start
# In a second terminal:
node scripts/client.js .runtime/writer.json fixtures/blue-kite.json
```

The fixture has a stable demo operation ID, so submitting it again returns its
original receipt. Generate a fresh ID for a different logical change.
Client request files contain protocol objects; the client reads the token from
a separate credential file and sends `{token, request}`. Do not commit credentials.

## Google Sheets gateway

`npm run build:gas` builds `dist/apps-script/Code.gs` and its manifest. The generated
Apps Script uses this same core, `LockService`, the advanced Sheets service, and
server-owned Script Properties. Setup creates a **new fictional spreadsheet**
with `Tasks`, `Activity_Log`, `Proposals`, `Operations`, and `_Integrity` tabs.
Each mutation submits one atomic `spreadsheets.batchUpdate` containing task/proposal
changes, appended audit events, durable receipt, and integrity digest.

**Not deployed and not exercised against Google.** The adapter and actual GAS
entrypoint are tested against an API fake. Review the deployment/authentication
model in [SECURITY](docs/SECURITY.md) and follow [RUNBOOK](docs/RUNBOOK.md) before
any live setup. No live Sheet or cross-model proof exists yet.

## Guarantees and limits

- Version comparison happens after the canonical read inside the storage lock.
- Retried operation IDs return the original outcome; changed payload/actor is rejected.
- Authenticated actor slots and untrusted `model_claimed` are separate.
- Completion claims stay unverified until another authorized slot checks synthetic evidence.
- Any subsequent task edit clears completion proof.
- Ambiguous writes return failure; retry the same ID and read the current destination.
- Receipts never expire in this pilot; hard capacity limits fail closed.
- Direct canonical-cell edits invalidate the integrity digest. A hash is detection,
  not protection from privileged tampering or simultaneous edits bypassing the lock.

Read [architecture](docs/ARCHITECTURE.md), [data model](docs/DATA_MODEL.md),
[shared protocol](docs/SHARED_AGENT_PROTOCOL.md), [integration matrix](docs/INTEGRATION_MATRIX.md),
[validation evidence](docs/TEST_RESULTS.md), and [review handoff](docs/REVIEW_HANDOFF.md).

## Repository status

Repository: https://github.com/eldaje/hivemynd (public, as configured by the owner).
The original brief spelled the repository `hivemind`; the owner supplied the
corrected URL after local implementation. Access to `hivemynd` was verified,
and its existing main branch contained only a README. This implementation is
based on that main commit on `feat/blue-kite-ledger-v01`; main is unchanged.
Publication is still blocked: git push and the connector's create-branch call
both returned HTTP 403. The available installation lookup returned no manageable
GitHub app installations. Repository permission metadata alone did not establish
working integration write access. No remote feature branch or PR was created.
[GitHub handoff](docs/GITHUB_HANDOFF.md) describes independent review.
