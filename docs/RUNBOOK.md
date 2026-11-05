# Setup and operations

## Local setup

Use Node 24. No dependencies, paid services or credentials are needed for tests.
Run npm run check, npm run build:gas, npm test, npm run demo. The HTTP test/demo
require permission to bind loopback sockets. In a restricted Codex sandbox, enable
network permission for that command; do not skip the test and claim it passed.
Core-only tests can run without networking:

```bash
node --test --test-isolation=none tests/ledger.test.js tests/sheets.test.js
```

For persistent use, run node scripts/configure-local.js once. It refuses to
overwrite any existing generated credential. Start with
`HIVEMIND_PRINCIPALS_FILE=.runtime/principals.json npm start`.
Use a separate terminal to submit the fixture through scripts/client.js as shown
in README. Generate operation IDs with the runtime's crypto.randomUUID; the demo
is an executable create/update/conflict/retry/read example.

Only distribute the relevant credential file to its client. Never hand out the
whole .runtime directory. The local developer owns all files, so separate logical
slots do not by themselves establish independently controlled clients.

Rotate a credential by generating a new random 32-byte token in the secure local
configuration process, updating its private client file, replacing only that
slot's token_hash in principals.json, and restarting the server. Keep actor_id
unchanged. Revoke lost credentials immediately; never place values in shell
arguments or logs. Automated tests prove revocation and receipt continuity.

## Approved future Google setup (NOT EXECUTED)

1. Review SECURITY.md with the owner, including OAuth scope breadth, identity,
   deployment access, direct editors and costs. Obtain approval before live
   Workspace permission changes or publishing any endpoint. No production rollout.
2. Use an approved pilot Google identity and a new standalone Apps Script project.
   Run npm run build:gas. Copy dist/apps-script/Code.gs and appsscript.json to the
   project; do not paste only the unbundled entrypoint. Enable the advanced Sheets
   v4 service (included in the manifest) and the Sheets API if the project requires it.
3. Configure BLUE_KITE_PRINCIPALS as JSON in Script Properties with unique actor_id,
   token_hash and permission arrays. Use hashes of random 256-bit tokens, exactly
   one writer, separate verifier credentials, and reader/proposer roles as needed.
   Do not commit hashes of live credentials or values. Do not set a real Sheet ID
   in source. initializeBlueKite creates a fresh dedicated fictional spreadsheet
   and saves BLUE_KITE_SHEET_ID in Script Properties. It refuses to replace it.
4. Run initializeBlueKite once from the editor after approval. Inspect the new
   Sheet's five tabs and headers. Do not import an existing personal spreadsheet.
   If Sheet creation succeeds but saving the property fails, find that new
   fictional Sheet and review it before setting its ID; do not repeatedly create copies.
5. Keep participants as Sheet viewers. Only the trusted execution identity may
   write. Review access restrictions for the web app and actual client compatibility.
   Do not publish unrestricted access as a shortcut. If acceptable restricted
   access cannot be achieved, do not deploy; leave clients proposal-only.
6. After deployment approval, choose a reviewed restricted access model. No
   deployment is created by the manifest or build command. Record which identity
   executes the app and what permissions it has. GAS outcomes are application-level
   ok/code; HTTP 200 is not acceptance.
7. Set HIVEMIND_GATEWAY_URL to the approved script.google.com /exec URL. Submit
   the fictional fixture with the writer's credential using scripts/client.js.
   Reread the returned reference with the reader's independently held credential.
   Inspect matching UUID/version/audit events in the Sheet.
8. Run the live checklist below and record real output before labeling Google
   integration verified. Re-run after code/configuration or permissions change.

## Optional live integration checklist

Live tests are manual and opt-in because they mutate an approved fictional Sheet.
No automatic external integration test runs in CI.

- Create from fixtures/blue-kite.json with a new operation ID; retrieve the same ID.
- Update using current version. Submit another operation with the old version:
  expect VERSION_CONFLICT and unchanged canonical record.
- Replay the original request: expect exactly its original receipt and no extra
  task/event/operation rows. Try changed content with that ID: OPERATION_ID_REUSED.
- Reader token cannot create; invalid token cannot read; proposer can enqueue but
  not apply. Review a proposal and verify expected_version still applies.
- Claim completion with synthetic:blue-kite-inspection-v1. Reread claimed_unverified.
  Verify using the independently held verifier token, then reread verified_synthetic.
- Rotate a pilot token, confirm old token denied, new token retains actor and replays.
- Simulate caller response loss only against fictional data; retry the same ID.
  Never sabotage a real API batch to create a partial write.
- In a disposable copy, directly edit a canonical cell and confirm integrity failure.
  ScriptLock cannot protect against a direct edit racing a batch; document this limit.
- Have ChatGPT and another provider independently issue the same canonical read.
  Record their actual tools, response UUID/version, UTC times, and limitations in
  INTEGRATION_MATRIX.md. A second slot inside Node is not a second provider.

## Failures and recovery

For transient response errors, retain the request and retry its operation ID.
An accepted receipt can be historical: reread current version/status separately.
Do not automatically retry conflicts or authorization errors.

For OUT_OF_BAND_EDIT/STORE_CORRUPT: freeze the pilot, preserve the whole store/Sheet,
compare tasks, accepted audit events and receipts with the last verified backup
and source history. Determine whether a complete batch exists. Prefer restoring
an operator-verified complete snapshot to a new separately identified pilot.
Do not recompute the digest to silently bless unknown edits or fabricate history.
This release detects corruption but provides no automatic reconciliation tool.

For a stale local writer.lock after a crash, stop every process using the store,
back it up, confirm no writer remains and inspect ledger.json integrity before
removing only the stale empty lock directory. Restart and replay the same ID.
Orphan *.tmp files are uncommitted snapshots and must not replace the canonical
ledger.json without deliberate operator review. Never delete audit/receipt rows
to clear capacity. Archive the entire pilot and review a new retention design.
