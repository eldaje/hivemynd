import time

import pytest

import grok

KEY = (1, 7)


class Resp:
    def __init__(self, code, body=None):
        self.status_code = code
        self._body = body

    def json(self):
        if self._body is None:
            raise ValueError("not json")
        return self._body


def ok(t="hi"):
    return Resp(200, {"choices": [{"message": {"content": t}}]})


@pytest.fixture(autouse=True)
def _iso(monkeypatch):
    monkeypatch.setattr(grok, "SPACING", 0)
    grok._cool.clear()
    grok._hist.clear()
    grok._last = 0.0


def _client(monkeypatch, seq):
    calls = []

    class C:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            calls.append(json["model"])
            return seq.pop(0)

    monkeypatch.setattr(grok.httpx, "AsyncClient", C)
    return calls


@pytest.mark.asyncio
async def test_429_parks_and_falls_through(monkeypatch):
    calls = _client(monkeypatch, [Resp(429), ok()])
    r = await grok.ask(KEY, "x")
    assert r.ok and r.text == "hi"
    assert calls == grok.CHAIN[:2]
    assert grok._parked(grok.CHAIN[0])


@pytest.mark.asyncio
async def test_parked_route_is_skipped(monkeypatch):
    grok._cool[grok.CHAIN[0]] = time.time() + 60
    calls = _client(monkeypatch, [ok("y")])
    assert (await grok.ask(KEY, "x")).text == "y"
    assert calls == [grok.CHAIN[1]]


@pytest.mark.asyncio
async def test_all_parked_reports_cooldown(monkeypatch):
    for m in grok.CHAIN:
        grok._cool[m] = time.time() + 60
    _client(monkeypatch, [])
    r = await grok.ask(KEY, "x")
    assert not r.ok and r.kind == "cooldown"


@pytest.mark.asyncio
async def test_spacing_applies_between_fallback_attempts(monkeypatch):
    sleeps: list[float] = []

    async def fake_sleep(d):
        sleeps.append(d)

    monkeypatch.setattr(grok, "SPACING", 3.2)
    monkeypatch.setattr(grok.asyncio, "sleep", fake_sleep)
    monkeypatch.setattr(grok.time, "monotonic", lambda: 0.0)
    _client(monkeypatch, [Resp(429), Resp(429), ok()])
    await grok.ask(KEY, "x")
    assert len(sleeps) == len(grok.CHAIN)
    assert all(abs(s - 3.2) < 1e-6 for s in sleeps)


@pytest.mark.asyncio
async def test_history_never_exceeds_max(monkeypatch):
    _client(monkeypatch, [ok()] * 40)
    for i in range(40):
        await grok.ask(KEY, str(i))
    assert len(grok._hist[KEY]) <= grok.HISTORY_MAX


@pytest.mark.asyncio
async def test_failed_turn_leaves_history_identical(monkeypatch):
    _client(monkeypatch, [ok("a")])
    await grok.ask(KEY, "first")
    before = list(grok._hist[KEY])
    _client(monkeypatch, [Resp(500), Resp(500), Resp(500)])
    assert not (await grok.ask(KEY, "second")).ok
    assert grok._hist[KEY] == before


@pytest.mark.asyncio
@pytest.mark.parametrize(
    "body",
    [
        None,
        {},
        {"choices": []},
        {"choices": [{"message": {}}]},
        {"choices": [{"message": {"content": "   "}}]},
        {"choices": [{"message": {"content": [{"text": None}]}}]},
        {"choices": [{"message": {"content": [{"nottext": "x"}]}}]},
    ],
)
async def test_malformed_bodies_fall_through(monkeypatch, body):
    _client(monkeypatch, [Resp(200, body), ok("z")])
    r = await grok.ask(KEY, "x")
    assert r.ok and r.text == "z"


@pytest.mark.asyncio
async def test_auth_error_is_distinguished(monkeypatch):
    _client(monkeypatch, [Resp(401)] * len(grok.CHAIN))
    r = await grok.ask(KEY, "x")
    assert not r.ok and r.kind == "auth"


@pytest.mark.asyncio
async def test_missing_key_reports_auth(monkeypatch):
    monkeypatch.setattr(grok.config, "OPENROUTER_KEY", "")
    _client(monkeypatch, [])
    r = await grok.ask(KEY, "x")
    assert not r.ok and r.kind == "auth"
    assert grok._hist[KEY] == []


@pytest.mark.asyncio
async def test_parser_exception_does_not_escape(monkeypatch):
    class Boom:
        status_code = 200

        def json(self):
            raise RuntimeError("exploded")

    _client(monkeypatch, [Boom(), ok("z")])
    assert (await grok.ask(KEY, "x")).text == "z"


@pytest.mark.asyncio
async def test_chat_isolation(monkeypatch):
    _client(monkeypatch, [ok("a")])
    await grok.ask((1, 7), "dm")
    _client(monkeypatch, [ok("b")])
    await grok.ask((-100, 7), "group")
    assert grok._hist[(1, 7)][0]["content"] == "dm"
    assert grok._hist[(-100, 7)][0]["content"] == "group"
