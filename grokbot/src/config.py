"""Single source of settings. Loads .env before anything else reads env."""
import os

from dotenv import load_dotenv

load_dotenv()

DB = os.environ.get("GROKBOT_DB", "usage.db")
OPENROUTER_KEY = os.environ.get("OPENROUTER_KEY", "").strip()

DEFAULT_CHAIN = (
    "x-ai/grok-4-fast:free,x-ai/grok-4.1-fast:free,openai/gpt-oss-120b:free"
)
# Authorized free routes. Adding one here is a deliberate act.
AUTHORIZED = frozenset(
    {
        "x-ai/grok-4-fast:free",
        "x-ai/grok-4.1-fast:free",
        "openai/gpt-oss-120b:free",
        "openai/gpt-oss-20b:free",
    }
)


def _chain() -> list[str]:
    raw = os.environ.get("GROKBOT_CHAIN", "").strip() or DEFAULT_CHAIN
    chain = [m.strip() for m in raw.split(",") if m.strip()]
    if not chain:
        raise ValueError("GROKBOT_CHAIN resolved empty")
    unknown = [m for m in chain if m not in AUTHORIZED]
    if unknown:
        raise ValueError(
            f"unauthorized route(s): {', '.join(unknown)}. "
            f"authorized: {', '.join(sorted(AUTHORIZED))}"
        )
    if all(m.startswith("x-ai/") for m in chain):
        raise ValueError("chain is all-Grok; a promo lapse would leave no route")
    if chain[-1].startswith("x-ai/"):
        print("warning: last hop is a Grok SKU; no non-Grok fallback")
    return chain


CHAIN = _chain()
