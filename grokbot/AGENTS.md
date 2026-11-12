# AGENTS.md

## Purpose
Grok-flavoured Telegram agent over OpenRouter. Must never touch an X/Grok
subscription pool.

## Invariants — do not break
1. Outbound **model** requests go to OpenRouter only. Telegram long-polling is
   the only other egress and is expected.
2. `.env` is loaded in `src/config.py` at import, before any module reads env.
3. Minimum 3.2s between every outbound model request, including between
   fallback attempts, enforced under a module-level asyncio.Lock.
4. A 429 parks a model 120s; a 404 parks it 600s. Parked models are skipped,
   never retried in the same turn.
5. Chain order is fixed. `GROKBOT_CHAIN` is validated at import against an
   allowlist of authorized free routes; empty, unknown, or all-Grok chains
   fail fast.
6. Counters persist in SQLite. Restart must not reset them.
7. Caps count accepted messages. `bump()` returns its day key and refunds use
   that key, so a turn spanning midnight refunds the day it charged.
8. History is capped at 24, trimmed after the assistant reply. Every non-ok
   path — including unexpected exceptions — pops the pending turn.
9. History is keyed by (chat_id, user_id). Counters are keyed by user id.
10. Day keys are UTC.
11. No polling loops, cron, or heartbeat. Telegram long-poll only.

## Failure taxonomy
A 429 is invisible when a later hop succeeds. One short message is shown only
when no route serves: cooldown / auth / network / unavailable / bad_response /
internal. Unexpected exceptions fall through to the next hop.

## Layout
    src/config.py  dotenv load, chain validation, settings
    src/bot.py     handlers, guard order, refund
    src/grok.py    throttle, cooldown, fallback, safe parsing
    src/db.py      SQLite counters, UTC keys, day-keyed refund
    src/verify.py  live catalog check, exits 1 on absence
    tests/         mocked, zero quota

## Conventions
- Python 3.11+, no framework beyond python-telegram-bot. Pinned deps.
- Type hints on public functions. ruff default rules.
- Errors surfaced as one short sentence, never a traceback.

## Definition of done
- pytest green, ruff clean
- 429 then success produces no user-visible error
- all routes unavailable refunds the charged day
- restart preserves the day's counts
- DM and group histories stay independent
