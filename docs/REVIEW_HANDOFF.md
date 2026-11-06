# Independent review handoff

Review target: the BLUE KITE feature branch and supplied master brief sections
1–14. Implementation is fictional and deployment is intentionally deferred.
Run npm run check, npm run build:gas, npm test, npm run demo from the repo root.

Challenge these boundaries:

- Does every mutation pass schema, credential and permission checks before the lock?
- Are version reads inside the lock? Can a stale proposal change task state?
- Does replay survive a process restart and committed-but-lost response without
  duplicate field events? Does a changed actor or payload fail?
- Are audit and receipts in the same Sheets batch? Are existing audit rows never
  updated by the adapter? Does the bundle contain the tested core?
- Can a claimant self-verify after another update? Does a new update invalidate proof?
- Can an untrusted model label become actor identity, timestamp or verifier?
- Can text become a Sheet formula? Do canonical cell/header edits fail closed?
- Are acceptance claims clearly local, simulated Sheets, live Google, or cross-model?

Known limitations needing review before any deployment: bearer-body auth, broad
Sheets OAuth scope, independently held slot credentials, restricted GAS client
compatibility, direct editors outside ScriptLock, capacity/retention, and manual
corruption reconciliation. No production security claim is made.

Review checklist:

- [ ] Run local suite and inspect actual output.
- [ ] Inspect auth configuration and request validation against schemas.
- [ ] Inject failures and review recovery behavior without trusting implementation comments.
- [ ] Approve a safe live Workspace setup separately, if desired.
- [ ] Verify the same live record from two independent providers before passing Gate 3.
- [x] Inspect the corrected repository's actual default branch and base the feature on it.
- [ ] Independently review the feature PR; do not self-merge or deploy.
