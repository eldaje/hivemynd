# Integration evidence

Status as of 2026-11-05; no claims are inferred from product marketing or memory.

| Client/system | Verified in this implementation | Untested / unavailable |
| --- | --- | --- |
| Node local client | Real loopback HTTP create/update/read, conflict, credentials; durable restart | Not another AI provider |
| Apps Script source | Actual doPost/core/adapter executed in a Node VM against Sheets API fake | Live runtime, quotas, OAuth, access restrictions, deployment, Google Sheet reads/writes |
| ChatGPT (this session) | Local source edits/tests, connector attempt against named GitHub repo | Live BLUE KITE record access and safe custom gateway call not exercised |
| Claude | Shared protocol prepared | NOT RUN: same live fictional record read/update |
| Gemini | Shared protocol prepared | NOT RUN: same live fictional record read/update |
| Grok | Shared protocol prepared | NOT RUN: same live fictional record read/update |
| Unknown client without gateway tool | Reviewable JSON proposal file workflow documented | Cannot claim an enqueue or write until an authorized client submits it |
| GitHub connector | Corrected eldaje/hivemynd README retrieved; metadata reports push permission | Actual create-branch call returns 403 Resource not accessible by integration; no manageable installation listed |
| Git CLI | Corrected remote fetched; main contains only README; feature based on existing history | Actual push returns 403; no remote feature branch/PR; no merge/deployment |

Acceptance test J (cross-model): **NOT RUN**. A local second actor is an auth/role
test only. No Sheet has been created, no web app deployed, and no live Google
operation has been attempted. Generic connector cell updates are unsupported as
an authoritative write path even when a provider offers them.
