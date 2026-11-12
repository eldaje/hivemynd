import pytest

import bot
import db
import grok


class FakeChat:
    id = 1

    async def send_action(self, _):
        pass


class FakeMsg:
    def __init__(self, text):
        self.text = text
        self.sent = []
        self.chat = FakeChat()

    async def reply_text(self, t):
        self.sent.append(t)


class FakeUser:
    id = 7


class FakeUpdate:
    def __init__(self, text="hello"):
        self.message = FakeMsg(text)
        self.effective_user = FakeUser()
        self.effective_chat = FakeChat()


class Resp:
    def __init__(self, code, body=None):
        self.status_code = code
        self._body = body

    def json(self):
        return self._body


@pytest.fixture(autouse=True)
def _iso(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB", str(tmp_path / "u.db"))
    monkeypatch.setattr(grok, "SPACING", 0)
    grok._cool.clear()
    grok._hist.clear()
    grok._last = 0.0


def _client(monkeypatch, seq):
    class C:
        def __init__(self, *a, **k):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def post(self, url, headers=None, json=None):
            return seq.pop(0)

    monkeypatch.setattr(grok.httpx, "AsyncClient", C)


@pytest.mark.asyncio
async def test_first_hop_429_is_invisible_to_user(monkeypatch):
    _client(
        monkeypatch,
        [Resp(429), Resp(200, {"choices": [{"message": {"content": "served"}}]})],
    )
    u = FakeUpdate()
    await bot.on_msg(u, None)
    assert u.message.sent == ["served"]
    assert db.user_count(7) == 1


@pytest.mark.asyncio
async def test_all_routes_parked_refunds_and_warns(monkeypatch):
    for m in grok.CHAIN:
        grok._cool[m] = 9e9
    u = FakeUpdate()
    await bot.on_msg(u, None)
    assert len(u.message.sent) == 1
    assert "cooling down" in u.message.sent[0]
    assert db.user_count(7) == 0


@pytest.mark.asyncio
async def test_typing_failure_still_refunds(monkeypatch):
    for m in grok.CHAIN:
        grok._cool[m] = 9e9

    class DeadChat(FakeChat):
        async def send_action(self, _):
            raise RuntimeError("no typing")

    u = FakeUpdate()
    u.message.chat = DeadChat()
    await bot.on_msg(u, None)
    assert db.user_count(7) == 0
    assert len(u.message.sent) == 1


@pytest.mark.asyncio
async def test_unexpected_exception_refunds_and_reports(monkeypatch):
    async def boom(*a, **k):
        raise RuntimeError("kaboom")

    monkeypatch.setattr(bot.grok, "ask", boom)
    u = FakeUpdate()
    await bot.on_msg(u, None)
    assert db.user_count(7) == 0
    assert u.message.sent == [grok.MESSAGES["internal"]]


@pytest.mark.asyncio
async def test_commands_work_at_cap(monkeypatch):
    for _ in range(40):
        db.bump(7)
    u = FakeUpdate()
    await bot.usage(u, None)
    assert "40/40" in u.message.sent[0]
    await bot.reset(u, None)
    assert u.message.sent[-1] == "Context cleared."


@pytest.mark.asyncio
async def test_stranger_is_rejected(monkeypatch):
    u = FakeUpdate()
    u.effective_user = type("U", (), {"id": 999})()
    await bot.on_msg(u, None)
    assert u.message.sent == ["Not on the list."]
