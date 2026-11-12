# grokbot

Telegram agent on OpenRouter's free Grok SKU. Text only, no browser, no VM.
Independent of any X subscription pool.

## Config loading
`src/config.py` calls `load_dotenv()` at import. Everything else imports
`config` first, so `.env` values are applied before any module reads them.

## Cap semantics
`DAILY_USER` / `DAILY_GLOBAL` count **messages accepted**, not API attempts.
A message that no route served is refunded against the exact day it was
charged, so cooldown exhaustion never costs a turn and never lands on the
wrong day.

## Chat isolation
History is keyed by `(chat_id, user_id)`. A DM and a group do not share
context. Usage counters are keyed by user id and shared across chats.

## Run
    cp .env.example .env
    python -m venv venv && ./venv/bin/pip install -r requirements.txt
    ./venv/bin/python src/verify.py     # live; exits 1 if a route is absent
    ./venv/bin/python src/bot.py

## Test
    ./venv/bin/pytest -q
