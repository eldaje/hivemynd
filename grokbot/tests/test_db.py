import datetime
import os
import subprocess
import sys
from types import SimpleNamespace

import pytest

import db

SRC = os.path.join(os.path.dirname(__file__), "..", "src")


@pytest.fixture(autouse=True)
def _tmp(tmp_path, monkeypatch):
    monkeypatch.setattr(db, "DB", str(tmp_path / "u.db"))


def _clock(monkeypatch, holder):
    class FakeDT:
        @staticmethod
        def now(tz):
            return holder[0]

    monkeypatch.setattr(
        db,
        "datetime",
        SimpleNamespace(datetime=FakeDT, UTC=datetime.UTC, date=datetime.date),
    )


def test_counts_persist_across_process(tmp_path):
    path = str(tmp_path / "u.db")
    env = {**os.environ, "GROKBOT_DB": path, "PYTHONPATH": SRC}
    subprocess.run(
        [sys.executable, "-c", "import db; db.bump(3)"], env=env, check=True
    )
    db.DB = path
    assert db.user_count(3) == 1


def test_refund_is_floor_zero():
    day = db.bump(7)
    db.unbump(day, 7)
    db.unbump(day, 7)
    assert db.user_count(7) == 0


def test_refund_hits_charged_day_across_midnight(monkeypatch):
    holder = [datetime.datetime(2026, 1, 1, 23, 59, tzinfo=datetime.UTC)]
    _clock(monkeypatch, holder)
    day = db.bump(7)
    holder[0] = datetime.datetime(2026, 1, 2, 0, 1, tzinfo=datetime.UTC)
    db.unbump(day, 7)
    c = db._c()
    r = c.execute("SELECT n FROM usage WHERE day='2026-01-01' AND uid=7").fetchone()
    c.close()
    assert r[0] == 0
    assert db.user_count(7) == 0


def test_unknown_user_is_zero():
    assert db.user_count(99) == 0


def test_day_key_is_utc(monkeypatch):
    holder = [datetime.datetime(2026, 1, 2, 23, 30, tzinfo=datetime.UTC)]
    _clock(monkeypatch, holder)
    assert db.today() == "2026-01-02"
