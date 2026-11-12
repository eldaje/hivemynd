# TASKS

- [x] `pytest -q` green
- [x] `ruff check src tests` clean
- [ ] `.env` values reach `db.DB` and `grok.CHAIN` (no stale defaults)
- [ ] kill the process mid-day, restart, `/usage` shows counts preserved
- [ ] force 429 on hop 1, confirm hop 2 serves with no user-visible error
- [ ] park all routes, confirm one short message and `/usage` unchanged
- [ ] charge a turn, advance the clock past midnight, fail it, confirm the
      refund lands on the original day
- [ ] send in a DM and a group as one user, confirm separate history
- [ ] `/usage` and `/reset` work while the user is at cap
- [ ] `verify.py` exits 1 when a configured route is absent
- [ ] service starts as user `grokbot`, writes /var/lib/grokbot/usage.db
