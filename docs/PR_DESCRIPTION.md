BLUE KITE needs a shared operational record that distinguishes claimed completion
from verified evidence and rejects stale or duplicate changes. This implementation
adds a runnable fictional Ledger with one authorized writer, proposals, per-field
audit events, durable operation receipts, independent synthetic verification, a
loopback gateway, and a bundled Google Sheets/Apps Script adapter.

Validation: npm run check; npm run build:gas; npm test; npm run demo. See
docs/TEST_RESULTS.md for actual output and evidence scope. Sheets tests execute
the real GAS entrypoint against an API fake; live Google and cross-model tests
are NOT RUN. No deployment, personal import or production permissions changed.

Security review: Apps Script bearer-body authentication and the spreadsheets OAuth
scope require an explicit access/deployment review. Direct editors bypass the
script lock; integrity checks detect canonical edits but are not tamper-proof.
See docs/SECURITY.md and docs/REVIEW_HANDOFF.md for limitations and checklist.
