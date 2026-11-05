# Security model and deployment review

This is a fictional-data pilot, not a production authentication service. No
deployment, live Workspace creation, permission change or OAuth credential setup
has been performed. Local HTTP listens on 127.0.0.1 only. Do not tunnel it or bind
it to an internet interface. Plain HTTP is acceptable only on this loopback path.

## Identity and least privilege

Each configured principal has a stable actor_id, a SHA-256 digest of a random
256-bit bearer token, and explicit permissions: read, write, propose, verify.
Configuration requires exactly one writer, unique actor IDs and unique token
digests. Reader/proposer/verifier capabilities can be independently assigned.
Test credentials appear only in tests and are never production defaults. The
local setup generates random tokens into ignored files with mode 0600; configs
contain only hashes. No secret values are printed by setup, server or client.

The token authenticates an **agent slot**, not a provider or exact model. An
authorized user holding two slot credentials can impersonate both roles. Deploy
independent credentials to independently controlled clients; never give the
writer the verifier token. model_claimed is informational and is logged separately.
Rotation replaces a slot's hash, retains actor_id, and revokes the old token.
Existing receipts remain replayable by the same actor using its new credential.
Tests exercise revocation, distinct actors, and forbidden writes.

Verification checks a committed synthetic evidence fixture against the claimed
task title and reference. This proves the role/evidence protocol, not that a real
kite was inspected. It is explicitly labeled verified_synthetic in reads/briefs.
Extending verification to external actions requires a separate trusted source
adapter and security review. No arbitrary URL is fetched as evidence.

## Apps Script review required before deployment

The provided adapter uses bearer credentials in POST JSON because ContentService
does not provide a general header-authenticated HTTP server. This is still a bearer
secret: it requires TLS, safe handling and an acceptable deployment access model.
Tokens are prohibited in query strings and Sheet cells. Script Properties contain
token hashes and the dedicated Sheet ID; script editors can change authentication
and must be trusted. Do not enable request-body or credential logging. The manifest
disables uncaught exception logging; error responses return safe codes only.

Apps Script execute-as-owner can grant the script the owner's Sheets authority.
The spreadsheets OAuth scope is **not restricted to one folder or Sheet**. Code
uses only the configured dedicated Sheet, but that is an application boundary,
not an OAuth guarantee. Prefer a separate pilot identity with only fictional
resources. Do not create credentials or grant access without owner approval.

Do not choose "Anyone" access and treat a static token as production security.
Review Google's available domain/account-restricted deployment options against
the actual client invocation capabilities. Restricted Google-authenticated callers
may not work with generic assistant HTTP tools; return those clients to proposal
files/read-only access. If a safely restricted deployment cannot meet the client
requirements, leave GAS undeployed. The smallest alternative is the same core
behind an approved authenticated service (for example Cloud Run with platform
identity); no alternative has been provisioned or expense approved.

The GAS entrypoint returns HTTP 200 with machine-readable application errors;
it does not promise HTTP 409. Local Node uses 409 for version/ID/integrity conflicts.
Clients must always inspect ok/code, not HTTP status alone. ContentService output
can redirect to script.googleusercontent.com; the included client follows only a
GET redirect to that host and never forwards bearer request bodies on redirects.

## Audit, direct edits and failure boundaries

Gateway code only appends audit and operation rows. A privileged human or Workspace
administrator can change them; this is not a tamper-proof ledger. Hidden tabs do
not enforce permissions. Restrict all non-gateway clients to Sheet viewers. Do
not use generic Sheet connectors for writes, even if they support cell updates.
Protected ranges can reduce accidents but cannot defeat an owner/admin.

An integrity digest detects accidental direct changes in canonical cells, headers,
formulas and hypothetical partial writes. A privileged attacker can recompute a
hash, and direct edits racing the read/commit are outside ScriptLock. A second GAS
project has a different lock: never configure two gateways against one Sheet.
No endpoint repairs integrity automatically or accepts a client-supplied new hash.

One Sheets batch atomically applies the task/proposal, audit, operation receipt
and digest. Response loss is ambiguous; always retry with the same operation ID.
If corruption is detected, freeze writes and reconcile against an operator-verified
backup/source history. Never manufacture an accepted audit event to hide a gap.
Local storage assumes a filesystem with same-directory atomic rename and fsync;
it is not distributed storage, encrypted storage or hardened against local owners.

The pilot has hard capacity limits, no rate limiter or internet abuse protection,
no multi-tenant isolation, no automatic credential expiry, no signed external
evidence, and no audit export/archival retention system. Unauthenticated failures
are not logged or persisted, to avoid secrets and unbounded unauthenticated writes.
Keep the endpoint restricted and fictional. These limitations block production use.
