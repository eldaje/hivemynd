"""OpenRouter client: throttle, cooldown, ordered fallback, safe parsing."""
import asyncio
import time
from dataclasses import dataclass

import httpx

import config

URL = "https://openrouter.ai/api/v1/chat/completions"
COOLDOWN = 120
GONE = 600
SPACING = 3.2
HISTORY_MAX = 24

CHAIN = config.CHAIN

MESSAGES = {
    "cooldown": "All routes are cooling down. Try again in a minute.",
    "auth": "Router credentials look wrong.",
    "network": "Network trouble reaching the model.",
    "unavailable": "No model route is currently available.",
    "bad_response": "The model returned something unreadable.",
    "internal": "The bot hit an unexpected error.",
}

_gate = asyncio.Lock()
_last = 0.0
_cool: dict[str, float] = {}
_hist: dict[tuple[int, int], list] = {}


@dataclass(frozen=True)
class Reply:
    ok: bool
    text: str
    kind: str


def _hdr() -> dict:
    return {
        "Authorization": f"Bearer {config.OPENROUTER_KEY}",
        "HTTP-Referer": "https://localhost",
        "X-Title": "grokbot",
    }


def _parked(m: str) -> bool:
    return _cool.get(m, 0.0) > time.time()


async def _throttle() -> None:
    """Sleep until at least SPACING has passed since the last request."""
    global _last
    wait = SPACING - (time.monotonic() - _last)
    if wait > 0:
        await asyncio.sleep(wait)
    _last = time.monotonic()


def _extract(r: httpx.Response) -> str | None:
    try:
        data = r.json()
    except ValueError:
        return None
    if not isinstance(data, dict):
        return None
    choices = data.get("choices")
    if not isinstance(choices, list) or not choices:
        return None
    first = choices[0]
    if not isinstance(first, dict):
        return None
    msg = first.get("message")
    if not isinstance(msg, dict):
        return None
    content = msg.get("content")
    if isinstance(content, list):
        parts = [p.get("text") for p in content if isinstance(p, dict)]
        if not all(isinstance(p, str) for p in parts):
            return None
        content = "".join(parts)
    if not isinstance(content, str) or not content.strip():
        return None
    return content


def _dominant(kinds: set[str]) -> str:
    for k in ("auth", "internal", "cooldown", "network", "unavailable"):
        if k in kinds:
            return k
    return "bad_response"


async def ask(key: tuple[int, int], text: str) -> Reply:
    h = _hist.setdefault(key, [])
    h.append({"role": "user", "content": text})
    kinds: set[str] = set()
    served = False

    try:
        if not config.OPENROUTER_KEY:
            kinds.add("auth")
        else:
            async with _gate:
                for m in CHAIN:
                    if _parked(m):
                        kinds.add("cooldown")
                        continue
                    await _throttle()
                    try:
                        async with httpx.AsyncClient(timeout=90) as c:
                            r = await c.post(
                                URL,
                                headers=_hdr(),
                                json={
                                    "model": m,
                                    "messages": h,
                                    "max_tokens": 1200,
                                    "temperature": 0.7,
                                },
                            )
                    except Exception:  # noqa: BLE001 - any transport fault
                        kinds.add("network")
                        continue

                    if r.status_code == 429:
                        _cool[m] = time.time() + COOLDOWN
                        kinds.add("cooldown")
                        continue
                    if r.status_code in (401, 403):
                        kinds.add("auth")
                        continue
                    if r.status_code == 404:
                        _cool[m] = time.time() + GONE
                        kinds.add("unavailable")
                        continue
                    if r.status_code >= 500:
                        kinds.add("network")
                        continue
                    if r.status_code != 200:
                        kinds.add("unavailable")
                        continue

                    try:
                        out = _extract(r)
                    except Exception:  # noqa: BLE001 - parser must not escape
                        out = None
                    if out is None:
                        kinds.add("bad_response")
                        continue

                    h.append({"role": "assistant", "content": out})
                    del h[:-HISTORY_MAX]
                    served = True
                    return Reply(True, out, "ok")
    except Exception:  # noqa: BLE001 - never leave a half-open turn
        kinds.add("internal")
    finally:
        if not served and h and h[-1].get("role") == "user":
            h.pop()

    kind = _dominant(kinds)
    return Reply(False, MESSAGES[kind], kind)


def reset(key: tuple[int, int]) -> None:
    _hist.pop(key, None)
