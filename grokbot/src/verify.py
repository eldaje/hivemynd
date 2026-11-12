"""Live catalog check. Reports only what the catalog establishes."""
import sys

import httpx

import config

URL = "https://openrouter.ai/api/v1/models"


def main() -> int:
    if not config.OPENROUTER_KEY:
        print("OPENROUTER_KEY missing (check .env)", file=sys.stderr)
        return 2
    with httpx.Client(timeout=30) as c:
        r = c.get(URL, headers={"Authorization": f"Bearer {config.OPENROUTER_KEY}"})
    r.raise_for_status()
    live = {m.get("id") for m in r.json().get("data", [])}

    missing = []
    for m in config.CHAIN:
        present = m in live
        print(f"{'ok  ' if present else 'absent'}  {m}")
        if not present:
            missing.append(m)

    print(f"\ncatalog reports {len(live)} ids; chain has {len(config.CHAIN)}")
    if missing:
        print(f"absent from catalog: {', '.join(missing)}")
        print("catalog absence only — the cause is not established here")
    if config.CHAIN[-1].startswith("x-ai/"):
        print("last hop is a Grok SKU: no non-Grok fallback in this chain")
    return 1 if missing else 0


if __name__ == "__main__":
    raise SystemExit(main())
